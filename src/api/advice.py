from fastapi import Depends, FastAPI

from src.api.security import require_service_auth
from src.models.advice import AdviceRequest
from src.services.advice import create_supplier_advice

app = FastAPI(
    title="SME Supplier Recommendation API",
    description="Supplier validation, anomaly detection and Gemini AI advice",
    version="1.1.0",
    dependencies=[Depends(require_service_auth)],
    docs_url=None, redoc_url=None, openapi_url=None,
)


# Health check

@app.get("/")
def home():
    return {
        "status": "running",
        "message": "Supplier Recommendation API is ready"
    }


# Supplier advice API

@app.post("/supplier-advice")
def supplier_advice(request: AdviceRequest):
    return create_supplier_advice(request)
