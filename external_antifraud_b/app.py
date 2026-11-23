"""
External Antifraud B — Independent Demo Antifraud Microservice (Port 8010).

Important isolation guarantees:
- Does NOT import VIGILIA's internal DefenseEngine or simulator.
- Has NO access to ground_truth_label or scenario_type.
- Computes risk scores and reason codes live using an independent behavioral/heuristic rule strategy.
- Supports safe per-request alternative configuration evaluation without mutating its baseline preset.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime
import time
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

SEGMENT_BASELINES_KZT: Dict[str, float] = {
    "retail_standard": 420_000.0,
    "retail_vip": 1_800_000.0,
    "sme_business": 3_200_000.0,
    "corporate": 8_500_000.0,
}

PROFILES: Dict[str, Dict[str, Any]] = {
    "baseline": {
        "version": "B-1.0-baseline",
        "decision_threshold": 62.0,
        "amount_tier_scale": 1.35,
        "amount_weight": 34.0,
        "new_payee_weight": 26.0,
        "duplicate_window_min": 10,
        "duplicate_weight": 42.0,
        "duplicate_tolerance_pct": 0.01,
        "velocity_window_min": 20,
        "velocity_min_tx": 4,
        "velocity_weight": 32.0,
        "night_bonus": 10.0,
        "structuring_window_min": 20,
        "structuring_min_tx": 4,
        "structuring_weight": 24.0,
        "ato_window_min": 10,
        "ato_weight": 26.0,
    },
    "candidate": {
        "version": "B-1.1-candidate",
        "decision_threshold": 54.0,
        "amount_tier_scale": 0.95,
        "amount_weight": 38.0,
        "new_payee_weight": 34.0,
        "duplicate_window_min": 35,
        "duplicate_weight": 46.0,
        "duplicate_tolerance_pct": 0.03,
        "velocity_window_min": 45,
        "velocity_min_tx": 3,
        "velocity_weight": 38.0,
        "night_bonus": 14.0,
        "structuring_window_min": 45,
        "structuring_min_tx": 3,
        "structuring_weight": 40.0,
        "ato_window_min": 30,
        "ato_weight": 38.0,
    },
    "updated": {
        "version": "B-1.2-updated",
        "decision_threshold": 55.0,
        "amount_tier_scale": 0.92,
        "amount_weight": 38.0,
        "new_payee_weight": 35.0,
        "duplicate_window_min": 40,
        "duplicate_weight": 46.0,
        "duplicate_tolerance_pct": 0.03,
        "velocity_window_min": 50,
        "velocity_min_tx": 3,
        "velocity_weight": 38.0,
        "night_bonus": 15.0,
        "structuring_window_min": 50,
        "structuring_min_tx": 3,
        "structuring_weight": 42.0,
        "ato_window_min": 32,
        "ato_weight": 40.0,
    },
}

ACTIVE_PROFILE_STATE: Dict[str, str] = {"profile": "baseline"}


class ExternalConfigOverride(BaseModel):
    decision_threshold: Optional[float] = Field(default=None, ge=15.0, le=95.0)
    amount_tier_scale: Optional[float] = Field(default=None, ge=0.4, le=3.0)
    amount_weight: Optional[float] = Field(default=None, ge=5.0, le=60.0)
    new_payee_weight: Optional[float] = Field(default=None, ge=5.0, le=60.0)
    duplicate_window_min: Optional[int] = Field(default=None, ge=1, le=240)
    duplicate_weight: Optional[float] = Field(default=None, ge=5.0, le=70.0)
    duplicate_tolerance_pct: Optional[float] = Field(default=None, ge=0.0, le=0.25)
    velocity_window_min: Optional[int] = Field(default=None, ge=5, le=240)
    velocity_min_tx: Optional[int] = Field(default=None, ge=2, le=15)
    velocity_weight: Optional[float] = Field(default=None, ge=5.0, le=60.0)
    night_bonus: Optional[float] = Field(default=None, ge=0.0, le=30.0)
    structuring_window_min: Optional[int] = Field(default=None, ge=5, le=240)
    structuring_min_tx: Optional[int] = Field(default=None, ge=2, le=10)
    structuring_weight: Optional[float] = Field(default=None, ge=5.0, le=70.0)
    ato_window_min: Optional[int] = Field(default=None, ge=1, le=240)
    ato_weight: Optional[float] = Field(default=None, ge=5.0, le=70.0)


class ExternalTxInput(BaseModel):
    transaction_id: str = Field(min_length=1, max_length=64)
    customer_id: str = Field(min_length=1, max_length=64)
    amount_kzt: float = Field(ge=0.0)
    recipient_id: str = Field(min_length=1, max_length=64)
    timestamp: str
    channel: str = "mobile_app"
    transaction_type: str = "p2p_transfer"
    is_new_recipient: bool = False
    customer_segment: str = "retail_standard"
    transaction_frequency: float = 1.0
    device_changed: bool = False
    geo_changed: bool = False
    minutes_since_device_change: Optional[float] = None


class AnalyzeBatchRequest(BaseModel):
    protocol_version: str = "1.0"
    profile: Optional[Literal["baseline", "candidate", "updated"]] = None
    config_override: Optional[ExternalConfigOverride] = None
    transactions: List[ExternalTxInput] = Field(default_factory=list, max_length=1000)


class ProfileSelectRequest(BaseModel):
    profile: Literal["baseline", "candidate", "updated"]


def _parse_ts(ts_raw: str) -> datetime:
    cleaned = ts_raw.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    return datetime.fromisoformat(cleaned)


def _resolve_params(
    profile: Optional[str] = None,
    override: Optional[ExternalConfigOverride] = None,
) -> Dict[str, Any]:
    prof_name = profile or ACTIVE_PROFILE_STATE["profile"]
    if prof_name not in PROFILES:
        raise HTTPException(status_code=400, detail=f"Unknown profile: {prof_name}")
    params = deepcopy(PROFILES[prof_name])
    params["profile_name"] = prof_name
    if override is not None:
        patch = override.model_dump(exclude_none=True)
        params.update(patch)
        if patch:
            params["version"] = f"{params['version']}-custom"
    return params


def score_transactions_independent(
    transactions: List[ExternalTxInput],
    params: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Evaluate transactions causally using External Antifraud B's independent heuristic logic.
    Input ordering is preserved in output, while causal state is built chronologically.
    """
    indexed = []
    for idx, tx in enumerate(transactions):
        indexed.append((idx, _parse_ts(tx.timestamp), tx))
    indexed.sort(key=lambda item: (item[1], item[0]))

    customer_ewma: Dict[str, float] = {}
    customer_tx_times: Dict[str, List[datetime]] = defaultdict(list)
    customer_tx_history: Dict[str, List[tuple[datetime, float, bool]]] = defaultdict(list)
    pair_history: Dict[tuple[str, str], List[tuple[datetime, float]]] = defaultdict(list)

    threshold = float(params["decision_threshold"])
    amount_tier_scale = float(params["amount_tier_scale"])
    amount_weight = float(params["amount_weight"])
    new_payee_weight = float(params["new_payee_weight"])
    dup_window = int(params["duplicate_window_min"])
    dup_weight = float(params["duplicate_weight"])
    dup_tol = float(params["duplicate_tolerance_pct"])
    vel_window = int(params["velocity_window_min"])
    vel_min_tx = int(params["velocity_min_tx"])
    vel_weight = float(params["velocity_weight"])
    night_bonus = float(params["night_bonus"])
    struct_window = int(params.get("structuring_window_min", 20))
    struct_min_tx = int(params.get("structuring_min_tx", 4))
    struct_weight = float(params.get("structuring_weight", 24.0))
    ato_window = int(params.get("ato_window_min", 10))
    ato_weight = float(params.get("ato_weight", 26.0))

    scored_by_idx: Dict[int, Dict[str, Any]] = {}

    for orig_idx, ts, tx in indexed:
        score = 0.0
        reasons: List[str] = []

        seg_base = SEGMENT_BASELINES_KZT.get(tx.customer_segment, 450_000.0)
        ewma = customer_ewma.get(tx.customer_id, seg_base)
        ref_amount = max(seg_base * 0.75, ewma) * amount_tier_scale

        # 1. Segment-tiered & EWMA amount outlier
        amt_ratio = tx.amount_kzt / max(ref_amount, 1.0)
        if amt_ratio >= 1.35:
            intensity = min(1.3, 0.65 + (amt_ratio - 1.35) * 0.35)
            score += amount_weight * intensity
            reasons.append("HIGH_AMOUNT_TIER")

        # 2. New recipient + channel / round amount / night-hour context
        is_night = 0 <= ts.hour < 6
        is_round_large = tx.amount_kzt >= 100_000 and (int(round(tx.amount_kzt)) % 50_000 == 0)
        risky_channel = tx.channel in {"api_gateway", "web_portal", "mobile_app"}
        if tx.is_new_recipient:
            payee_score = 0.0
            if tx.amount_kzt >= seg_base * 0.28:
                payee_score += new_payee_weight
            elif risky_channel and is_round_large:
                payee_score += new_payee_weight * 0.78
            else:
                payee_score += new_payee_weight * 0.45

            if is_night:
                payee_score += night_bonus
                reasons.append("NIGHT_NEW_RECIPIENT")
            else:
                reasons.append("NEW_RECIPIENT")
            score += payee_score
        elif is_night and tx.amount_kzt >= seg_base * 0.6:
            score += night_bonus * 0.8
            reasons.append("OFF_HOURS_LARGE_TRANSFER")

        # 3. Duplicate burst detection on (customer, recipient)
        pair_key = (tx.customer_id, tx.recipient_id)
        prior_pairs = pair_history[pair_key]
        dup_hit = False
        for prev_ts, prev_amt in prior_pairs:
            diff_min = (ts - prev_ts).total_seconds() / 60.0
            if 0.0 <= diff_min <= dup_window:
                rel_diff = abs(tx.amount_kzt - prev_amt) / max(prev_amt, 1.0)
                if rel_diff <= dup_tol:
                    dup_hit = True
                    break
        if dup_hit:
            score += dup_weight
            reasons.append("DUPLICATE_BURST")

        # 4. Velocity structuring within lookback window
        prior_times = [
            pt for pt in customer_tx_times[tx.customer_id]
            if 0.0 <= (ts - pt).total_seconds() / 60.0 <= vel_window
        ]
        if len(prior_times) + 1 >= vel_min_tx:
            score += vel_weight
            if is_night:
                score += night_bonus * 0.6
            reasons.append("VELOCITY_STRUCTURING")

        # 5. Cumulative structuring / smurfing within window
        prior_struct = [
            (pts, pamt, pnew)
            for (pts, pamt, pnew) in customer_tx_history[tx.customer_id]
            if 0.0 <= (ts - pts).total_seconds() / 60.0 <= struct_window
        ]
        struct_count = len(prior_struct) + 1
        struct_sum = tx.amount_kzt + sum(pamt for _, pamt, _ in prior_struct)
        if (
            struct_count >= struct_min_tx
            and tx.transaction_type == "p2p_transfer"
            and struct_sum >= ewma * 2.1
        ):
            score += struct_weight + (8.0 if tx.is_new_recipient else 4.0)
            reasons.append("CUMULATIVE_STRUCTURING")

        # 6. Account Takeover (device/geo shift + rapid transfer to new recipient + elevated amount)
        if tx.device_changed or tx.geo_changed:
            rapid_ato = (
                tx.minutes_since_device_change is not None
                and 0.0 <= float(tx.minutes_since_device_change) <= ato_window
            )
            if rapid_ato and tx.is_new_recipient and tx.amount_kzt >= ewma * 1.4:
                score += ato_weight + (10.0 if (tx.device_changed and tx.geo_changed) else 0.0)
                reasons.append("ATO_DEVICE_GEO_SHIFT")

        # Update causal customer state AFTER scoring
        alpha = 0.25
        customer_ewma[tx.customer_id] = (1 - alpha) * ewma + alpha * min(tx.amount_kzt, ref_amount * 2.0)
        customer_tx_times[tx.customer_id] = prior_times + [ts]
        hist_list = customer_tx_history[tx.customer_id]
        hist_list.append((ts, tx.amount_kzt, tx.is_new_recipient))
        if len(hist_list) > 30:
            customer_tx_history[tx.customer_id] = hist_list[-30:]
        prior_pairs.append((ts, tx.amount_kzt))
        if len(prior_pairs) > 25:
            pair_history[pair_key] = prior_pairs[-25:]

        clamped_score = round(max(0.0, min(100.0, score)), 2)
        pred_label = 1 if clamped_score >= threshold else 0

        if clamped_score >= 80:
            risk_level = "critical"
        elif clamped_score >= threshold:
            risk_level = "high"
        elif clamped_score >= 30:
            risk_level = "medium"
        else:
            risk_level = "low"

        scored_by_idx[orig_idx] = {
            "transaction_id": tx.transaction_id,
            "risk_score": clamped_score,
            "predicted_label": pred_label,
            "risk_level": risk_level,
            "reason_codes": reasons,
        }

    return [scored_by_idx[i] for i in range(len(transactions))]


app = FastAPI(
    title="External Antifraud B — Independent Demo Service",
    version="1.0.0",
    description="Standalone local antifraud engine for VIGILIA 3.2 external testing.",
)


@app.get("/health")
def health():
    prof = ACTIVE_PROFILE_STATE["profile"]
    return {
        "status": "ok",
        "service": "External Antifraud B",
        "protocol_version": "1.0",
        "active_profile": prof,
        "engine_version": PROFILES[prof]["version"],
        "supports_config": True,
    }


@app.get("/config")
def get_config(profile: Optional[str] = None):
    params = _resolve_params(profile=profile)
    return {
        "engine_name": "External Antifraud B",
        "protocol_version": "1.0",
        "supports_config": True,
        "active_profile": params["profile_name"],
        "available_profiles": list(PROFILES.keys()),
        "parameters": {
            k: v
            for k, v in params.items()
            if k not in {"version", "profile_name"}
        },
        "engine_version": params["version"],
    }


@app.post("/config/profile")
def set_active_profile(payload: ProfileSelectRequest):
    ACTIVE_PROFILE_STATE["profile"] = payload.profile
    return {
        "status": "updated",
        "active_profile": payload.profile,
        "engine_version": PROFILES[payload.profile]["version"],
    }


@app.post("/analyze")
def analyze_transactions(payload: AnalyzeBatchRequest):
    t0 = time.perf_counter()
    params = _resolve_params(profile=payload.profile, override=payload.config_override)
    results = score_transactions_independent(payload.transactions, params)
    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        "protocol_version": "1.0",
        "engine_name": "External Antifraud B",
        "engine_version": params["version"],
        "profile": params["profile_name"],
        "processing_time_ms": elapsed_ms,
        "results": results,
    }
