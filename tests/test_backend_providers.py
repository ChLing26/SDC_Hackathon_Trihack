"""Offline failure/validation tests; live probes are reported separately."""

import base64
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from google import genai
from google.genai import types

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
