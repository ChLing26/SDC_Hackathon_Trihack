
from typing import Literal
from statistics import median

from fastapi import FastAPI
from pydantic import BaseModel, Field

from ai_advisor import get_smart_advice


app = FastAPI(
    title="SME Supplier Recommendation API",
    description="Supplier validation, anomaly detection and Gemini AI advice",
    version="1.1.0"
)


# 1. Request models

class Supplier(BaseModel):
    name: str = Field(min_length=1)
    product_price_rm: float = Field(ge=0)
    shipping_rm: float = Field(ge=0)
    delivery_days: float = Field(ge=0)
    distance_km: float = Field(ge=0)

    # Optional reported total for consistency checking
    total_cost_rm: float | None = Field(default=None, ge=0)
    route_status: str = "OK"
    score: float | None = None


class AdviceRequest(BaseModel):
    suppliers: list[Supplier] = Field(min_length=1)
    budget: float = Field(ge=0)
    max_delivery_days: float = Field(ge=0)

    priority: Literal[
        "balanced",
        "lowest_cost",
        "fastest_delivery"
    ] = "balanced"


# 2. Health check

@app.get("/")
def home():
    return {
        "status": "running",
        "message": "Supplier Recommendation API is ready"
    }


# 3. Anomaly detection

def detect_anomalies(suppliers):
    warnings = []

    for supplier in suppliers:
        name = supplier.name

        calculated_total = round(
            supplier.product_price_rm + supplier.shipping_rm,
            2
        )

        # Rule 1: Check reported total cost
        if supplier.total_cost_rm is not None:
            if abs(
                supplier.total_cost_rm - calculated_total
            ) > 0.01:
                warnings.append({
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
        calculated_total = round(
            supplier.product_price_rm + supplier.shipping_rm,
            2
        )

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
            if warning["supplier"] == supplier.name
        ]

        supplier_results.append(item)

    # Do not recommend suppliers with invalid routes.
    ai_suppliers = [
        {
            "name": s.name,
            "product_price_rm": s.product_price_rm,
            "shipping_rm": s.shipping_rm,
            "total_cost_rm": round(
                s.product_price_rm + s.shipping_rm, 2
            ),
            "delivery_days": s.delivery_days,
            "distance_km": s.distance_km
        }
        for s in suppliers
        if s.route_status.strip().upper() == "OK"
    ]

    advice = None
    ai_status = "skipped"

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

        except Exception as exc:
            # Keep the API working if Gemini is unavailable.
            print(
                "Gemini advice failed:",
                type(exc).__name__,
                str(exc)
            )

            ai_status = "failed"
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
        "ai_advice": advice
    }
