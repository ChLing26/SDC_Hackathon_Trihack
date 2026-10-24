"""Real loopback Uvicorn smoke checks using temporary DBs and fixture auth."""

from contextlib import contextmanager
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

import requests
import test_backend_integration as fixtures

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "private-http-test-fixture-not-a-real-credential"
HEADERS = {"Authorization": "Bearer " + TOKEN}


@contextmanager
def private_server(service):
    with tempfile.TemporaryDirectory() as directory:
        filename = str(Path(directory) / "runtime.db")
        fixtures.BackendRuntimeChecks().make_catalogue(filename)
        with socket.socket() as socket_:
            socket_.bind(("127.0.0.1", 0))
            port = socket_.getsockname()[1]
        environment = {
            **os.environ,
            "PYTHON_BACKEND_TOKEN": TOKEN,
            "PYTHON_SQLITE_PATH": filename,
            # This smoke check must not invoke a paid live model.
            "GEMINI_API_KEY": "",
        }
        process = subprocess.Popen(
            [sys.executable, "-m", "src.main", "--service", service, "--port", str(port)],
            cwd=ROOT, env=environment,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(f"Private {service} server exited before startup.")
                try:
                    if requests.get(base + "/", headers=HEADERS, timeout=0.5).status_code == 200:
                        break
                except requests.RequestException:
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError(f"Private {service} server did not become ready.")
            yield base
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


class LoopbackServerChecks(unittest.TestCase):
    def test_real_advice_server_auth_and_unavailable_ai(self):
        with private_server("advice") as base:
            self.assertEqual(requests.get(base + "/", timeout=3).status_code, 401)
            response = requests.post(base + "/supplier-advice", headers=HEADERS, json={
                "suppliers": [{
                    "name": "Fixture", "product_price_rm": 20, "shipping_rm": 5,
                    "delivery_days": 2, "distance_km": 4,
                }],
                "budget": 30, "max_delivery_days": 3,
            }, timeout=3)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["ai_status"], "unavailable")
            self.assertEqual(response.json()["suppliers"][0]["total_cost_rm"], 25)

    def test_real_emergency_server_creates_and_approves_only_fixture(self):
        with private_server("emergency") as base:
            url = base + "/emergency-purchases"
            self.assertEqual(requests.get(url, timeout=3).status_code, 401)
            response = requests.post(url, headers=HEADERS, json={
                "business_id": 1, "item_name": "Fixture pens", "quantity": 10,
                "required_delivery_time": "18:00:00",
            }, timeout=3)
            self.assertEqual(response.status_code, 201)
            purchase_id = response.json()["purchase_id"]
            response = requests.post(
                f"{url}/{purchase_id}/decision", headers=HEADERS,
                json={"decision": "Approved"}, timeout=3,
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "Approved")
