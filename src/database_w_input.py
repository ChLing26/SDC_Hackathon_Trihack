import sqlite3
import random
import time
import requests

from datetime import date, timedelta
from geopy.geocoders import Nominatim

from src.backend_database import configured_database_path, database_connection
from src.backend_numbers import checked_quantity, checked_total

DB_NAME = configured_database_path()
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"

geolocator = Nominatim(
    user_agent="stationery_supplier_selection_project"
)

# Create database tables


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

# Convert business address into coordinates

def geocode_address(address):
    location = geolocator.geocode(
        address,
        timeout=15
    )

    if location is None:
        raise ValueError(
            "Address not found. Try entering a more "
            "specific address, town, or postcode."
        )

    return location.latitude, location.longitude

# Ask for and save business location

def input_business():
    print("\nENTER YOUR BUSINESS DETAILS")

    name = input("Business name: ").strip()
    address = input(
        "Business address (include town and country): "
    ).strip()

    if not name or not address:
        print("Business name and address are required.")
        return None

    try:
        latitude, longitude = geocode_address(address)
    except Exception as error:
        print(f"Could not locate the address: {error}")
        return None

    with database_connection(DB_NAME, writable=True) as conn:
        conn.execute("PRAGMA foreign_keys = ON")

        cursor = conn.execute("""
            INSERT INTO businesses (
                business_name, address, latitude, longitude
            )
            VALUES (?, ?, ?, ?)
        """, (name, address, latitude, longitude))

        business_id = cursor.lastrowid

    print("\nBusiness saved successfully.")
    print(f"Business ID: {business_id}")
    print(f"Coordinates: {latitude:.6f}, {longitude:.6f}")

    return business_id

# Create fictional suppliers near the business

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

        existing = conn.execute("""
            SELECT COUNT(*)
            FROM suppliers
        """).fetchone()[0]

        if existing > 0:
            print(
                "Supplier records already exist. "
                "Keeping their existing coordinates."
            )
            return

        random.seed(42)

        suppliers = []

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
            "Everyday Office Supplies"
        ]

        for supplier_id, supplier_name in enumerate(
            names, start=1
        ):
            lat = business_lat + random.uniform(-0.03, 0.03)
            lon = business_lon + random.uniform(-0.03, 0.03)

            suppliers.append((
                supplier_id,
                supplier_name,
                f"TEST-{supplier_id:03d}",
                "Synthetic location for testing",
                lat,
                lon,
                1
            ))

        conn.executemany("""
            INSERT INTO suppliers (
                supplier_id, supplier_name, contact,
                address, latitude, longitude
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            supplier[:6] for supplier in suppliers
        ])

    print("10 synthetic suppliers created.")

# Add stationery products and offers

def add_sample_offers():
    items = [
        (1, "Ballpoint Pens", "box"),
        (2, "Pencils", "box"),
        (3, "A4 Paper", "ream"),
        (4, "Notebooks", "piece"),
        (5, "Staplers", "piece")
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
        (5, 5, 18.00, 6.00, 3, "16:00")
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

            delivery_date = (
                today + timedelta(days=days)
            ).isoformat()

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
            """, (
                supplier_id, item_id, price, fee,
                delivery_time
            ))

    print("Stationery offers saved.")

# Calculate road distance using OSRM

def calculate_road_distance(lat1, lon1, lat2, lon2):
    coordinates = f"{lon1},{lat1};{lon2},{lat2}"

    try:
        response = requests.get(
            f"{OSRM_URL}/{coordinates}",
            params={"overview": "false"},
            timeout=20
        )

        response.raise_for_status()
        data = response.json()

        if data.get("code") != "Ok" or not data.get("routes"):
            return None, None, "NO_ROUTE"

        route = data["routes"][0]

        return (
            round(route["distance"] / 1000, 2),
            round(route["duration"] / 60, 2),
            "OK"
        )

    except (requests.RequestException, ValueError) as error:
        print(f"Routing error: {error}")
        return None, None, "REQUEST_ERROR"


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
                business_lat, business_lon, lat, lon
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
                    driving_duration_min =
                        excluded.driving_duration_min,
                    route_status = excluded.route_status
            """, (
                business_id, supplier_id,
                distance, duration, status
            ))

            print(
                f"{name}: "
                f"{distance if distance is not None else 'N/A'} km "
                f"({status})"
            )


# Find the best supplier for a stationery item
def get_supplier_recommendations(
    business_id: int,
    item_name: str,
    quantity: float
) -> list[dict]:
    """Return eligible suppliers as JSON-compatible dictionaries."""

    checked_quantity(quantity)

    with database_connection(DB_NAME) as conn:
        conn.row_factory = sqlite3.Row

        rows = conn.execute(
            """
            SELECT
                s.supplier_name,
                p.item_name,
                p.unit,
                o.unit_price,
                o.delivery_fee,
                o.delivery_time,
                d.road_distance_km,
                d.driving_duration_min,
                d.route_status
            FROM supplier_offers o
            JOIN suppliers s
                ON o.supplier_id = s.supplier_id
            JOIN stationery p
                ON o.item_id = p.item_id
            JOIN supplier_distances d
                ON d.supplier_id = s.supplier_id
            WHERE d.business_id = ?
              AND p.item_name = ?
              AND d.route_status = 'OK'
            """,
            (business_id, item_name)
        ).fetchall()

    recommendations = []

    for row in rows:
        item = dict(row)

        item["quantity"] = quantity
        item["total_cost_rm"] = checked_total(
            item["unit_price"], item["delivery_fee"], quantity,
        )

        recommendations.append(item)

    recommendations.sort(key=lambda item: item["total_cost_rm"])
    for rank, item in enumerate(recommendations, start=1):
        item["rank"] = rank
    return recommendations

def recommend_supplier(business_id, item_name, quantity):
    rows = get_supplier_recommendations(business_id, item_name, quantity)

    if not rows:
        print(
            "No eligible supplier offers with a valid route. "
            "Check the item name and route results."
        )
        return

    print(f"\nSUPPLIERS OFFERING {item_name.upper()}")
    print("-" * 80)

    for rank, row in enumerate(rows, start=1):
        supplier, unit = row["supplier_name"], row["unit"]
        price, fee = row["unit_price"], row["delivery_fee"]
        delivery_time = row["delivery_time"]
        distance, duration = row["road_distance_km"], row["driving_duration_min"]
        status, total_cost = row["route_status"], row["total_cost_rm"]

        print(f"\nRank: {rank}")
        print(f"Supplier: {supplier}")
        print(f"Unit price: RM {price:.2f} per {unit}")
        print(f"Quantity: {quantity}")
        print(f"Delivery fee: RM {fee:.2f}")
        print(f"Total cost: RM {total_cost:.2f}")
        print(f"Road distance: {distance:.2f} km")
        print(f"Estimated driving time: {duration:.1f} minutes")
        print(f"Delivery time: {delivery_time}")
        print(f"Route status: {status}")

    print(
        "\nLowest-cost supplier with a valid route:",
        rows[0]["supplier_name"]
    )

# Run application

if __name__ == "__main__":
    create_database()

    business_id = input_business()

    if business_id is not None:
        create_synthetic_suppliers(business_id)
        add_sample_offers()

        print("\nCalculating supplier road distances...")
        update_supplier_distances(business_id)

        item_name = input(
            "\nEnter stationery item (e.g. Ballpoint Pens): "
        ).strip()

        try:
            quantity = float(input("Enter quantity: "))

            if quantity <= 0:
                raise ValueError("Quantity must be positive.")

            recommend_supplier(
                business_id,
                item_name,
                quantity
            )

        except ValueError as error:
            print(f"Invalid quantity: {error}")
