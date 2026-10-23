
from contextlib import asynccontextmanager, contextmanager
from datetime import date, time, datetime
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import Field

from src.backend_database import (
    configured_database_path, database_connection, require_catalogue,
)
from src.backend_security import RequestModel, require_service_auth

DB_NAME = configured_database_path()

# Database connection

@contextmanager
def get_connection():
    with database_connection(DB_NAME, writable=True) as conn:
        require_catalogue(conn)
        yield conn


# Create the emergency purchase table


def initialize_database():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS emergency_purchases (
                purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,

                business_id INTEGER NOT NULL,
                supplier_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,

                quantity REAL NOT NULL CHECK(quantity > 0),

                unit_price REAL NOT NULL CHECK(unit_price >= 0),
                delivery_fee REAL NOT NULL CHECK(delivery_fee >= 0),
                total_cost REAL NOT NULL CHECK(total_cost >= 0),

                required_delivery_time TEXT NOT NULL,

                quoted_delivery_time TEXT NOT NULL,

                road_distance_km REAL,
                driving_duration_min REAL,

                status TEXT NOT NULL DEFAULT 'Pending Approval'
                    CHECK(status IN (
                        'Pending Approval',
                        'Approved',
                        'Rejected'
                    )),

                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                decision_at TEXT,
                decision_note TEXT,

                FOREIGN KEY (business_id)
                    REFERENCES businesses(business_id),

                FOREIGN KEY (supplier_id)
                    REFERENCES suppliers(supplier_id),

                FOREIGN KEY (item_id)
                    REFERENCES stationery(item_id)
            )
        """)


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="Emergency Stationery Purchasing API",
    description=(
        "Automatically selects a suitable stationery supplier "
        "and submits an emergency purchase for approval."
    ),
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(require_service_auth)],
    docs_url=None, redoc_url=None, openapi_url=None,
)


# --------------------------------------------------
# Request and response models
# --------------------------------------------------

class EmergencyPurchaseRequest(RequestModel):
    business_id: int = Field(gt=0)
    item_name: str = Field(min_length=1, max_length=100)
    quantity: float = Field(gt=0)

    required_delivery_time: time

    max_distance_km: float | None = Field(
        default=None, gt=0, le=10000
    )


class PurchaseDecision(RequestModel):
    decision: Literal["Approved", "Rejected"]
    note: str = Field(default="", max_length=500)


# --------------------------------------------------
# Health check
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Emergency purchasing API is running",
        "purchase_statuses": [
            "Pending Approval",
            "Approved",
            "Rejected"
        ]
    }


# --------------------------------------------------
# Submit an emergency purchase request
# --------------------------------------------------

@app.post("/emergency-purchases", status_code=201)
def create_emergency_purchase(request: EmergencyPurchaseRequest):

    required_time = request.required_delivery_time.strftime("%H:%M:%S")

    with get_connection() as conn:

        # Check the business
        business = conn.execute("""
            SELECT business_id, business_name
            FROM businesses
            WHERE business_id = ?
        """, (request.business_id,)).fetchone()

        if business is None:
            raise HTTPException(
                status_code=404,
                detail="Business not found."
            )

        # Find the requested stationery and eligible suppliers.
        # Only consider suppliers with a successful route.
        # Delivery must be no later than the requested deadline.
        candidates = conn.execute("""
    SELECT
        s.supplier_id,
        s.supplier_name,
        p.item_id,
        p.item_name,
        p.unit,
        o.unit_price,
        COALESCE(o.delivery_fee, 0) AS delivery_fee,
        o.delivery_time,
        d.road_distance_km,
        d.driving_duration_min
    FROM supplier_offers AS o
    JOIN suppliers AS s
        ON s.supplier_id = o.supplier_id
    JOIN stationery AS p
        ON p.item_id = o.item_id
    JOIN supplier_distances AS d
        ON d.supplier_id = s.supplier_id
       AND d.business_id = ?
    WHERE LOWER(TRIM(p.item_name)) = LOWER(TRIM(?))
      AND d.route_status = 'OK'
      AND o.delivery_time IS NOT NULL
      AND o.delivery_time <= ?
      AND (
          ? IS NULL
          OR d.road_distance_km <= ?
      )
    ORDER BY
        (o.unit_price * ? + COALESCE(o.delivery_fee, 0)) ASC,
        o.delivery_time ASC,
        d.road_distance_km ASC
""", (
    request.business_id,
    request.item_name.strip(),
    required_time,
    request.max_distance_km,
    request.max_distance_km,
    request.quantity,
)).fetchall()

        if not candidates:
            raise HTTPException(
                status_code=409,
                detail=(
                    "No supplier offer meets the requested "
                    "delivery deadline and distance criteria. "
                    "No purchase request was created."
                )
            )

        # Automatically select the lowest-total-cost eligible offer.
        chosen = candidates[0]

        total_cost = (
            chosen["unit_price"] * request.quantity
            + chosen["delivery_fee"]
        )

        # Save a quote snapshot and require approval.
        cursor = conn.execute("""
            INSERT INTO emergency_purchases (
                business_id,
                supplier_id,
                item_id,
                quantity,
                unit_price,
                delivery_fee,
                total_cost,
                required_delivery_time,
                quoted_delivery_time,
                road_distance_km,
                driving_duration_min,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            request.business_id,
            chosen["supplier_id"],
            chosen["item_id"],
            request.quantity,
            chosen["unit_price"],
            chosen["delivery_fee"],
            round(total_cost, 2),
            required_time,
            chosen["delivery_time"],
            chosen["road_distance_km"],
            chosen["driving_duration_min"],
            "Pending Approval"
        ))

        purchase_id = cursor.lastrowid

        return {
            "purchase_id": purchase_id,
            "status": "Pending Approval",
            "business": business["business_name"],
            "item": chosen["item_name"],
            "quantity": request.quantity,
            "unit": chosen["unit"],
            "selected_supplier": chosen["supplier_name"],
            "unit_price_rm": chosen["unit_price"],
            "delivery_fee_rm": chosen["delivery_fee"],
            "total_cost_rm": round(total_cost, 2),
            "road_distance_km": chosen["road_distance_km"],
            "estimated_driving_minutes":
                chosen["driving_duration_min"],
            "required_delivery": {
                "time": required_time
            },
            "quoted_delivery": {
                "time": chosen["delivery_time"]
            },
            "message": (
                "Supplier selected automatically. "
                "Awaiting authorized approval. "
                "No supplier order has been placed."
            )
        }


# --------------------------------------------------
# View emergency purchases
# --------------------------------------------------

@app.get("/emergency-purchases")
def list_emergency_purchases(
    status: Literal[
        "Pending Approval", "Approved", "Rejected"
    ] | None = None,
    business_id: int | None = None
):
    query = """
        SELECT
            ep.*,
            b.business_name,
            s.supplier_name,
            p.item_name,
            p.unit
        FROM emergency_purchases ep
        JOIN businesses b
            ON b.business_id = ep.business_id
        JOIN suppliers s
            ON s.supplier_id = ep.supplier_id
        JOIN stationery p
            ON p.item_id = ep.item_id
        WHERE 1 = 1
    """

    params = []

    if status is not None:
        query += " AND ep.status = ?"
        params.append(status)

    if business_id is not None:
        query += " AND ep.business_id = ?"
        params.append(business_id)

    query += " ORDER BY ep.created_at DESC, ep.purchase_id DESC"

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]


# --------------------------------------------------
# Approve or reject an emergency purchase
# --------------------------------------------------

@app.post("/emergency-purchases/{purchase_id}/decision")
def decide_purchase(
    purchase_id: int,
    decision: PurchaseDecision
):
    with get_connection() as conn:
        existing = conn.execute("""
            SELECT purchase_id, status
            FROM emergency_purchases
            WHERE purchase_id = ?
        """, (purchase_id,)).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=404,
                detail="Purchase request not found."
            )

        if existing["status"] != "Pending Approval":
            raise HTTPException(
                status_code=409,
                detail=(
                    "Only pending requests can be approved "
                    "or rejected."
                )
            )

        now = datetime.now().isoformat(timespec="seconds")

        cursor = conn.execute("""
            UPDATE emergency_purchases
            SET status = ?,
                decision_at = ?,
                decision_note = ?
            WHERE purchase_id = ?
              AND status = 'Pending Approval'
        """, (
            decision.decision,
            now,
            decision.note,
            purchase_id
        ))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Purchase request was already decided.")

        return {
            "purchase_id": purchase_id,
            "status": decision.decision,
            "decision_at": now,
            "decision_note": decision.note,
            "message": (
                "Request decision recorded. "
                "No supplier order was sent."
            )
        }


# --------------------------------------------------
# Retrieve a specific purchase request
# --------------------------------------------------

@app.get("/emergency-purchases/{purchase_id}")
def get_purchase(purchase_id: int):
    with get_connection() as conn:
        row = conn.execute("""
            SELECT
                ep.*,
                b.business_name,
                s.supplier_name,
                p.item_name,
                p.unit
            FROM emergency_purchases ep
            JOIN businesses b
                ON b.business_id = ep.business_id
            JOIN suppliers s
                ON s.supplier_id = ep.supplier_id
            JOIN stationery p
                ON p.item_id = ep.item_id
            WHERE ep.purchase_id = ?
        """, (purchase_id,)).fetchone()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Purchase request not found."
            )

        return dict(row)
