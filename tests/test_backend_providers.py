"""Offline failure/validation tests; live probes are reported separately."""

import base64
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from google import genai
from google.genai import errors, types

import ai_advisor
from ai_advisor import AIConfigurationError, GeminiProviderError, get_smart_advice
from distance import get_distance

SUPPLIERS = [{
    "name": "Fixture", "product_price_rm": 20, "shipping_rm": 5,
    "delivery_days": 2, "distance_km": 4,
}]


class ProviderChecks(unittest.TestCase):
    def test_ineligible_recommendations_are_replaced_with_constraint_checked_advice(self):
        suppliers = [
            {
                "quote_id": "ok-quote",
                "name": "Allowed vendor",
                "product_price_rm": 20,
                "shipping_rm": 5,
                "delivery_days": 2,
                "distance_km": 4,
            },
            {
                "quote_id": "over-budget",
                "name": "Over budget vendor",
                "product_price_rm": 30,
                "shipping_rm": 5,
                "delivery_days": 2,
                "distance_km": 3,
            },
            {
                "quote_id": "too-slow",
                "name": "Late vendor",
                "product_price_rm": 20,
                "shipping_rm": 5,
                "delivery_days": 4,
                "distance_km": 2,
            },
        ]
        client = Mock()
        client.models.generate_content.return_value = SimpleNamespace(
            text=(
                "Recommend Over budget vendor (over-budget) and Late vendor "
                "(too-slow). They meet the requirements."
            ),
            candidates=[],
        )

        with patch("ai_advisor.client", client):
            advice = get_smart_advice(suppliers, budget=30, max_delivery_days=3)

        self.assertIn("Only the following quotes meet both requirements", advice)
        self.assertIn("ok-quote: RM 25.00 total, 2.0 days delivery", advice)
        self.assertIn("maximum total budget of RM 30.00", advice)
        self.assertIn("delivery within 3 days", advice)
        self.assertNotIn("Over budget vendor", advice)
        self.assertNotIn("Late vendor", advice)
        self.assertNotIn("over-budget", advice)
        self.assertNotIn("too-slow", advice)

    def test_ineligible_recommendation_with_no_eligible_quotes_returns_no_recommendation(self):
        client = Mock()
        client.models.generate_content.return_value = SimpleNamespace(
            text="Recommend Fixture because it is the best supplier.",
            candidates=[],
        )

        with patch("ai_advisor.client", client):
            advice = get_smart_advice(
                [dict(SUPPLIERS[0], quote_id="fixture-quote")],
                budget=10,
                max_delivery_days=1,
            )

        self.assertIn("No supplier meets both requirements", advice)
        self.assertIn("maximum total budget of RM 10.00", advice)
        self.assertIn("delivery within 1 days", advice)
        self.assertIn("No supplier can be recommended", advice)
        self.assertNotIn("Recommend Fixture", advice)

    def test_missing_gemini_configuration_raises(self):
        with patch("ai_advisor.client", None):
            with self.assertRaises(AIConfigurationError):
                get_smart_advice(SUPPLIERS, 30, 3)

    def test_empty_and_failed_gemini_response_is_sanitized(self):
        client = Mock()
        client.models.generate_content.return_value.text = ""
        with patch("ai_advisor.client", client):
            with self.assertRaisesRegex(GeminiProviderError, "^Gemini advice is temporarily unavailable.$") as empty:
                get_smart_advice(SUPPLIERS, 30, 3)
            self.assertEqual((empty.exception.category, empty.exception.http_status), ("provider", 502))
            client.models.generate_content.side_effect = RuntimeError("do-not-leak-provider-body")
            with self.assertRaisesRegex(GeminiProviderError, "^Gemini advice is temporarily unavailable.$") as failed:
                get_smart_advice(SUPPLIERS, 30, 3)
            self.assertEqual((failed.exception.category, failed.exception.http_status), ("provider", 502))

    def test_transient_gemini_failure_is_not_retried(self):
        requests = []

        def unavailable(request):
            requests.append(request)
            return httpx.Response(
                503,
                json={"error": {"code": 503, "message": "fixture outage"}},
            )

        sdk_client = genai.Client(
            api_key="offline-test-key",
            http_options=types.HttpOptions(
                timeout=ai_advisor.GEMINI_REQUEST_TIMEOUT_MS,
                retry_options=types.HttpRetryOptions(
                    attempts=2,
                    initial_delay=0,
                    max_delay=0,
                    jitter=0,
                ),
                client_args={
                    "transport": httpx.MockTransport(unavailable),
                },
            ),
        )
        try:
            with patch.object(ai_advisor, "client", sdk_client):
                with self.assertRaises(GeminiProviderError):
                    get_smart_advice(SUPPLIERS, 30, 3)
            self.assertEqual(len(requests), 1)
        finally:
            sdk_client.close()

    def test_structured_unavailable_status_is_classified_as_503(self):
        failure = ai_advisor.classify_gemini_error(
            errors.ServerError(0, {"error": {"status": "UNAVAILABLE"}}),
        )
        self.assertEqual((failure.category, failure.http_status), ("provider", 503))
        self.assertIsNone(failure.upstream_http_status)

    def test_local_timeouts_use_types_not_exception_names(self):
        misleading = type("TimeoutConfigurationError", (Exception,), {})
        for error in (
            httpx.ReadTimeout("private-detail"),
            httpx.ConnectTimeout("private-detail"),
            TimeoutError("private-detail"),
        ):
            with self.subTest(exception=type(error).__name__):
                failure = ai_advisor.classify_gemini_error(error)
                self.assertEqual((failure.category, failure.http_status), ("timeout", 504))
                self.assertIsNone(failure.upstream_http_status)
        for error in (
            misleading("private-detail"),
            httpx.ConnectError("private-detail"),
            RuntimeError("private-detail"),
        ):
            with self.subTest(exception=type(error).__name__):
                failure = ai_advisor.classify_gemini_error(error)
                self.assertEqual((failure.category, failure.http_status), ("provider", 502))
                self.assertIsNone(failure.upstream_http_status)

    def test_upstream_http_status_is_preserved_separately_from_classification(self):
        for status in (503, 504):
            with self.subTest(status=status):
                error = errors.ServerError(
                    status,
                    {"error": {"status": "UNAVAILABLE", "message": "private-detail"}},
                    response=httpx.Response(status),
                )
                failure = ai_advisor.classify_gemini_error(error)
                self.assertEqual((failure.category, failure.http_status), ("provider", status))
                self.assertEqual(failure.upstream_http_status, status)
                self.assertNotIn("private-detail", str(failure))
        # The actual response takes precedence over disagreeing structured fields.
        failure = ai_advisor.classify_gemini_error(errors.ServerError(
            504, {"error": {"status": "DEADLINE_EXCEEDED"}},
            response=httpx.Response(503),
        ))
        self.assertEqual((failure.category, failure.http_status), ("provider", 503))
        self.assertEqual(failure.upstream_http_status, 503)
        failure = ai_advisor.classify_gemini_error(errors.ServerError(
            504, {"error": {"status": "DEADLINE_EXCEEDED"}},
        ))
        self.assertEqual((failure.category, failure.http_status), ("provider", 504))
        self.assertIsNone(failure.upstream_http_status)

    def test_advice_api_survives_provider_failures_and_recovers(self):
        from fastapi.testclient import TestClient
        from api import app

        token = "offline-fixture-private-service-token"
        headers = {"Authorization": "Bearer " + token}
        private_detail = "fixture-private-provider-detail"
        payload = {
            "suppliers": [dict(
                SUPPLIERS[0], quote_id="fixture", total_cost_rm=999,
            )],
            "budget": 30, "max_delivery_days": 3,
        }
        scenarios = (
            ("unavailable", 503, "provider"),
            ("deadline", 504, "provider"),
            ("transport_timeout", 504, "timeout"),
            ("connection", 502, "provider"),
            ("unexpected", 502, "provider"),
            ("misleading_timeout_name", 502, "provider"),
        )
        for scenario, failure_status, category in scenarios:
            with self.subTest(scenario=scenario):
                requests = []

                def provider(request):
                    requests.append(request)
                    if len(requests) == 1:
                        if scenario == "transport_timeout":
                            raise httpx.ReadTimeout(private_detail, request=request)
                        if scenario == "connection":
                            raise httpx.ConnectError(private_detail, request=request)
                        if scenario == "unexpected":
                            raise RuntimeError(private_detail)
                        if scenario == "misleading_timeout_name":
                            raise type("TimeoutConfigurationError", (Exception,), {})(private_detail)
                        return httpx.Response(
                            failure_status,
                            json={"error": {
                                "code": failure_status,
                                "status": (
                                    "UNAVAILABLE" if failure_status == 503
                                    else "DEADLINE_EXCEEDED"
                                ),
                                "message": private_detail,
                            }},
                        )
                    return httpx.Response(200, json={
                        "candidates": [{
                            "content": {
                                "role": "model",
                                "parts": [{"text": "Fixture meets both requirements."}],
                            },
                            "finishReason": "STOP",
                        }],
                    })

                sdk_client = genai.Client(
                    api_key="offline-test-key",
                    http_options=types.HttpOptions(
                        client_args={"transport": httpx.MockTransport(provider)},
                    ),
                )
                try:
                    with (
                        patch.object(ai_advisor, "client", sdk_client),
                        patch(
                            "src.backend_security.configured_service_token",
                            return_value=token,
                        ),
                        TestClient(app) as client,
                    ):
                        response = client.post(
                            "/supplier-advice", headers=headers, json=payload,
                        )
                        self.assertEqual(response.status_code, 200)
                        result = response.json()
                        self.assertEqual(result["ai_status"], "failed")
                        self.assertEqual(result["ai_failure"], {
                            "category": category, "http_status": failure_status,
                        })
                        self.assertEqual(len(requests), 1)
                        self.assertNotIn(private_detail, response.text)
                        self.assertNotIn(token, response.text)
                        self.assertIn("still available", result["ai_advice"])
                        supplier = result["suppliers"][0]
                        self.assertEqual(supplier["total_cost_rm"], 25)
                        self.assertTrue(supplier["within_budget"])
                        self.assertTrue(supplier["meets_delivery_requirement"])
                        self.assertTrue(supplier["anomalies"])
                        self.assertGreater(result["warning_count"], 0)
                        if failure_status == 503:
                            self.assertIn(
                                "Gemini AI is temporarily unavailable",
                                result["ai_advice"],
                            )
                            self.assertIn("try again later", result["ai_advice"])

                        health = client.get("/", headers=headers)
                        self.assertEqual(health.status_code, 200)
                        self.assertEqual(health.json()["status"], "running")
                        self.assertEqual(len(requests), 1)
                        recovered = client.post(
                            "/supplier-advice", headers=headers, json=payload,
                        )
                        self.assertEqual(recovered.status_code, 200)
                        self.assertEqual(recovered.json()["ai_status"], "success")
                        self.assertIsNone(recovered.json()["ai_failure"])
                        self.assertEqual(
                            recovered.json()["ai_advice"], "Fixture meets both requirements.",
                        )
                        self.assertEqual(len(requests), 2)
                finally:
                    sdk_client.close()

    def test_continuation_response_does_not_trigger_another_provider_request(self):
        requests = []

        def requires_continuation(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{"text": "Incomplete supplier advice."}],
                        },
                        "finishReason": "CONTINUATION",
                        "continuationToken": base64.b64encode(
                            b"offline-continuation-token"
                        ).decode("ascii"),
                    }],
                },
            )

        sdk_client = genai.Client(
            api_key="offline-test-key",
            http_options=types.HttpOptions(
                client_args={
                    "transport": httpx.MockTransport(requires_continuation),
                },
            ),
        )
        try:
            with patch.object(ai_advisor, "client", sdk_client):
                with self.assertRaisesRegex(
                    GeminiProviderError,
                    "^Gemini advice is temporarily unavailable.$",
                ):
                    get_smart_advice(SUPPLIERS, 30, 3)
            self.assertEqual(len(requests), 1)
        finally:
            sdk_client.close()

    def test_nonfinite_ai_data_is_rejected_before_network(self):
        with patch("ai_advisor.client") as client:
            for supplier in (
                {**SUPPLIERS[0], "product_price_rm": float("nan")},
                {**SUPPLIERS[0], "shipping_rm": float("inf")},
            ):
                with self.assertRaises(ValueError):
                    get_smart_advice([supplier], 30, 3)
            client.models.generate_content.assert_not_called()

    def test_invalid_coordinates_do_not_call_osrm(self):
        with patch("distance.requests.get") as request:
            for coordinates in ((0, 91), (181, 0), (float("nan"), 0), (1,), "bad"):
                with self.assertRaises(ValueError):
                    get_distance(coordinates, (101, 3))
            request.assert_not_called()

    def test_invalid_osrm_response_is_not_a_success(self):
        response = Mock()
        for route in (
            {}, {"distance": -1, "duration": 10},
            {"distance": float("inf"), "duration": 10},
        ):
            response.json.return_value = {"code": "Ok", "routes": [route]}
            with patch("distance.requests.get", return_value=response):
                with self.assertRaises(ValueError):
                    get_distance((101, 3), (102, 4))
