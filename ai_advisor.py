import os
import re
from math import isfinite
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types
from src.backend_numbers import MAX_MONEY, bounded_decimal, checked_total

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

# Load local .env if available.
# Existing environment variables, such as Replit Secrets,
# take priority over values in .env.
load_dotenv(dotenv_path=ENV_PATH, override=False)

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

GEMINI_REQUEST_TIMEOUT_MS = 15_000
GEMINI_REQUEST_ATTEMPTS = 1


def _gemini_http_options():
    return types.HttpOptions(
        timeout=GEMINI_REQUEST_TIMEOUT_MS,
        retry_options=types.HttpRetryOptions(
            attempts=GEMINI_REQUEST_ATTEMPTS,
        ),
    )


# Create the client only when a key is available.
client = (
    genai.Client(api_key=API_KEY, http_options=_gemini_http_options())
    if API_KEY else None
)

MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()


class AIConfigurationError(RuntimeError):
    """Gemini has no configured credential; not a successful AI response."""


GEMINI_FAILURE_CATEGORIES = frozenset({
    "quota", "permission", "model", "timeout", "provider",
})
SAFE_PROVIDER_HTTP_STATUSES = frozenset({
    400, 401, 403, 404, 408, 409, 413, 415, 422, 429,
    500, 501, 502, 503, 504,
})


class GeminiProviderError(RuntimeError):
    """A provider failure with bounded, non-sensitive diagnostic fields only."""

    def __init__(self, category: str, http_status: int):
        if category not in GEMINI_FAILURE_CATEGORIES:
            category = "provider"
        if http_status not in SAFE_PROVIDER_HTTP_STATUSES:
            http_status = 502
        super().__init__("Gemini advice is temporarily unavailable.")
        self.category = category
        self.http_status = http_status


def classify_gemini_error(error: Exception) -> GeminiProviderError:
    """Classify SDK failures without reading messages or provider response bodies."""
    code = getattr(error, "code", None)
    provider_status = code if type(code) is int and code in SAFE_PROVIDER_HTTP_STATUSES else None
    status_name = getattr(error, "status", None)
    status_name = status_name.upper() if isinstance(status_name, str) else ""
    exception_name = type(error).__name__.lower()

    if "timeout" in exception_name or code in (408, 504) or status_name == "DEADLINE_EXCEEDED":
        return GeminiProviderError("timeout", provider_status or 504)
    if code == 429 or status_name in {"RESOURCE_EXHAUSTED", "TOO_MANY_REQUESTS"}:
        return GeminiProviderError("quota", provider_status or 429)
    if code in (401, 403) or status_name in {"UNAUTHENTICATED", "PERMISSION_DENIED"}:
        return GeminiProviderError("permission", provider_status or 403)
    if code in (400, 404, 422) or status_name in {"NOT_FOUND", "INVALID_ARGUMENT"}:
        return GeminiProviderError("model", provider_status or 404)
    return GeminiProviderError("provider", provider_status or 502)


def _mentions_supplier(text, supplier):
    """Match a supplier's stable quote ID or complete display name."""
    for value in (supplier.get("quote_id"), supplier.get("name")):
        if not value:
            continue
        if re.search(
            rf"(?<!\w){re.escape(str(value))}(?!\w)",
            text,
            flags=re.IGNORECASE,
        ):
            return True
    return False


def _safe_eligibility_advice(eligible_suppliers, budget, max_delivery_days):
    """Build a factual response without model-generated recommendations."""
    if not eligible_suppliers:
        return (
            "No supplier meets both requirements: a maximum total budget of "
            f"RM {budget:.2f} and delivery within {max_delivery_days} days. "
            "No supplier can be recommended under the current requirements."
        )

    lines = [
        "Only the following quotes meet both requirements: "
        f"a maximum total budget of RM {budget:.2f} and delivery within "
        f"{max_delivery_days} days."
    ]
    for supplier in eligible_suppliers:
        label = supplier.get("quote_id") or supplier["name"]
        lines.append(
            f"- {label}: RM {supplier['total_cost_rm']:.2f} total, "
            f"{supplier['delivery_days']} days delivery."
        )
    return "\n".join(lines)


# 2. Smart Supplier Recommendation
def get_smart_advice(
    suppliers,
    budget,
    max_delivery_days,
    priority="balanced",
    warnings=None
):

    if not isinstance(suppliers, list) or not suppliers:
        raise ValueError("Please provide at least one supplier.")

    if not isfinite(budget) or budget < 0:
        raise ValueError("Budget cannot be negative.")
    bounded_decimal(budget, MAX_MONEY, "Budget")

    if not isfinite(max_delivery_days) or max_delivery_days < 0:
        raise ValueError("Delivery days cannot be negative.")

    allowed_priorities = {
        "balanced",
        "lowest_cost",
        "fastest_delivery"
    }

    if priority not in allowed_priorities:
        raise ValueError(
            "Priority must be balanced, lowest_cost, "
            "or fastest_delivery."
        )

    # Calculate total cost and eligibility
    processed_suppliers = []

    for supplier in suppliers:
        required_fields = [
            "name",
            "product_price_rm",
            "shipping_rm",
            "delivery_days",
            "distance_km"
        ]

        missing = [
            field for field in required_fields
            if field not in supplier
        ]

        if missing:
            raise ValueError(
                f"Supplier data missing fields: {missing}"
            )

        try:
            price = float(supplier["product_price_rm"])
            shipping = float(supplier["shipping_rm"])
            delivery = float(supplier["delivery_days"])
            distance = float(supplier["distance_km"])
        except (TypeError, ValueError):
            raise ValueError(
                f"Invalid numeric data for {supplier['name']}."
            ) from None

        if (
            not all(isfinite(value) for value in (price, shipping, delivery, distance))
            or min(price, shipping, delivery, distance) < 0
        ):
            raise ValueError(
                f"Negative values found for {supplier['name']}."
            )

        total_cost = checked_total(price, shipping)

        processed_suppliers.append({
            **({"quote_id": supplier["quote_id"]} if "quote_id" in supplier else {}),
            "name": str(supplier["name"]),
            "product_price_rm": price,
            "shipping_rm": shipping,
            "total_cost_rm": round(total_cost, 2),
            "delivery_days": delivery,
            "distance_km": round(distance, 2),
            "within_budget": total_cost <= budget,
            "meets_delivery_requirement": (
                delivery <= max_delivery_days
            )
        })

    eligible_suppliers = [
        supplier
        for supplier in processed_suppliers
        if supplier["within_budget"]
        and supplier["meets_delivery_requirement"]
    ]

    warnings = warnings or []

    prompt = f"""
    You are an intelligent procurement advisor for SMEs in Malaysia.

    BUYER REQUIREMENTS
    Maximum total budget: RM {budget:.2f}
    Maximum delivery time: {max_delivery_days} days
    Priority: {priority}

    SUPPLIER DATA
    {processed_suppliers}

    SUPPLIERS MEETING BOTH BUDGET AND DELIVERY REQUIREMENTS
    {eligible_suppliers}

    PYTHON ANOMALY DETECTION WARNINGS
    {warnings}

    YOUR TASK
    1. Recommend the most suitable eligible supplier, if one can be
       recommended safely based on the available data.
    2. Explain the reasons for your recommendation.
    3. Compare total cost, delivery time, and road distance.
    4. If no supplier meets both requirements, state this clearly.
    5. If priority is lowest_cost, emphasize total cost.
    6. If priority is fastest_delivery, emphasize delivery time.
    7. If priority is balanced, consider all supplied factors.
    8. Use only the supplied data. Do not invent facts.
    9. Explain trade-offs and write concise, professional English.
    10. Explain any relevant anomaly warnings and their potential risks.
    11. A supplier with a TOTAL_COST_MISMATCH warning has an
        unverified reported total. Do not treat that reported total
        as reliable until it is checked.
    12. If a material pricing anomaly could change the recommendation,
        explain that the quote should be verified before purchase.
    13. Distinguish a warning from a confirmed error. An unusually
        high shipping fee is not automatically proof of fraud or error.
    14. Reference quote_id when supplied. Supplier names are display labels
        and may be shared by different quotes; do not merge their warnings.

    IMPORTANT
    Total cost = product price + shipping fee.
    Do not assume a shorter road distance guarantees lower shipping cost.
    Do not claim that an ineligible supplier meets the requirements.
    Python warnings are validation signals and must not be ignored.
    """

    if client is None:
        raise AIConfigurationError("GEMINI_API_KEY is not configured.")
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                http_options=_gemini_http_options(),
                automatic_continuation=False,
            ),
        )

        if any(
            candidate.finish_reason == types.FinishReason.CONTINUATION
            for candidate in (response.candidates or [])
        ):
            raise RuntimeError("Gemini returned incomplete advice.")

        if not response.text:
            raise RuntimeError("Gemini returned an empty response.")

        # The model's text is not an authority on supplier eligibility. If it
        # names any quote that fails either hard requirement, discard the
        # entire response and return a deterministic summary of eligible quotes.
        ineligible_suppliers = [
            supplier
            for supplier in processed_suppliers
            if not supplier["within_budget"]
            or not supplier["meets_delivery_requirement"]
        ]
        if any(
            _mentions_supplier(response.text, supplier)
            for supplier in ineligible_suppliers
        ):
            return _safe_eligibility_advice(
                eligible_suppliers, budget, max_delivery_days,
            )

        return response.text

    except Exception as error:
        # Only the bounded category/status escape. Never retain or expose the
        # provider exception, message, response, submitted quote, or credential.
        failure = classify_gemini_error(error)
        raise failure from None


# Test the AI Advisor

if __name__ == "__main__":

    sample_suppliers = [
        {
            "name": "Supplier A",
            "product_price_rm": 400,
            "shipping_rm": 50,
            "delivery_days": 3,
            "distance_km": 20
        },
        {
            "name": "Supplier B",
            "product_price_rm": 350,
            "shipping_rm": 100,
            "delivery_days": 2,
            "distance_km": 45
        },
        {
            "name": "Supplier C",
            "product_price_rm": 420,
            "shipping_rm": 20,
            "delivery_days": 5,
            "distance_km": 10
        }
    ]

    try:
        result = get_smart_advice(
            suppliers=sample_suppliers,
            budget=500,
            max_delivery_days=3,
            priority="balanced"
        )

        print("\n" + "=" * 50)
        print("SME SUPPLIER SMART ADVICE")
        print("=" * 50)
        print(result)
        print("=" * 50)

    except (ValueError, RuntimeError) as error:
        print("Could not generate advice:", error)

    except Exception:
        print(
            "The Gemini request failed. "
            "Read the API error printed above."
        )

