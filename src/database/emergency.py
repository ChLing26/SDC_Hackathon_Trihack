from contextlib import contextmanager

from src.database.connection import (
    configured_database_path,
    database_connection,
    require_catalogue,
)

DB_NAME = configured_database_path()


@contextmanager
def get_connection():
    with database_connection(DB_NAME, writable=True) as conn:
        require_catalogue(conn)
        yield conn


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
                        'Pending Approval', 'Approved', 'Rejected'
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


def find_business(conn, business_id):
    return conn.execute("""
        SELECT business_id, business_name
        FROM businesses
        WHERE business_id = ?
    """, (business_id,)).fetchone()


def find_eligible_offers(
    conn,
    business_id,
    item_name,
    required_time,
    max_distance_km,
):
    return conn.execute("""
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
          AND (? IS NULL OR d.road_distance_km <= ?)
        ORDER BY o.delivery_time ASC, d.road_distance_km ASC
    """, (
        business_id,
        item_name,
        required_time,
        max_distance_km,
        max_distance_km,
    )).fetchall()


def insert_purchase(conn, values):
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
    """, values)
    return cursor.lastrowid


def list_purchases(conn, status=None, business_id=None):
    query = """
        SELECT
            ep.*,
            b.business_name,
            s.supplier_name,
            p.item_name,
            p.unit
        FROM emergency_purchases ep
        JOIN businesses b ON b.business_id = ep.business_id
        JOIN suppliers s ON s.supplier_id = ep.supplier_id
        JOIN stationery p ON p.item_id = ep.item_id
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
    return conn.execute(query, params).fetchall()


def find_purchase_status(conn, purchase_id):
    return conn.execute("""
        SELECT purchase_id, status
        FROM emergency_purchases
        WHERE purchase_id = ?
    """, (purchase_id,)).fetchone()


def record_decision(conn, purchase_id, decision, timestamp, note):
    cursor = conn.execute("""
        UPDATE emergency_purchases
        SET status = ?,
            decision_at = ?,
            decision_note = ?
        WHERE purchase_id = ?
          AND status = 'Pending Approval'
    """, (decision, timestamp, note, purchase_id))
    return cursor.rowcount


def fetch_purchase(conn, purchase_id):
    return conn.execute("""
        SELECT
            ep.*,
            b.business_name,
            s.supplier_name,
            p.item_name,
            p.unit
        FROM emergency_purchases ep
        JOIN businesses b ON b.business_id = ep.business_id
        JOIN suppliers s ON s.supplier_id = ep.supplier_id
        JOIN stationery p ON p.item_id = ep.item_id
        WHERE ep.purchase_id = ?
    """, (purchase_id,)).fetchone()
