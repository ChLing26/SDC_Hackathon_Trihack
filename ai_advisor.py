import os
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

# Create the client only when a key is available.
client = (
    genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=15000))
    if API_KEY else None
)

MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()


class AIConfigurationError(RuntimeError):
    """Gemini has no configured credential; not a successful AI response."""

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
            contents=prompt
        )

        if not response.text:
            raise RuntimeError("Gemini returned an empty response.")

        return response.text

    except Exception:
        # Do not leak upstream response bodies, request data or credentials.
        raise RuntimeError("Gemini request failed.") from None


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

