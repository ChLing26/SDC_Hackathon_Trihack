
import sqlite3
import random
from datetime import date, timedelta

DB_NAME = "stationery_suppliers.db"

# Reproducible synthetic distances
random.seed(42)


def create_database():
    with sqlite3.connect(DB_NAME) as conn:
        conn.execute("PRAGMA foreign_keys = ON")

        conn.executescript("""
        CREATE TABLE IF NOT EXISTS businesses (
            business_id INTEGER PRIMARY KEY,
            business_name TEXT NOT NULL,
            address TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS suppliers (
            supplier_id INTEGER PRIMARY KEY,
            supplier_name TEXT NOT NULL,
            contact TEXT,
            address TEXT NOT NULL,
            distance_km REAL NOT NULL
                CHECK(distance_km >= 0),
            distance_type TEXT NOT NULL DEFAULT 'synthetic'
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
            delivery_date TEXT NOT NULL,
            delivery_time TEXT NOT NULL,

            FOREIGN KEY (supplier_id)
                REFERENCES suppliers(supplier_id),
            FOREIGN KEY (item_id)
                REFERENCES stationery(item_id),

            UNIQUE (supplier_id, item_id)
        );
        """)

    print("Database and tables created.")


def insert_sample_data():
    today = date.today()

    # Fictional business owner
    business = (
        1,
        "ABC Office Supplies",
        "Ipoh, Perak, Malaysia"
    )

    # Fictional suppliers
    supplier_names = [
        ("Paper Plus Enterprise", "012-1001001",
         "Ipoh, Perak"),
        ("Budget Stationery Trading", "012-1001002",
         "Batu Gajah, Perak"),
        ("Office Mart Supplies", "012-1001003",
         "Menglembu, Perak"),
        ("Smart Stationery Wholesale", "012-1001004",
         "Simpang Pulai, Perak"),
        ("Reliable Office Products", "012-1001005",
         "Chemor, Perak")
    ]

    # Generate a synthetic distance for each supplier.
    # These are not measured geographic or road distances.
    suppliers = []

    for supplier_id, supplier in enumerate(
        supplier_names, start=1
    ):
        name, contact, address = supplier

        distance = round(random.uniform(2.0, 35.0), 2)

        suppliers.append((
            supplier_id,
            name,
            contact,
            address,
            distance,
            "synthetic"
        ))

    # Stationery products and units
    items = [
        (1, "Ballpoint Pens", "box"),
        (2, "Pencils", "box"),
        (3, "A4 Paper", "ream"),
        (4, "Notebooks", "piece"),
        (5, "Staplers", "piece"),
        (6, "File Folders", "pack"),
        (7, "Erasers", "box"),
        (8, "Highlighters", "pack")
    ]

    # Each tuple:
    # offer_id, supplier_id, item_id, unit price,
    # delivery fee, days until delivery, delivery time
    offer_data = [
        (1, 1, 1, 12.50, 5.00, 1, "09:00"),
        (2, 1, 2, 10.00, 5.00, 1, "09:00"),
        (3, 1, 3, 14.00, 5.00, 1, "09:00"),
        (4, 1, 4,  4.50, 5.00, 2, "10:30"),

        (5, 2, 1, 11.80, 8.00, 2, "14:00"),
        (6, 2, 3, 13.50, 8.00, 2, "14:00"),
        (7, 2, 5, 18.00, 8.00, 3, "11:00"),
        (8, 2, 6,  9.00, 8.00, 2, "14:00"),

        (9, 3, 2,  9.50, 4.00, 1, "11:30"),
        (10, 3, 3, 15.00, 4.00, 1, "11:30"),
        (11, 3, 4,  4.20, 4.00, 2, "15:00"),
        (12, 3, 7,  7.00, 4.00, 1, "11:30"),

        (13, 4, 1, 13.00, 3.00, 1, "13:00"),
        (14, 4, 5, 16.50, 3.00, 1, "13:00"),
        (15, 4, 6,  8.50, 3.00, 2, "10:00"),
        (16, 4, 8, 11.00, 3.00, 1, "13:00"),

        (17, 5, 2, 10.20, 6.00, 2, "16:00"),
        (18, 5, 3, 13.80, 6.00, 2, "16:00"),
        (19, 5, 4,  4.00, 6.00, 1, "09:30"),
        (20, 5, 8, 10.50, 6.00, 1, "09:30")
    ]

    offers = []

    for offer in offer_data:
        (
            offer_id,
            supplier_id,
            item_id,
            price,
            fee,
            days_to_delivery,
            delivery_time
        ) = offer

        delivery_date = (
            today + timedelta(days=days_to_delivery)
        ).isoformat()

        offers.append((
            offer_id,
            supplier_id,
            item_id,
            price,
            fee,
            delivery_date,
            delivery_time
        ))

    with sqlite3.connect(DB_NAME) as conn:
        conn.execute("PRAGMA foreign_keys = ON")

        conn.execute("""
            INSERT INTO businesses
            (business_id, business_name, address)
            VALUES (?, ?, ?)
            ON CONFLICT(business_id) DO UPDATE SET
                business_name = excluded.business_name,
                address = excluded.address
        """, business)

        conn.executemany("""
            INSERT INTO suppliers
            (supplier_id, supplier_name, contact,
             address, distance_km, distance_type)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(supplier_id) DO UPDATE SET
                supplier_name = excluded.supplier_name,
                contact = excluded.contact,
                address = excluded.address,
                distance_km = excluded.distance_km,
                distance_type = excluded.distance_type
        """, suppliers)

        conn.executemany("""
            INSERT INTO stationery
            (item_id, item_name, unit)
            VALUES (?, ?, ?)
            ON CONFLICT(item_id) DO UPDATE SET
                item_name = excluded.item_name,
                unit = excluded.unit
        """, items)

        conn.executemany("""
            INSERT INTO supplier_offers
            (offer_id, supplier_id, item_id,
             unit_price, delivery_fee,
             delivery_date, delivery_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(supplier_id, item_id)
            DO UPDATE SET
                unit_price = excluded.unit_price,
                delivery_fee = excluded.delivery_fee,
                delivery_date = excluded.delivery_date,
                delivery_time = excluded.delivery_time
        """, offers)

    print("Sample businesses, suppliers, products and offers saved.")


def display_supplier_offers():
    with sqlite3.connect(DB_NAME) as conn:
        rows = conn.execute("""
            SELECT
                s.supplier_name,
                s.address,
                s.distance_km,
                s.distance_type,
                p.item_name,
                p.unit,
                o.unit_price,
                o.delivery_fee,
                o.delivery_date,
                o.delivery_time
            FROM supplier_offers AS o
            JOIN suppliers AS s
                ON o.supplier_id = s.supplier_id
            JOIN stationery AS p
                ON o.item_id = p.item_id
            ORDER BY p.item_name, o.unit_price
        """).fetchall()

    print("\nSTATIONERY SUPPLIER DATABASE")
    print("=" * 100)

    for row in rows:
        (
            supplier, address, distance, distance_type,
            item, unit, price, fee, delivery_date, time
        ) = row

        print(f"\nSupplier: {supplier}")
        print(f"Address: {address}")
        print(f"Product: {item} ({unit})")
        print(f"Unit price: RM {price:.2f}")
        print(f"Delivery fee: RM {fee:.2f}")
        print(f"Distance: {distance:.2f} km ({distance_type})")
        print(f"Delivery date: {delivery_date}")
        print(f"Delivery time: {time}")


if __name__ == "__main__":
    create_database()
    insert_sample_data()
    display_supplier_offers()

    print(f"\nDatabase saved as: {DB_NAME}")
