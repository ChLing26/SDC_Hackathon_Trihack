import unittest

from src.models.advice import Supplier
from src.services.anomalies import detect_anomalies


class AnomalyChecks(unittest.TestCase):
    def test_detects_reported_total_mismatch_and_invalid_route(self):
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
        warning_types = {warning["type"] for warning in warnings}
        self.assertIn("TOTAL_COST_MISMATCH", warning_types)
        self.assertIn("INVALID_ROUTE", warning_types)


if __name__ == "__main__":
    unittest.main()
