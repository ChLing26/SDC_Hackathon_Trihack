from typing import Literal
from statistics import median
from uuid import uuid4

from fastapi import Depends, FastAPI
from pydantic import Field, model_validator

from ai_advisor import AIConfigurationError, GeminiProviderError, get_smart_advice
from src.backend_numbers import MAX_MONEY, checked_total
from src.backend_security import RequestModel, require_service_auth


app = FastAPI(
    title="SME Supplier Recommendation API",
    description="Supplier validation, anomaly detection and Gemini AI advice",
    version="1.1.0",
    dependencies=[Depends(require_service_auth)],
    docs_url=None, redoc_url=None, openapi_url=None,
)


# 1. Request models

class Supplier(RequestModel):
    # Legacy callers may omit this, but adapters must supply stable quote IDs.
    quote_id: str = Field(
        default_factory=lambda: "quote-" + uuid4().hex,
        min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
    )
    name: str = Field(min_length=1, max_length=200)
    product_price_rm: float = Field(ge=0, le=MAX_MONEY)
    shipping_rm: float = Field(ge=0, le=MAX_MONEY)
    delivery_days: float = Field(ge=0)
    distance_km: float = Field(ge=0)

    # Optional reported total for consistency checking
    total_cost_rm: float | None = Field(default=None, ge=0, le=MAX_MONEY)
    route_status: str = Field(default="OK", max_length=40)
    score: float | None = None

    @model_validator(mode="after")
    def validate_calculated_total(self):
        checked_total(self.product_price_rm, self.shipping_rm)
        return self


class AdviceRequest(RequestModel):
    suppliers: list[Supplier] = Field(min_length=1, max_length=100)
    budget: float = Field(ge=0, le=MAX_MONEY)
    max_delivery_days: float = Field(ge=0)

    priority: Literal[
        "balanced",
        "lowest_cost",
        "fastest_delivery"
    ] = "balanced"

    @model_validator(mode="after")
    def validate_quote_ids(self):
        require_unique_quote_ids(self.suppliers)
        return self


def require_unique_quote_ids(suppliers):
    ids = [supplier.quote_id for supplier in suppliers]
    if len(ids) != len(set(ids)):
        raise ValueError("Quote IDs must be unique within a request.")


# 2. Health check

@app.get("/")
def home():
    return {
        "status": "running",
        "message": "Supplier Recommendation API is ready"
    }


# 3. Anomaly detection

def detect_anomalies(suppliers):
    require_unique_quote_ids(suppliers)
    warnings = []

    for supplier in suppliers:
        name = supplier.name

        calculated_total = checked_total(supplier.product_price_rm, supplier.shipping_rm)

        # Rule 1: Check reported total cost
        if supplier.total_cost_rm is not None:
            if abs(
                supplier.total_cost_rm - calculated_total
            ) > 0.01:
                warnings.append({
                    "quote_id": supplier.quote_id,
                    "supplier": name,
                    "type": "TOTAL_COST_MISMATCH",
                    "severity": "high",
                    "message": (
                        f"Reported total RM"
                        f"{supplier.total_cost_rm:.2f} does not match "
                        f"product price plus shipping "
                        f"(RM{calculated_total:.2f})."
                    )
                })

        # Rule 2: Check route status
        if supplier.route_status.strip().upper() != "OK":
            warnings.append({
                "quote_id": supplier.quote_id,
                "supplier": name,
                "type": "INVALID_ROUTE",
                "severity": "high",
                "message": (
                    f"Route status is "
                    f"{supplier.route_status}. Verify the route."
                )
            })

    # Rule 3: Compare product prices using the median
    prices = [
        s.product_price_rm
        for s in suppliers
        if s.product_price_rm > 0
    ]

    if len(prices) >= 3:
        reference_price = median(prices)

        for supplier in suppliers:
            if (
                supplier.product_price_rm > 0
                and supplier.product_price_rm > reference_price * 2
            ):
                warnings.append({
                    "quote_id": supplier.quote_id,
                    "supplier": supplier.name,
                    "type": "UNUSUALLY_HIGH_PRICE",
                    "severity": "medium",
                    "message": (
                        "Product price is more than twice "
                        "the median positive supplier price. "
                        "Please verify the quote."
                    )
                })

    # Rule 4: Compare shipping fees using the median
    fees = [
        s.shipping_rm
        for s in suppliers
        if s.shipping_rm > 0
    ]

    if len(fees) >= 3:
        reference_fee = median(fees)

        for supplier in suppliers:
            if (
                supplier.shipping_rm > 0
                and supplier.shipping_rm > reference_fee * 2
            ):
                warnings.append({
                    "quote_id": supplier.quote_id,
                    "supplier": supplier.name,
                    "type": "UNUSUALLY_HIGH_SHIPPING",
                    "severity": "medium",
                    "message": (
                        "Shipping fee is more than twice "
                        "the median positive shipping fee. "
                        "Please verify the delivery quote."
                    )
                })

    return warnings


# 4. Main supplier advice API

@app.post("/supplier-advice")
def supplier_advice(request: AdviceRequest):
    suppliers = request.suppliers

    # Detect anomalies using the original reported input.
    warnings = detect_anomalies(suppliers)

    supplier_results = []

    for supplier in suppliers:
        item = supplier.model_dump()

        # Calculate total cost from the price and shipping fields.
        calculated_total = checked_total(supplier.product_price_rm, supplier.shipping_rm)

        item["reported_total_cost_rm"] = supplier.total_cost_rm
        item["total_cost_rm"] = calculated_total

        item["within_budget"] = (
            calculated_total <= request.budget
        )

        item["meets_delivery_requirement"] = (
            supplier.delivery_days <= request.max_delivery_days
        )

        # Make the detected warnings visible for each supplier.
        item["anomalies"] = [
            warning for warning in warnings
            if warning["quote_id"] == supplier.quote_id
        ]

        supplier_results.append(item)

    # Do not recommend suppliers with invalid routes.
    ai_suppliers = [
        {
            "quote_id": s.quote_id,
            "name": s.name,
            "product_price_rm": s.product_price_rm,
            "shipping_rm": s.shipping_rm,
            "total_cost_rm": checked_total(s.product_price_rm, s.shipping_rm),
            "delivery_days": s.delivery_days,
            "distance_km": s.distance_km
        }
        for s in suppliers
        if s.route_status.strip().upper() == "OK"
    ]

    advice = None
    ai_status = "skipped"
    ai_failure = None

    if ai_suppliers:
        try:
            advice = get_smart_advice(
                suppliers=ai_suppliers,
                budget=request.budget,
                max_delivery_days=request.max_delivery_days,
                priority=request.priority,
                warnings=warnings
            )
            ai_status = "success"

        except AIConfigurationError:
            ai_status = "unavailable"
            ai_failure = {"category": "configuration", "http_status": None}
            advice = "Gemini AI is not configured. Supplier validation is still available."
        except GeminiProviderError as error:
            ai_status = "failed"
            ai_failure = {"category": error.category, "http_status": error.http_status}
            advice = (
                "Gemini AI is temporarily unavailable. Please try again later. "
                if error.http_status == 503 else
                "AI advice is temporarily unavailable. "
            ) + (
                "Supplier results and anomaly warnings "
                "are still available."
            )
        except Exception:
            # Keep the API working if Gemini is unavailable.
            # Provider exceptions may include credentials or submitted data.
            ai_status = "failed"
            ai_failure = {"category": "provider", "http_status": 502}
            advice = (
                "AI advice is temporarily unavailable. "
                "Supplier results and anomaly warnings "
                "are still available."
            )

    return {
        "status": "success",
        "supplier_count": len(supplier_results),
        "suppliers": supplier_results,
        "warnings": warnings,
        "warning_count": len(warnings),
        "ai_status": ai_status,
        "ai_failure": ai_failure,
        "ai_advice": advice
    }
