from src.models.advice import AdviceRequest
from src.services.ai_advisor import (
    AIConfigurationError,
    GeminiProviderError,
    get_smart_advice,
)
from src.services.anomalies import detect_anomalies
from src.services.numbers import checked_total


def create_supplier_advice(request: AdviceRequest) -> dict:
    suppliers = request.suppliers
    warnings = detect_anomalies(suppliers)
    supplier_results = []

    for supplier in suppliers:
        item = supplier.model_dump()
        calculated_total = checked_total(
            supplier.product_price_rm, supplier.shipping_rm,
        )
        item["reported_total_cost_rm"] = supplier.total_cost_rm
        item["total_cost_rm"] = calculated_total
        item["within_budget"] = calculated_total <= request.budget
        item["meets_delivery_requirement"] = (
            supplier.delivery_days <= request.max_delivery_days
        )
        item["anomalies"] = [
            warning for warning in warnings
            if warning["quote_id"] == supplier.quote_id
        ]
        supplier_results.append(item)

    ai_suppliers = [
        {
            "quote_id": supplier.quote_id,
            "name": supplier.name,
            "product_price_rm": supplier.product_price_rm,
            "shipping_rm": supplier.shipping_rm,
            "total_cost_rm": checked_total(
                supplier.product_price_rm, supplier.shipping_rm,
            ),
            "delivery_days": supplier.delivery_days,
            "distance_km": supplier.distance_km,
        }
        for supplier in suppliers
        if supplier.route_status.strip().upper() == "OK"
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
                warnings=warnings,
            )
            ai_status = "success"
        except AIConfigurationError:
            ai_status = "unavailable"
            ai_failure = {"category": "configuration", "http_status": None}
            advice = (
                "Gemini AI is not configured. Supplier validation is still available."
            )
        except GeminiProviderError as error:
            ai_status = "failed"
            ai_failure = {
                "category": error.category,
                "http_status": error.http_status,
            }
            advice = (
                "Gemini AI is temporarily unavailable. Please try again later. "
                if error.http_status == 503
                else "AI advice is temporarily unavailable. "
            ) + "Supplier results and anomaly warnings are still available."
        except Exception:
            # Provider exceptions may include credentials or submitted data.
            ai_status = "failed"
            ai_failure = {"category": "provider", "http_status": 502}
            advice = (
                "AI advice is temporarily unavailable. "
                "Supplier results and anomaly warnings are still available."
            )

    return {
        "status": "success",
        "supplier_count": len(supplier_results),
        "suppliers": supplier_results,
        "warnings": warnings,
        "warning_count": len(warnings),
        "ai_status": ai_status,
        "ai_failure": ai_failure,
        "ai_advice": advice,
    }
