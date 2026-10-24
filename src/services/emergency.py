from datetime import datetime

from fastapi import HTTPException

from src.database import emergency as emergency_database
from src.models.emergency import EmergencyPurchaseRequest, PurchaseDecision
from src.services.numbers import checked_total


def create_emergency_purchase(request: EmergencyPurchaseRequest):
    required_time = request.required_delivery_time.strftime("%H:%M:%S")
    with emergency_database.get_connection() as conn:
        business = emergency_database.find_business(conn, request.business_id)
        if business is None:
            raise HTTPException(status_code=404, detail="Business not found.")

        candidates = emergency_database.find_eligible_offers(
            conn,
            request.business_id,
            request.item_name.strip(),
            required_time,
            request.max_distance_km,
        )
        if not candidates:
            raise HTTPException(
                status_code=409,
                detail=(
                    "No supplier offer meets the requested delivery deadline "
                    "and distance criteria. No purchase request was created."
                ),
            )

        try:
            totals = [
                (
                    checked_total(
                        row["unit_price"],
                        row["delivery_fee"],
                        request.quantity,
                    ),
                    row,
                )
                for row in candidates
            ]
        except ValueError:
            raise HTTPException(
                409,
                "Supplier quote amounts exceed supported numeric limits.",
            ) from None

        # SQL orders delivery/distance ties; min preserves that order.
        total_cost, chosen = min(totals, key=lambda candidate: candidate[0])
        purchase_id = emergency_database.insert_purchase(conn, (
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
            "Pending Approval",
        ))

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
            "estimated_driving_minutes": chosen["driving_duration_min"],
            "required_delivery": {"time": required_time},
            "quoted_delivery": {"time": chosen["delivery_time"]},
            "message": (
                "Supplier selected automatically. Awaiting authorized approval. "
                "No supplier order has been placed."
            ),
        }


def list_emergency_purchases(status=None, business_id=None):
    with emergency_database.get_connection() as conn:
        rows = emergency_database.list_purchases(conn, status, business_id)
        return [dict(row) for row in rows]


def decide_purchase(purchase_id: int, decision: PurchaseDecision):
    with emergency_database.get_connection() as conn:
        existing = emergency_database.find_purchase_status(conn, purchase_id)
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail="Purchase request not found.",
            )
        if existing["status"] != "Pending Approval":
            raise HTTPException(
                status_code=409,
                detail="Only pending requests can be approved or rejected.",
            )

        now = datetime.now().isoformat(timespec="seconds")
        row_count = emergency_database.record_decision(
            conn, purchase_id, decision.decision, now, decision.note,
        )
        if row_count != 1:
            raise HTTPException(409, "Purchase request was already decided.")

        return {
            "purchase_id": purchase_id,
            "status": decision.decision,
            "decision_at": now,
            "decision_note": decision.note,
            "message": "Request decision recorded. No supplier order was sent.",
        }


def get_emergency_purchase(purchase_id: int):
    with emergency_database.get_connection() as conn:
        row = emergency_database.fetch_purchase(conn, purchase_id)
        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Purchase request not found.",
            )
        return dict(row)
