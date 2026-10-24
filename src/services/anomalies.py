from statistics import median

from src.models.advice import require_unique_quote_ids
from src.services.numbers import checked_total


def detect_anomalies(suppliers):
    require_unique_quote_ids(suppliers)
    warnings = []

    for supplier in suppliers:
        name = supplier.name
        calculated_total = checked_total(
            supplier.product_price_rm, supplier.shipping_rm,
        )

        if supplier.total_cost_rm is not None:
            if abs(supplier.total_cost_rm - calculated_total) > 0.01:
                warnings.append({
                    "quote_id": supplier.quote_id,
                    "supplier": name,
                    "type": "TOTAL_COST_MISMATCH",
                    "severity": "high",
                    "message": (
                        f"Reported total RM{supplier.total_cost_rm:.2f} does not match "
                        f"product price plus shipping (RM{calculated_total:.2f})."
                    ),
                })

        if supplier.route_status.strip().upper() != "OK":
            warnings.append({
                "quote_id": supplier.quote_id,
                "supplier": name,
                "type": "INVALID_ROUTE",
                "severity": "high",
                "message": (
                    f"Route status is {supplier.route_status}. Verify the route."
                ),
            })

    prices = [s.product_price_rm for s in suppliers if s.product_price_rm > 0]
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
                        "Product price is more than twice the median positive "
                        "supplier price. Please verify the quote."
                    ),
                })

    fees = [s.shipping_rm for s in suppliers if s.shipping_rm > 0]
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
                        "Shipping fee is more than twice the median positive "
                        "shipping fee. Please verify the delivery quote."
                    ),
                })

    return warnings
