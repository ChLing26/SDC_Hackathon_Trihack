"""Non-destructive smoke checks for the imported backend.

Skipped dependency-backed checks are intentionally visible. No live network
requests or writes to tracked SQLite snapshots are permitted by this suite.
"""

import ast
import contextlib
import hashlib
import importlib.metadata
import io
from pathlib import Path
import sqlite3
import tempfile
from datetime import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES = (
    "fastapi", "pydantic", "requests", "geopy", "python-dotenv", "google-genai",
)
MISSING = []
for dependency in DEPENDENCIES:
    try:
        importlib.metadata.version(dependency)
    except importlib.metadata.PackageNotFoundError:
        MISSING.append(dependency)


class SnapshotChecks(unittest.TestCase):
    def test_executable_python_sources_parse(self):
        # The known malformed archival artifact is checked explicitly below.
        # It is not an executable module and must remain byte-for-byte intact.
        files = [
            *ROOT.glob("*.py"),
            *ROOT.joinpath("src").glob("*.py"),
            ROOT / "backups/database_w_input_backup.py",
        ]
        self.assertGreater(len(files), 0)
        for path in files:
            with self.subTest(path=path.relative_to(ROOT)):
                ast.parse(path.read_text(), filename=str(path))

    def test_archival_ai_backup_is_unchanged_and_known_invalid(self):
        path = ROOT / "backups/ai_advisor_backup.py"
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                         "7dfef62df1b5bdfde25443f0b479185b985454c0f5932ea02d7b3e6afe04a73b")
        with self.assertRaises(SyntaxError):
            ast.parse(path.read_text(), filename=str(path))

    def test_sqlite_snapshots_are_readable_without_writes(self):
        required = {
            "businesses", "suppliers", "stationery", "supplier_offers",
            "supplier_distances",
        }
        for relative in (
            "src/business_supplier_selection.db",
            "backups/business_supplier_selection_backup.db",
        ):
            with self.subTest(database=relative):
                uri = (ROOT / relative).as_uri() + "?mode=ro"
                with sqlite3.connect(uri, uri=True) as connection:
                    self.assertEqual(
                        connection.execute("PRAGMA integrity_check").fetchone()[0],
                        "ok",
                    )
                    tables = {
                        row[0] for row in connection.execute(
                            "SELECT name FROM sqlite_master WHERE type = 'table'"
                        )
                    }
                    self.assertTrue(required.issubset(tables))


@unittest.skipIf(bool(MISSING), "Missing backend packages: " + ", ".join(MISSING))
class BackendRuntimeChecks(unittest.TestCase):
    def test_anomaly_rules(self):
        from api import Supplier, detect_anomalies

        suppliers = [
            Supplier(
                name=f"Fixture {index}", product_price_rm=price,
                shipping_rm=shipping, delivery_days=2, distance_km=5,
                total_cost_rm=total, route_status=route,
            )
            for index, (price, shipping, total, route) in enumerate([
                (100, 10, 110, "OK"), (100, 10, 200, "FAILED"),
                (100, 10, 110, "OK"), (1000, 100, 1100, "OK"),
            ])
        ]
        types = {warning["type"] for warning in detect_anomalies(suppliers)}
        self.assertEqual(types, {
            "TOTAL_COST_MISMATCH", "INVALID_ROUTE", "UNUSUALLY_HIGH_PRICE",
            "UNUSUALLY_HIGH_SHIPPING",
        })

    def test_advice_excludes_failed_routes_and_recalculates_totals(self):
        from api import AdviceRequest, Supplier, supplier_advice

        request = AdviceRequest(
            suppliers=[
                Supplier(
                    name="Valid fixture", product_price_rm=20, shipping_rm=5,
                    delivery_days=2, distance_km=4, total_cost_rm=999,
                ),
                Supplier(
                    name="Failed route", product_price_rm=10, shipping_rm=1,
                    delivery_days=1, distance_km=2, route_status="FAILED",
                ),
            ],
            budget=30, max_delivery_days=3,
        )
        with patch("api.get_smart_advice", return_value="Mock advice") as advice:
            result = supplier_advice(request)
        self.assertEqual(result["suppliers"][0]["total_cost_rm"], 25)
        self.assertEqual(result["ai_status"], "success")
        self.assertEqual(len(advice.call_args.kwargs["suppliers"]), 1)

    def test_distance_units_with_mocked_osrm(self):
        from distance import get_distance

        response = Mock()
        response.json.return_value = {
            "code": "Ok", "routes": [{"distance": 12345, "duration": 600}],
        }
        with patch("distance.requests.get", return_value=response) as request:
            self.assertEqual(get_distance((101, 3), (102, 4)), {
                "distance_km": 12.35, "duration_minutes": 10.0,
            })
        response.raise_for_status.assert_called_once()
        self.assertEqual(request.call_args.kwargs["timeout"], 20)
        response.json.return_value = {"code": "NoRoute", "routes": []}
        with patch("distance.requests.get", return_value=response):
            with self.assertRaises(ValueError):
                get_distance((101, 3), (102, 4))

    def make_catalogue(self, filename):
        from src import database_w_input as catalogue

        with patch.object(catalogue, "DB_NAME", filename):
            with contextlib.redirect_stdout(io.StringIO()):
                catalogue.create_database()
        with sqlite3.connect(filename) as connection:
            connection.executescript("""
                INSERT INTO businesses VALUES (1, 'Fixture business', 'Fixture', 3, 101);
                INSERT INTO suppliers VALUES (1, 'Fixture supplier', '', 'Fixture', 3, 101);
                INSERT INTO stationery VALUES (1, 'Fixture pens', 'unit');
                INSERT INTO supplier_offers VALUES (1, 1, 1, 2, 5, '12:00:00');
                INSERT INTO supplier_distances VALUES (1, 1, 10, 20, 'OK');
            """)
        return catalogue

    def test_catalogue_recommendations_use_isolated_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            filename = str(Path(temporary) / "catalogue.db")
            catalogue = self.make_catalogue(filename)
            with patch.object(catalogue, "DB_NAME", filename):
                result = catalogue.get_supplier_recommendations(1, "Fixture pens", 10)
                self.assertEqual(result[0]["total_cost_rm"], 25)
                self.assertEqual(result[0]["rank"], 1)
                self.assertEqual(
                    catalogue.get_supplier_recommendations(2, "Fixture pens", 10), [],
                )
                with self.assertRaises(ValueError):
                    catalogue.get_supplier_recommendations(1, "Fixture pens", 0)

    def test_emergency_selection_and_decision_use_isolated_database(self):
        from fastapi import HTTPException
        from src import emergency_orders as emergency

        with tempfile.TemporaryDirectory() as temporary:
            filename = str(Path(temporary) / "emergency.db")
            self.make_catalogue(filename)
            with patch.object(emergency, "DB_NAME", filename):
                emergency.initialize_database()
                result = emergency.create_emergency_purchase(
                    emergency.EmergencyPurchaseRequest(
                        business_id=1, item_name="Fixture pens", quantity=10,
                        required_delivery_time=time(18), max_distance_km=20,
                    ),
                )
                self.assertEqual(result["status"], "Pending Approval")
                self.assertEqual(result["total_cost_rm"], 25)
                decision = emergency.PurchaseDecision(decision="Approved")
                emergency.decide_purchase(result["purchase_id"], decision)
                self.assertEqual(
                    emergency.get_purchase(result["purchase_id"])["status"], "Approved",
                )
                with self.assertRaises(HTTPException) as error:
                    emergency.decide_purchase(result["purchase_id"], decision)
                self.assertEqual(error.exception.status_code, 409)

    def test_gemini_request_without_live_network(self):
        import ai_advisor

        client = Mock()
        client.models.generate_content.return_value.text = "Fixture advice"
        client.models.generate_content.return_value.candidates = []
        with patch.object(ai_advisor, "client", client):
            result = ai_advisor.get_smart_advice(
                suppliers=[{
                    "name": "Fixture supplier", "product_price_rm": 20,
                    "shipping_rm": 5, "delivery_days": 2, "distance_km": 10,
                }],
                budget=30, max_delivery_days=3,
            )
        self.assertEqual(result, "Fixture advice")
        self.assertIn("25", client.models.generate_content.call_args.kwargs["contents"])


if __name__ == "__main__":
    unittest.main()
