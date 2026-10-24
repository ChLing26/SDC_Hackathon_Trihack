from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI

from src.api.security import require_service_auth
from src.database.emergency import initialize_database
from src.models.emergency import EmergencyPurchaseRequest, PurchaseDecision
from src.services.emergency import (
    create_emergency_purchase,
    decide_purchase,
    get_emergency_purchase,
    list_emergency_purchases,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="Emergency Stationery Purchasing API",
    description=(
        "Automatically selects a suitable stationery supplier "
        "and submits an emergency purchase for approval."
    ),
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(require_service_auth)],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/")
def home():
    return {
        "message": "Emergency purchasing API is running",
        "purchase_statuses": [
            "Pending Approval",
            "Approved",
            "Rejected",
        ],
    }


@app.post("/emergency-purchases", status_code=201)
def submit_emergency_purchase(request: EmergencyPurchaseRequest):
    return create_emergency_purchase(request)


@app.get("/emergency-purchases")
def list_purchases(
    status: Literal["Pending Approval", "Approved", "Rejected"] | None = None,
    business_id: int | None = None,
):
    return list_emergency_purchases(status, business_id)


@app.post("/emergency-purchases/{purchase_id}/decision")
def purchase_decision(purchase_id: int, decision: PurchaseDecision):
    return decide_purchase(purchase_id, decision)


@app.get("/emergency-purchases/{purchase_id}")
def retrieve_purchase(purchase_id: int):
    return get_emergency_purchase(purchase_id)
