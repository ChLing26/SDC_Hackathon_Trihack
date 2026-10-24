from datetime import time
from typing import Literal

from pydantic import Field

from src.models.base import RequestModel
from src.services.numbers import MAX_QUANTITY


class EmergencyPurchaseRequest(RequestModel):
    business_id: int = Field(gt=0)
    item_name: str = Field(min_length=1, max_length=100)
    quantity: float = Field(gt=0, le=MAX_QUANTITY)
    required_delivery_time: time
    max_distance_km: float | None = Field(default=None, gt=0, le=10000)


class PurchaseDecision(RequestModel):
    decision: Literal["Approved", "Rejected"]
    note: str = Field(default="", max_length=500)
