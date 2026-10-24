"""Interactive catalogue demo. Run with: python -m scripts.python.catalogue_demo."""

from src.database.catalogue import (
    add_sample_offers,
    create_database,
    create_synthetic_suppliers,
    save_business,
    update_supplier_distances,
)
from src.services.catalogue import get_supplier_recommendations
from src.services.location import geocode_address


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
    business_id = save_business(name, address, latitude, longitude)
    print("\nBusiness saved successfully.")
    print(f"Business ID: {business_id}")
    print(f"Coordinates: {latitude:.6f}, {longitude:.6f}")
    return business_id


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
    print("\nLowest-cost supplier with a valid route:", rows[0]["supplier_name"])


def main():
    create_database()
    business_id = input_business()
    if business_id is None:
        return
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
        recommend_supplier(business_id, item_name, quantity)
    except ValueError as error:
        print(f"Invalid quantity: {error}")


if __name__ == "__main__":
    main()
