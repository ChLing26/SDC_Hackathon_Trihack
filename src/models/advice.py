from typing import Literal
from uuid import uuid4

from pydantic import Field, model_validator

from src.models.base import RequestModel
from src.services.numbers import MAX_MONEY, checked_total


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
        "fastest_delivery",
    ] = "balanced"

    @model_validator(mode="after")
    def validate_quote_ids(self):
        require_unique_quote_ids(self.suppliers)
        return self


def require_unique_quote_ids(suppliers):
    ids = [supplier.quote_id for supplier in suppliers]
    if len(ids) != len(set(ids)):
        raise ValueError("Quote IDs must be unique within a request.")
