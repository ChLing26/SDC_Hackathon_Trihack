"""Request-boundary and data-isolation checks; no live credentials or APIs."""

from contextlib import contextmanager
import os
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.backend_database import (
    SNAPSHOT, configured_database_path, database_connection, open_database,
)
import test_backend_integration as fixtures

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "isolated-fixture-service-token-not-a-real-secret"
HEADERS = {"Authorization": "Bearer " + TOKEN}
PAYLOAD = {
    "suppliers": [{
        "name": "Fixture supplier", "product_price_rm": 20, "shipping_rm": 5,
        "delivery_days": 2, "distance_km": 4,
    }],
    "budget": 30, "max_delivery_days": 3,
}


@contextmanager
def emergency_client():
    from src import emergency_orders
    with tempfile.TemporaryDirectory() as directory:
        filename = str(Path(directory) / "runtime.db")
        fixtures.BackendRuntimeChecks().make_catalogue(filename)
        with patch.object(emergency_orders, "DB_NAME", filename):
            with TestClient(emergency_orders.app) as client:
                yield client


class AuthenticationChecks(unittest.TestCase):
    def test_both_apis_fail_closed_without_configuration(self):
        from api import app
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": ""}):
            with TestClient(app) as client:
                self.assertEqual(client.post("/supplier-advice", json=PAYLOAD).status_code, 503)
            with emergency_client() as client:
                self.assertEqual(client.get("/emergency-purchases").status_code, 503)

    def test_missing_wrong_and_query_credentials_are_rejected(self):
        from api import app
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client:
                for headers in ({}, {"Authorization": "Bearer invalid"},
                                {"Authorization": "Basic invalid"}):
                    response = client.post("/supplier-advice", json=PAYLOAD, headers=headers)
                    self.assertEqual(response.status_code, 401)
                    self.assertNotIn(TOKEN, response.text)
                self.assertEqual(client.post(
                    "/supplier-advice?token=" + TOKEN, json=PAYLOAD,
                ).status_code, 401)
            with emergency_client() as client:
                for method, path, payload in (
                    ("get", "/emergency-purchases", None),
                    ("get", "/emergency-purchases/1", None),
                    ("post", "/emergency-purchases", {}),
                    ("post", "/emergency-purchases/1/decision", {}),
                ):
                    kwargs = {"json": payload} if payload is not None else {}
                    self.assertEqual(
                        getattr(client, method)(path, **kwargs).status_code, 401,
                    )

    def test_valid_private_service_can_validate_and_decide_fixture_purchase(self):
        from api import app
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client, patch(
                "api.get_smart_advice", return_value="Fixture advice",
            ):
                response = client.post("/supplier-advice", headers=HEADERS, json=PAYLOAD)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["ai_status"], "success")
            with emergency_client() as client:
                response = client.post("/emergency-purchases", headers=HEADERS, json={
                    "business_id": 1, "item_name": "Fixture pens", "quantity": 10,
                    "required_delivery_time": "18:00:00",
                })
                self.assertEqual(response.status_code, 201)
                purchase_id = response.json()["purchase_id"]
                url = f"/emergency-purchases/{purchase_id}/decision"
                self.assertEqual(client.post(
                    url, headers=HEADERS, json={"decision": "Approved"},
                ).status_code, 200)
                self.assertEqual(client.post(
                    url, headers=HEADERS, json={"decision": "Rejected"},
                ).status_code, 409)
                self.assertEqual(client.get(
                    f"/emergency-purchases/{purchase_id}", headers=HEADERS,
                ).json()["status"], "Approved")

    def test_no_browser_cors_or_public_schema(self):
        from api import app
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client:
                for route in ("/docs", "/redoc", "/openapi.json"):
                    self.assertEqual(client.get(route).status_code, 404)
                response = client.options("/supplier-advice", headers={
                    "Origin": "https://untrusted.invalid",
                    "Access-Control-Request-Method": "POST",
                })
                self.assertNotIn("access-control-allow-origin", response.headers)

    def test_invalid_input_is_rejected_before_ai(self):
        from api import app
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client, patch("api.get_smart_advice") as advice:
                for payload in (
                    {**PAYLOAD, "budget": -1},
                    {**PAYLOAD, "budget": "NaN"},
                    {**PAYLOAD, "budget": "Infinity"},
                    {**PAYLOAD, "suppliers": []},
                    {**PAYLOAD, "suppliers": PAYLOAD["suppliers"] * 101},
                    {**PAYLOAD, "extra_untrusted": True},
                ):
                    self.assertEqual(client.post(
                        "/supplier-advice", json=payload, headers=HEADERS,
                    ).status_code, 422)
                advice.assert_not_called()

    def test_missing_key_and_provider_failure_are_not_success(self):
        from api import app
        import ai_advisor
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            with TestClient(app) as client, patch.object(ai_advisor, "client", None):
                response = client.post("/supplier-advice", headers=HEADERS, json=PAYLOAD)
                self.assertEqual(response.json()["ai_status"], "unavailable")
                self.assertEqual(response.json()["ai_failure"], {
                    "category": "configuration", "http_status": None,
                })
                self.assertEqual(response.json()["suppliers"][0]["total_cost_rm"], 25)
            with TestClient(app) as client, patch(
                "api.get_smart_advice", side_effect=RuntimeError("private-provider-detail"),
            ):
                response = client.post("/supplier-advice", headers=HEADERS, json=PAYLOAD)
                self.assertEqual(response.json()["ai_status"], "failed")
                self.assertNotIn("private-provider-detail", response.text)
                self.assertEqual(response.json()["ai_failure"], {
                    "category": "provider", "http_status": 502,
                })

    def test_safe_provider_categories_and_statuses_never_include_raw_details(self):
        from api import app
        from ai_advisor import GeminiProviderError
        cases = (
            ("quota", 429), ("permission", 403), ("model", 404),
            ("timeout", 504), ("provider", 502),
        )
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}):
            for category, status in cases:
                with self.subTest(category=category), TestClient(app) as client, patch(
                    "api.get_smart_advice",
                    side_effect=GeminiProviderError(category, status),
                ):
                    response = client.post("/supplier-advice", headers=HEADERS, json=PAYLOAD)
                    self.assertEqual(response.status_code, 200)
                    body = response.json()
                    self.assertEqual(body["ai_status"], "failed")
                    self.assertEqual(body["ai_failure"], {
                        "category": category, "http_status": status,
                    })
                    self.assertEqual(set(body["ai_failure"]), {"category", "http_status"})
                    serialized_failure = json.dumps(body["ai_failure"])
                    self.assertNotIn(TOKEN, serialized_failure)
                    self.assertNotIn("private-provider-detail", serialized_failure)
                    self.assertNotIn("Fixture supplier", serialized_failure)
                    self.assertNotIn("private-provider-detail", body["ai_advice"])
                    self.assertEqual(body["suppliers"][0]["total_cost_rm"], 25)
                    self.assertEqual(body["suppliers"][0]["within_budget"], True)

        from ai_advisor import classify_gemini_error
        unsafe = classify_gemini_error(type("ProviderError", (Exception,), {"code": 799})("sensitive body"))
        self.assertEqual((unsafe.category, unsafe.http_status), ("provider", 502))


class DatabaseAndEntryPointChecks(unittest.TestCase):
    def test_default_database_is_independent_of_cwd_and_postgres_url(self):
        with patch.dict(os.environ, {
            "PYTHON_SQLITE_PATH": "", "DATABASE_URL": "postgresql://fixture.invalid/app",
        }):
            self.assertEqual(configured_database_path(), str(SNAPSHOT))
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([
                sys.executable, "-c",
                "from src.backend_database import configured_database_path; "
                "print(configured_database_path())",
            ], cwd=directory, env={
                **os.environ, "PYTHONPATH": str(ROOT) + os.pathsep + os.environ.get("PYTHONPATH", ""),
                "PYTHON_SQLITE_PATH": "",
            }, capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), str(SNAPSHOT))
        with patch.dict(os.environ, {"PYTHON_SQLITE_PATH": "relative.db"}):
            with self.assertRaises(RuntimeError):
                configured_database_path()

    def test_snapshots_reject_writes_and_allow_read_only_queries(self):
        for path in (SNAPSHOT, ROOT / "backups/business_supplier_selection_backup.db"):
            with self.assertRaises(RuntimeError):
                open_database(path, writable=True)
            with database_connection(path) as connection:
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                with self.assertRaises(sqlite3.OperationalError):
                    connection.execute("CREATE TABLE forbidden_write (id INTEGER)")

    def test_wrong_or_missing_database_does_not_silently_initialize(self):
        from src import emergency_orders
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.db"
            with self.assertRaises(sqlite3.OperationalError):
                open_database(path, writable=True)
            self.assertFalse(path.exists())
            with sqlite3.connect(path):
                pass
            with patch.object(emergency_orders, "DB_NAME", str(path)):
                with self.assertRaisesRegex(RuntimeError, "supplier catalogue"):
                    emergency_orders.initialize_database()

    def test_recommendation_parameter_does_not_execute_sql(self):
        from src import database_w_input as catalogue
        with patch.object(catalogue, "DB_NAME", str(SNAPSHOT)):
            self.assertEqual(catalogue.get_supplier_recommendations(
                1, "'; DROP TABLE supplier_offers; --", 10,
            ), [])
            for quantity in (0, -1, float("nan"), float("inf")):
                with self.assertRaises(ValueError):
                    catalogue.get_supplier_recommendations(1, "Fixture pens", quantity)
            with database_connection(SNAPSHOT) as connection:
                connection.execute("SELECT COUNT(*) FROM supplier_offers").fetchone()

    def test_entry_points_have_no_missing_utils_and_launch_only_on_loopback(self):
        for args in (["-m", "src.main", "--help"], ["main.py", "--help"]):
            result = subprocess.run([sys.executable, *args], cwd=ROOT,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(
            [sys.executable, "-m", "src.main"], cwd=ROOT,
            env={**os.environ, "PYTHON_BACKEND_TOKEN": ""},
            capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PYTHON_BACKEND_TOKEN", result.stderr)
        with patch.dict(os.environ, {"PYTHON_BACKEND_TOKEN": TOKEN}), patch(
            "sys.argv", ["backend", "--service", "advice", "--port", "8000"],
        ), patch("uvicorn.run") as run:
            from src.main import main
            main()
            self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")
            self.assertEqual(run.call_args.args[0], "api:app")
