"""Bounded decimal money operations; never emit infinity/NaN in quote totals."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

# Defensive service limits, not a customer's procurement budget.
MAX_MONEY = 1_000_000_000_000
MAX_QUANTITY = 1_000_000_000
CENT = Decimal("0.01")


def bounded_decimal(value, maximum, label):
    try:
        if isinstance(value, bool):
            raise ValueError()
        number = Decimal(str(value))
        if not number.is_finite() or number < 0 or number > Decimal(maximum):
            raise ValueError()
        return number
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{label} must be finite, nonnegative and at most {maximum}.") from None


def checked_quantity(value):
    quantity = bounded_decimal(value, MAX_QUANTITY, "Quantity")
    if quantity <= 0:
        raise ValueError("Quantity must be greater than zero.")
    return quantity


def checked_total(price, shipping, quantity=1):
    """price is a unit price when quantity is supplied, otherwise a subtotal.

    Multiply/add in decimal, reject an out-of-range result before converting to
    a JSON float, and round the combined total once (half-up to cents).
    """
    price = bounded_decimal(price, MAX_MONEY, "Price")
    shipping = bounded_decimal(shipping, MAX_MONEY, "Shipping")
    quantity = checked_quantity(quantity)
    total = price * quantity + shipping
    if total > MAX_MONEY:
        raise ValueError(f"Calculated total exceeds the service limit of {MAX_MONEY}.")
    return float(total.quantize(CENT, rounding=ROUND_HALF_UP))
