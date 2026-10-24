
from api import detect_anomalies, Supplier

suppliers = [
    Supplier(
        name="Normal Supplier",
        product_price_rm=100,
        shipping_rm=10,
        delivery_days=3,
        distance_km=10,
        total_cost_rm=110,
        route_status="OK",
    ),
    Supplier(
        name="Price Mismatch Supplier",
        product_price_rm=100,
        shipping_rm=10,
        delivery_days=3,
        distance_km=12,
        total_cost_rm=200,
        route_status="OK",
    ),
    Supplier(
        name="Invalid Route Supplier",
        product_price_rm=90,
        shipping_rm=10,
        delivery_days=4,
        distance_km=15,
        total_cost_rm=100,
        route_status="FAILED",
    ),
]

warnings = detect_anomalies(suppliers)

for warning in warnings:
    print(warning)

assert any(
    w["type"] == "TOTAL_COST_MISMATCH"
    for w in warnings
)

assert any(
    w["type"] == "INVALID_ROUTE"
    for w in warnings
)

print("Anomaly detection tests passed.")
