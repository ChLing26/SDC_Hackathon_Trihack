
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ai_advisor import get_smart_advice


app = FastAPI(
    title="SME Supplier Recommendation API",
    description="Supplier validation and Gemini AI advice",
    version="1.0.0"
)


# ==========================================
# 1. Request data models
# ==========================================

class Supplier(BaseModel):
    name: str = Field(min_length=1)
    product_price_rm: float = Field(ge=0)
    shipping_rm: float = Field(ge=0)
    delivery_days: float = Field(ge=0)
    distance_km: float = Field(ge=0)

    # Optional fields for anomaly detection
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


# ==========================================
# 2. Health check
# ==========================================

@app.get("/")
def home():
    return {
        "status": "running",
        "message": "Supplier Recommendation API is ready"
    }


# ==========================================
# 3. Supplier anomaly detection
# ==========================================

def detect_anomalies(suppliers):
    warnings = []

    for supplier in suppliers:
        name = supplier.name

        calculated_total = (
            supplier.product_price_rm + supplier.shipping_rm
        )

        # Check total cost consistency
        if supplier.total_cost_rm is not None:
            if abs(
                supplier.total_cost_rm - calculated_total
            ) > 0.01:
                warnings.append({
                    "supplier": name,
                    "type": "TOTAL_COST_MISMATCH",
                    "message": (
                        "Reported total cost does not match "
                        "product price plus shipping."
                    )
                })

        # Check route calculation status
        if supplier.route_status.upper() != "OK":
            warnings.append({
                "supplier": name,
                "type": "INVALID_ROUTE",
                "message": (
                    f"Route status is {supplier.route_status}."
                )
            })

    # Compare suppliers to find unusual prices.
    # This is a simple heuristic, not proof of an error.
    valid_prices = [
        s.product_price_rm
        for s in suppliers
        if s.product_price_rm > 0
    ]

    if len(valid_prices) >= 3:
        average_price = sum(valid_prices) / len(valid_prices)

        for supplier in suppliers:
            if (
                supplier.product_price_rm > 0
                and supplier.product_price_rm > average_price * 2
            ):
                warnings.append({
                    "supplier": supplier.name,
                    "type": "UNUSUALLY_HIGH_PRICE",
                    "message": (
                        "Product price is more than twice "
                        "the average positive supplier price. "
                        "Please verify the data."
                    )
                })

    return warnings


# ==========================================
# 4. Main API: Supplier + AI advice
# ==========================================

@app.post("/supplier-advice")
def supplier_advice(request: AdviceRequest):

    suppliers = request.suppliers

    # Calculate the total cost using trusted input fields.
    supplier_results = []

    for supplier in suppliers:
        item = supplier.model_dump()

        item["total_cost_rm"] = round(
            supplier.product_price_rm + supplier.shipping_rm,
            2
        )

        item["within_budget"] = (
            item["total_cost_rm"] <= request.budget
        )

        item["meets_delivery_requirement"] = (
            supplier.delivery_days <= request.max_delivery_days
        )

        supplier_results.append(item)

    # Detect suspicious or inconsistent data.
    warnings = detect_anomalies(suppliers)

    # Exclude suppliers with invalid route status from AI ranking.
    ai_suppliers = [
        {
            "name": s.name,
            "product_price_rm": s.product_price_rm,
            "shipping_rm": s.shipping_rm,
            "delivery_days": s.delivery_days,
            "distance_km": s.distance_km
        }
        for s in suppliers
        if s.route_status.upper() == "OK"
    ]

    advice = None
    ai_status = "skipped"

    if ai_suppliers:
        try:
            advice = get_smart_advice(
                suppliers=ai_suppliers,
                budget=request.budget,
                max_delivery_days=request.max_delivery_days,
                priority=request.priority
            )
            ai_status = "success"

        except Exception:
            # Do not expose API keys or internal error details.
            ai_status = "failed"
            advice = (
                "AI advice is temporarily unavailable. "
                "Please use the supplier data and warnings "
                "while the API issue is investigated."
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
