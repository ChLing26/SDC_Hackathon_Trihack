"""Offline failure/validation tests; live probes are reported separately."""

import unittest
from unittest.mock import Mock, patch

from ai_advisor import AIConfigurationError, get_smart_advice
from distance import get_distance

SUPPLIERS = [{
    "name": "Fixture", "product_price_rm": 20, "shipping_rm": 5,
    "delivery_days": 2, "distance_km": 4,
}]


class ProviderChecks(unittest.TestCase):
    def test_missing_gemini_configuration_raises(self):
        with patch("ai_advisor.client", None):
            with self.assertRaises(AIConfigurationError):
                get_smart_advice(SUPPLIERS, 30, 3)

    def test_empty_and_failed_gemini_response_is_sanitized(self):
        client = Mock()
        client.models.generate_content.return_value.text = ""
        with patch("ai_advisor.client", client):
            with self.assertRaisesRegex(RuntimeError, "^Gemini request failed.$"):
                get_smart_advice(SUPPLIERS, 30, 3)
            client.models.generate_content.side_effect = RuntimeError("do-not-leak-provider-body")
            with self.assertRaisesRegex(RuntimeError, "^Gemini request failed.$"):
                get_smart_advice(SUPPLIERS, 30, 3)

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
