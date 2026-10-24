"""Regression coverage for overflow and quote-identity fixes; fixture data only."""

from contextlib import redirect_stdout
from datetime import time
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from src.api.advice import app, supplier_advice
from src.models.advice import AdviceRequest, Supplier
from src.services.anomalies import detect_anomalies
from src.services.numbers import MAX_MONEY, MAX_QUANTITY, checked_total
import test_backend_integration as fixtures

TOKEN = "isolated-overflow-quote-regression-fixture-token"


def quote(**changes):
    return Supplier(name="Same supplier", product_price_rm=20, shipping_rm=5,
                    delivery_days=2, distance_km=4, **changes)


class MoneyRegressions(unittest.TestCase):
    def test_checked_money_rejects_overflow_and_nonfinite_inputs(self):
        for price, shipping, quantity in (
            (1e308, 1e308, 1), (MAX_MONEY, 1, 1),
            (MAX_MONEY, 0, 2), (1, 0, MAX_QUANTITY + 1),
            (float("inf"), 0, 1), (float("nan"), 0, 1), (-1, 0, 1),
        ):
            with self.subTest(values=(price, shipping, quantity)):
                with self.assertRaises(ValueError):
                    checked_total(price, shipping, quantity)

    def test_decimal_rounding_and_valid_limit_remain_json_safe(self):
        self.assertEqual(checked_total("0.1", "0.2"), 0.3)
        self.assertEqual(checked_total("0.335", "0.005", 3), 1.01)
        self.assertEqual(checked_total(MAX_MONEY, 0), MAX_MONEY)
        json.dumps({"total": checked_total(MAX_MONEY, 0)}, allow_nan=False)

    def test_http_rejects_extreme_and_combined_prices_before_ai(self):
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client, patch("src.services.advice.get_smart_advice") as ai:
                for price, shipping, budget in (
                    (1e308, 1e308, 30), (MAX_MONEY, 1, MAX_MONEY),
                    (20, 5, 1e308),
                ):
                    response = client.post("/supplier-advice",
                        headers={"Authorization": "Bearer " + TOKEN}, json={
                            "suppliers": [{
                                "name": "Fixture", "product_price_rm": price,
                                "shipping_rm": shipping, "delivery_days": 2,
                                "distance_km": 4,
                            }], "budget": budget, "max_delivery_days": 3,
                        })
                    self.assertEqual(response.status_code, 422)
                ai.assert_not_called()

    def test_direct_ai_rejects_unsafe_values_without_provider_request(self):
        import src.services.ai_advisor as ai_advisor
        client = Mock()
        with patch.object(ai_advisor, "client", client):
            for price, budget in ((1e308, 30), (20, 1e308)):
                with self.assertRaises(ValueError):
                    ai_advisor.get_smart_advice([{
                        "name": "Fixture", "product_price_rm": price,
                        "shipping_rm": 5, "delivery_days": 2, "distance_km": 4,
                    }], budget, 3)
            client.models.generate_content.assert_not_called()

    def test_catalogue_and_cli_reject_invalid_stored_prices(self):
        from scripts.python.catalogue_demo import recommend_supplier

        with tempfile.TemporaryDirectory() as directory:
            filename = str(Path(directory) / "fixture.db")
            catalogue = fixtures.BackendRuntimeChecks().make_catalogue(filename)
            with sqlite3.connect(filename) as connection:
                connection.execute("UPDATE supplier_offers SET unit_price = ?", (1e308,))
            with patch.object(catalogue, "DB_NAME", filename):
                for function in (
                    catalogue.get_supplier_recommendations,
                    recommend_supplier,
                ):
                    with self.assertRaises(ValueError), redirect_stdout(io.StringIO()):
                        function(1, "Fixture pens", 10)

    def test_emergency_rejects_invalid_quote_without_creating_purchase(self):
        from src.database import emergency as emergency_database
        from src.models.emergency import EmergencyPurchaseRequest
        from src.services import emergency
        with tempfile.TemporaryDirectory() as directory:
            filename = str(Path(directory) / "fixture.db")
            fixtures.BackendRuntimeChecks().make_catalogue(filename)
            with sqlite3.connect(filename) as connection:
                connection.execute("UPDATE supplier_offers SET unit_price = ?", (1e308,))
            with patch.object(emergency_database, "DB_NAME", filename):
                emergency_database.initialize_database()
                with self.assertRaises(HTTPException) as error:
                    emergency.create_emergency_purchase(EmergencyPurchaseRequest(
                        business_id=1, item_name="Fixture pens", quantity=10,
                        required_delivery_time=time(18),
                    ))
                self.assertEqual(error.exception.status_code, 409)
                with sqlite3.connect(filename) as connection:
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM emergency_purchases").fetchone()[0], 0,
                    )
                with self.assertRaises(ValidationError):
                    EmergencyPurchaseRequest(
                        business_id=1, item_name="Fixture pens",
                        quantity=MAX_QUANTITY + 1, required_delivery_time=time(18),
                    )


class QuoteIdentityRegressions(unittest.TestCase):
    def test_duplicate_names_do_not_share_mismatch_or_route_warnings(self):
        request = AdviceRequest(
            suppliers=[quote(quote_id="bad", total_cost_rm=999, route_status="FAILED"),
                       quote(quote_id="good", total_cost_rm=25)],
            budget=30, max_delivery_days=3,
        )
        with patch("src.services.advice.get_smart_advice", return_value="Fixture advice") as ai:
            result = supplier_advice(request)
        self.assertEqual([len(s["anomalies"]) for s in result["suppliers"]], [2, 0])
        self.assertEqual({w["quote_id"] for w in result["warnings"]}, {"bad"})
        self.assertEqual(ai.call_args.kwargs["suppliers"][0]["quote_id"], "good")

    def test_price_and_shipping_warnings_include_the_exact_quote_id(self):
        suppliers = [
            Supplier(quote_id=str(i), name="Repeated name", product_price_rm=price,
                     shipping_rm=shipping, delivery_days=1, distance_km=1)
            for i, (price, shipping) in enumerate([(10, 1), (10, 1), (10, 1), (100, 10)])
        ]
        warnings = detect_anomalies(suppliers)
        self.assertEqual({w["quote_id"] for w in warnings}, {"3"})
        self.assertEqual({w["type"] for w in warnings},
                         {"UNUSUALLY_HIGH_PRICE", "UNUSUALLY_HIGH_SHIPPING"})

    def test_duplicate_quote_ids_fail_validation(self):
        with self.assertRaises(ValidationError):
            AdviceRequest(suppliers=[quote(quote_id="duplicate"), quote(quote_id="duplicate")],
                          budget=30, max_delivery_days=3)
        with self.assertRaises(ValueError):
            detect_anomalies([quote(quote_id="duplicate"), quote(quote_id="duplicate")])

    def test_legacy_omitted_ids_are_unique_but_stable_within_response(self):
        suppliers = [quote(), quote()]
        self.assertNotEqual(suppliers[0].quote_id, suppliers[1].quote_id)
        request = AdviceRequest(suppliers=suppliers, budget=30, max_delivery_days=3)
        with patch("src.services.advice.get_smart_advice", return_value="Fixture advice"):
            result = supplier_advice(request)
        self.assertEqual([s["quote_id"] for s in result["suppliers"]],
                         [s.quote_id for s in suppliers])

    def test_http_duplicate_ids_fail_before_ai(self):
        payload = quote(quote_id="duplicate").model_dump()
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client, patch("src.services.advice.get_smart_advice") as ai:
                response = client.post("/supplier-advice",
                    headers={"Authorization": "Bearer " + TOKEN},
                    json={"suppliers": [payload, payload], "budget": 30, "max_delivery_days": 3})
                self.assertEqual(response.status_code, 422)
                ai.assert_not_called()
