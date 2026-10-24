import random
import sqlite3
import time
from datetime import date, timedelta

from src.database.connection import configured_database_path, database_connection
from src.services.location import calculate_road_distance


DB_NAME = configured_database_path()


def create_database():
    with database_connection(DB_NAME, writable=True, create=True) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS businesses (
            business_id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            address TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS suppliers (
            supplier_id INTEGER PRIMARY KEY,
            supplier_name TEXT NOT NULL,
            contact TEXT,
            address TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stationery (
            item_id INTEGER PRIMARY KEY,
            item_name TEXT NOT NULL UNIQUE,
            unit TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS supplier_offers (
            offer_id INTEGER PRIMARY KEY,
            supplier_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            unit_price REAL NOT NULL CHECK(unit_price >= 0),
            delivery_fee REAL NOT NULL DEFAULT 0
                CHECK(delivery_fee >= 0),
            delivery_time TEXT NOT NULL,

            FOREIGN KEY (supplier_id)
                REFERENCES suppliers(supplier_id),
            FOREIGN KEY (item_id)
                REFERENCES stationery(item_id),

            UNIQUE(supplier_id, item_id)
        );

        CREATE TABLE IF NOT EXISTS supplier_distances (
            business_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            road_distance_km REAL,
            driving_duration_min REAL,
            route_status TEXT NOT NULL,

            PRIMARY KEY (business_id, supplier_id),

            FOREIGN KEY (business_id)
                REFERENCES businesses(business_id),
            FOREIGN KEY (supplier_id)
                REFERENCES suppliers(supplier_id)
        );
        """)
    print("Database is ready.")


def save_business(name, address, latitude, longitude):
    with database_connection(DB_NAME, writable=True) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        cursor = conn.execute("""
            INSERT INTO businesses (
                business_name, address, latitude, longitude
            )
            VALUES (?, ?, ?, ?)
        """, (name, address, latitude, longitude))
        business_id = cursor.lastrowid
    return business_id


def create_synthetic_suppliers(business_id):
    with database_connection(DB_NAME, writable=True) as conn:
        business = conn.execute("""
            SELECT latitude, longitude
            FROM businesses
            WHERE business_id = ?
        """, (business_id,)).fetchone()
        if business is None:
            raise ValueError("Business not found.")
        business_lat, business_lon = business
        existing = conn.execute(
            "SELECT COUNT(*) FROM suppliers"
        ).fetchone()[0]
        if existing > 0:
            print(
                "Supplier records already exist. "
                "Keeping their existing coordinates."
            )
            return

        random.seed(42)
        names = [
            "Paper Plus Enterprise",
            "Budget Stationery Trading",
            "Office Mart Supplies",
            "Smart Stationery Wholesale",
            "Reliable Office Products",
            "Pen and Pencil Centre",
            "Notebook Warehouse",
            "Quality Paper Supplies",
            "School Essentials Trading",
            "Everyday Office Supplies",
        ]
        suppliers = []
        for supplier_id, supplier_name in enumerate(names, start=1):
            lat = business_lat + random.uniform(-0.03, 0.03)
            lon = business_lon + random.uniform(-0.03, 0.03)
            suppliers.append((
                supplier_id,
                supplier_name,
                f"TEST-{supplier_id:03d}",
                "Synthetic location for testing",
                lat,
                lon,
            ))
        conn.executemany("""
            INSERT INTO suppliers (
                supplier_id, supplier_name, contact,
                address, latitude, longitude
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """, suppliers)
    print("10 synthetic suppliers created.")


def add_sample_offers():
    items = [
        (1, "Ballpoint Pens", "box"),
        (2, "Pencils", "box"),
        (3, "A4 Paper", "ream"),
        (4, "Notebooks", "piece"),
        (5, "Staplers", "piece"),
    ]
    sample_offers = [
        (1, 1, 12.50, 5.00, 1, "09:00"),
        (2, 1, 11.80, 8.00, 2, "14:00"),
        (3, 1, 13.00, 4.00, 1, "11:30"),
        (4, 1, 12.00, 3.00, 2, "13:00"),
        (5, 1, 11.50, 6.00, 3, "16:00"),
        (1, 2, 10.00, 5.00, 1, "09:00"),
        (2, 3, 13.50, 8.00, 2, "14:00"),
        (3, 3, 15.00, 4.00, 1, "11:30"),
        (4, 4, 4.50, 3.00, 2, "13:00"),
        (5, 5, 18.00, 6.00, 3, "16:00"),
    ]
    today = date.today()
    with database_connection(DB_NAME, writable=True) as conn:
        conn.executemany("""
            INSERT INTO stationery (item_id, item_name, unit)
            VALUES (?, ?, ?)
            ON CONFLICT(item_id) DO UPDATE SET
                item_name = excluded.item_name,
                unit = excluded.unit
        """, items)
        for offer in sample_offers:
            supplier_id, item_id, price, fee, days, delivery_time = offer
            delivery_date = (today + timedelta(days=days)).isoformat()
            conn.execute("""
                INSERT INTO supplier_offers (
                    supplier_id, item_id, unit_price,
                    delivery_fee, delivery_time
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(supplier_id, item_id)
                DO UPDATE SET
                    unit_price = excluded.unit_price,
                    delivery_fee = excluded.delivery_fee,
                    delivery_time = excluded.delivery_time
            """, (supplier_id, item_id, price, fee, delivery_time))
    print("Stationery offers saved.")


def update_supplier_distances(business_id):
    with database_connection(DB_NAME, writable=True) as conn:
        business = conn.execute("""
            SELECT latitude, longitude
            FROM businesses
            WHERE business_id = ?
        """, (business_id,)).fetchone()
        if business is None:
            print("Business not found.")
            return
        business_lat, business_lon = business
        suppliers = conn.execute("""
            SELECT supplier_id, supplier_name, latitude, longitude
            FROM suppliers
        """).fetchall()
        for index, supplier in enumerate(suppliers):
            supplier_id, name, lat, lon = supplier
            if index > 0:
                time.sleep(1.1)
            distance, duration, status = calculate_road_distance(
                business_lat, business_lon, lat, lon,
            )
            conn.execute("""
                INSERT INTO supplier_distances (
                    business_id, supplier_id,
                    road_distance_km, driving_duration_min,
                    route_status
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(business_id, supplier_id)
                DO UPDATE SET
                    road_distance_km = excluded.road_distance_km,
                    driving_duration_min = excluded.driving_duration_min,
                    route_status = excluded.route_status
            """, (business_id, supplier_id, distance, duration, status))
            print(
                f"{name}: "
                f"{distance if distance is not None else 'N/A'} km "
                f"({status})"
            )
