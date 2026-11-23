"""Independent Mock Bank ML Antifraud Microservice (FastAPI + scikit-learn, port 8020)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

try:
    from .ml_model import BankMLAntifraudModel, MODEL_VERSION
except ImportError:
    from ml_model import BankMLAntifraudModel, MODEL_VERSION

app = FastAPI(
    title="Mock Bank ML Antifraud Service",
    description="Realistic legacy bank ML antifraud simulator (scikit-learn) with Concept Drift for VIGILIA Black-Box testing.",
    version="1.0.0",
)

ml_engine = BankMLAntifraudModel()


class TransactionInput(BaseModel):
    transaction_id: Optional[str] = None
    transaction_code: Optional[str] = None
    customer_id: Optional[str] = None
    amount_kzt: float = 0.0
    recipient_id: Optional[str] = None
    timestamp: Optional[str] = None
    channel: str = "mobile_app"
    transaction_type: str = "p2p_transfer"
    is_new_recipient: bool = False
    customer_segment: str = "retail_standard"
    transaction_frequency: float = 1.0
    device_changed: bool = False
    geo_changed: bool = False
    minutes_since_device_change: Optional[float] = None


class AnalyzeRequest(BaseModel):
    protocol_version: str = "1.0"
    transactions: List[TransactionInput] = Field(default_factory=list)
    profile: Optional[str] = None
    config_override: Optional[Dict[str, Any]] = None


class ThresholdConfigUpdate(BaseModel):
    block_threshold: Optional[float] = Field(default=None, ge=1.0, le=99.9)
    review_threshold: Optional[float] = Field(default=None, ge=1.0, le=99.0)


@app.get("/health")
def health() -> Dict[str, Any]:
    cfg = ml_engine.get_config()
    return {
        "status": "ok",
        "service": "mock_bank_antifraud",
        "model_type": cfg["model_type"],
        "model_version": cfg["model_version"],
        "features_count": cfg["features_count"],
        "block_threshold": cfg["block_threshold"],
        "review_threshold": cfg["review_threshold"],
        "training_time_ms": cfg["training_time_ms"],
    }


@app.get("/config")
def get_config() -> Dict[str, Any]:
    return ml_engine.get_config()


@app.post("/config")
def update_config(payload: ThresholdConfigUpdate) -> Dict[str, Any]:
    return ml_engine.update_thresholds(
        block_threshold=payload.block_threshold,
        review_threshold=payload.review_threshold,
    )


@app.post("/reset")
def reset_config() -> Dict[str, Any]:
    return ml_engine.reset_thresholds()


@app.post("/analyze")
def analyze_transactions(payload: AnalyzeRequest) -> Dict[str, Any]:
    tx_dicts = [tx.model_dump() for tx in payload.transactions]
    results = ml_engine.score_batch(tx_dicts)
    return {
        "protocol_version": payload.protocol_version,
        "engine_version": MODEL_VERSION,
        "results": results,
    }


@app.post("/evaluate")
async def evaluate_alias(request: Request) -> Dict[str, Any]:
    """Convenience alias supporting both VIGILIA batch payloads and single-transaction payloads."""
    body = await request.json()
    if isinstance(body, dict) and "transactions" in body:
        tx_dicts = list(body.get("transactions") or [])
        results = ml_engine.score_batch(tx_dicts)
        return {
            "protocol_version": str(body.get("protocol_version") or "1.0"),
            "engine_version": MODEL_VERSION,
            "results": results,
        }
    if isinstance(body, dict):
        results = ml_engine.score_batch([body])
        return results[0] if results else {}
    return {"results": []}
