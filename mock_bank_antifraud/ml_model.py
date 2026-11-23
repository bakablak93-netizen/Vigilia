"""Bank ML Antifraud Engine (scikit-learn Pipeline with realistic Concept Drift)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

MODEL_CACHE_PATH = Path(__file__).resolve().parent / "model_cache.joblib"
MODEL_VERSION = "bank-ml-logreg-v1.0"

FEATURE_NAMES: List[str] = [
    "log_amount",
    "amount_to_segment_ratio",
    "transaction_frequency",
    "is_night_hour",
    "is_new_recipient",
    "device_changed",
    "geo_changed",
    "rapid_post_device_change",
]

FEATURE_REASON_LABELS: Dict[str, Tuple[str, str]] = {
    "log_amount": ("ML_HIGH_AMOUNT_ANOMALY", "KZT"),
    "amount_to_segment_ratio": ("ML_SEGMENT_RATIO_SPIKE", "x"),
    "transaction_frequency": ("ML_VELOCITY_BURST", "tx/h"),
    "is_night_hour": ("ML_NIGHT_ACTIVITY", "flag"),
    "is_new_recipient": ("ML_NEW_RECIPIENT", "flag"),
    "device_changed": ("ML_DEVICE_CHANGE", "flag"),
    "geo_changed": ("ML_GEO_ANOMALY", "flag"),
    "rapid_post_device_change": ("ML_RAPID_DEVICE_TRANSFER", "flag"),
}

SEGMENT_BASELINE_KZT: Dict[str, float] = {
    "retail_standard": 65_000.0,
    "retail_vip": 250_000.0,
    "sme_business": 350_000.0,
}

DEFAULT_BLOCK_THRESHOLD = 70.0
DEFAULT_REVIEW_THRESHOLD = 45.0


def _parse_hour(raw_ts: Any) -> int:
    if isinstance(raw_ts, datetime):
        return raw_ts.hour
    if isinstance(raw_ts, str) and raw_ts.strip():
        try:
            normalized = raw_ts.strip().replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).hour
        except ValueError:
            pass
    return 14


def extract_features(tx: Dict[str, Any]) -> Tuple[np.ndarray, Dict[str, float]]:
    """Extract numeric feature vector and raw diagnostic values from a transaction dict."""
    amount_kzt = max(0.0, float(tx.get("amount_kzt") or 0.0))
    segment = str(tx.get("customer_segment") or "retail_standard").lower()
    baseline = SEGMENT_BASELINE_KZT.get(segment, 65_000.0)

    log_amount = float(np.log1p(amount_kzt))
    amount_ratio = float(min(30.0, amount_kzt / max(1.0, baseline)))
    frequency = float(max(0.0, float(tx.get("transaction_frequency") or 1.0)))
    hour = _parse_hour(tx.get("timestamp"))
    is_night = 1.0 if 0 <= hour <= 5 else 0.0
    is_new_rec = 1.0 if bool(tx.get("is_new_recipient", False)) else 0.0
    device_changed = 1.0 if bool(tx.get("device_changed", False)) else 0.0
    geo_changed = 1.0 if bool(tx.get("geo_changed", False)) else 0.0

    mins_raw = tx.get("minutes_since_device_change")
    rapid_device = 0.0
    if device_changed > 0.5 and mins_raw is not None:
        try:
            if float(mins_raw) <= 30.0:
                rapid_device = 1.0
        except (TypeError, ValueError):
            pass

    vector = np.array(
        [
            log_amount,
            amount_ratio,
            frequency,
            is_night,
            is_new_rec,
            device_changed,
            geo_changed,
            rapid_device,
        ],
        dtype=np.float64,
    )
    raw_map = {
        "log_amount": round(amount_kzt, 2),
        "amount_to_segment_ratio": round(amount_ratio, 2),
        "transaction_frequency": round(frequency, 2),
        "is_night_hour": is_night,
        "is_new_recipient": is_new_rec,
        "device_changed": device_changed,
        "geo_changed": geo_changed,
        "rapid_post_device_change": rapid_device,
    }
    return vector, raw_map


def _generate_historical_dataset(n_legit: int = 2000, n_classic_fraud: int = 500) -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic historical bank transactions.
    Classic fraud (huge amounts, extreme velocity bursts, night anomalies) is well-represented.
    Modern Concept Drift patterns (low-amount structuring_smurfing, account_takeover_ato)
    are intentionally omitted so the legacy ML model exhibits realistic blind spots.
    """
    rng = np.random.default_rng(42)

    # 1. Legitimate historical transactions (y = 0)
    legit_amounts = rng.lognormal(mean=np.log(45_000.0), sigma=0.65, size=n_legit)
    legit_amounts = np.clip(legit_amounts, 1_500.0, 280_000.0)
    legit_log_amt = np.log1p(legit_amounts)
    legit_ratios = np.clip(legit_amounts / 65_000.0, 0.05, 4.5)
    legit_freq = np.clip(rng.normal(1.6, 0.8, size=n_legit), 1.0, 4.5)
    legit_night = rng.binomial(1, 0.08, size=n_legit).astype(np.float64)
    legit_new_rec = rng.binomial(1, 0.16, size=n_legit).astype(np.float64)
    # Occasional benign device/geo changes in normal traffic -> model learns near-zero/weak weight
    legit_dev = rng.binomial(1, 0.04, size=n_legit).astype(np.float64)
    legit_geo = rng.binomial(1, 0.04, size=n_legit).astype(np.float64)
    legit_rapid = np.zeros(n_legit, dtype=np.float64)

    X_legit = np.column_stack(
        [
            legit_log_amt,
            legit_ratios,
            legit_freq,
            legit_night,
            legit_new_rec,
            legit_dev,
            legit_geo,
            legit_rapid,
        ]
    )
    y_legit = np.zeros(n_legit, dtype=np.int64)

    # 2. Classic "old" fraud (y = 1): huge amounts and/or high velocity spikes
    fraud_amounts = rng.uniform(550_000.0, 2_400_000.0, size=n_classic_fraud)
    fraud_log_amt = np.log1p(fraud_amounts)
    fraud_ratios = np.clip(fraud_amounts / 65_000.0, 6.0, 30.0)
    fraud_freq = rng.uniform(6.5, 16.0, size=n_classic_fraud)
    fraud_night = rng.binomial(1, 0.55, size=n_classic_fraud).astype(np.float64)
    fraud_new_rec = rng.binomial(1, 0.70, size=n_classic_fraud).astype(np.float64)
    fraud_dev = np.zeros(n_classic_fraud, dtype=np.float64)
    fraud_geo = np.zeros(n_classic_fraud, dtype=np.float64)
    fraud_rapid = np.zeros(n_classic_fraud, dtype=np.float64)

    X_fraud = np.column_stack(
        [
            fraud_log_amt,
            fraud_ratios,
            fraud_freq,
            fraud_night,
            fraud_new_rec,
            fraud_dev,
            fraud_geo,
            fraud_rapid,
        ]
    )
    y_fraud = np.ones(n_classic_fraud, dtype=np.int64)

    X = np.vstack([X_legit, X_fraud])
    y = np.concatenate([y_legit, y_fraud])
    perm = rng.permutation(len(y))
    return X[perm], y[perm]


class BankMLAntifraudModel:
    """Fast scikit-learn Pipeline wrapper with runtime threshold configuration."""

    def __init__(self, cache_path: Path = MODEL_CACHE_PATH) -> None:
        self.cache_path = cache_path
        self.block_threshold: float = DEFAULT_BLOCK_THRESHOLD
        self.review_threshold: float = DEFAULT_REVIEW_THRESHOLD
        self.training_time_ms: float = 0.0
        self.pipeline: Pipeline = self._load_or_train()

    def _load_or_train(self) -> Pipeline:
        t0 = time.perf_counter()
        if self.cache_path.exists():
            try:
                loaded = joblib.load(self.cache_path)
                if isinstance(loaded, Pipeline):
                    self.training_time_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                    return loaded
            except Exception:
                pass

        X, y = _generate_historical_dataset()
        pipeline = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", LogisticRegression(C=1.5, max_iter=500, random_state=42)),
            ]
        )
        pipeline.fit(X, y)
        try:
            joblib.dump(pipeline, self.cache_path)
        except Exception:
            pass
        self.training_time_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        return pipeline

    def update_thresholds(
        self,
        block_threshold: Optional[float] = None,
        review_threshold: Optional[float] = None,
    ) -> Dict[str, float]:
        if review_threshold is not None:
            self.review_threshold = max(1.0, min(99.0, float(review_threshold)))
        if block_threshold is not None:
            self.block_threshold = max(self.review_threshold, min(99.9, float(block_threshold)))
        elif self.block_threshold < self.review_threshold:
            self.block_threshold = self.review_threshold
        return self.get_config()

    def reset_thresholds(self) -> Dict[str, float]:
        self.block_threshold = DEFAULT_BLOCK_THRESHOLD
        self.review_threshold = DEFAULT_REVIEW_THRESHOLD
        return self.get_config()

    def get_config(self) -> Dict[str, Any]:
        return {
            "model_version": MODEL_VERSION,
            "model_type": "Pipeline(StandardScaler + LogisticRegression)",
            "features_count": len(FEATURE_NAMES),
            "feature_names": list(FEATURE_NAMES),
            "block_threshold": self.block_threshold,
            "review_threshold": self.review_threshold,
            "training_time_ms": self.training_time_ms,
        }

    def score_batch(self, transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not transactions:
            return []

        t0 = time.perf_counter()
        vectors: List[np.ndarray] = []
        raw_maps: List[Dict[str, float]] = []
        for tx in transactions:
            vec, raw = extract_features(tx)
            vectors.append(vec)
            raw_maps.append(raw)

        X = np.vstack(vectors)
        probs = self.pipeline.predict_proba(X)[:, 1]
        scaler: StandardScaler = self.pipeline.named_steps["scaler"]
        clf: LogisticRegression = self.pipeline.named_steps["clf"]
        X_scaled = scaler.transform(X)
        coefs = clf.coef_[0]
        batch_elapsed_ms = (time.perf_counter() - t0) * 1000.0
        per_tx_latency_ms = round(batch_elapsed_ms / max(1, len(transactions)), 3)

        results: List[Dict[str, Any]] = []
        for idx, tx in enumerate(transactions):
            tx_id = str(tx.get("transaction_id") or tx.get("transaction_code") or f"TX-{idx}")
            risk_score = round(float(probs[idx]) * 100.0, 2)

            if risk_score >= self.block_threshold:
                decision = "BLOCK"
                routing_action = "block"
                predicted_label = 1
            elif risk_score >= self.review_threshold:
                decision = "REVIEW"
                routing_action = "review"
                predicted_label = 0
            else:
                decision = "ALLOW"
                routing_action = "allow"
                predicted_label = 0

            if risk_score >= 80.0:
                risk_level = "critical"
            elif risk_score >= 55.0:
                risk_level = "high"
            elif risk_score >= 30.0:
                risk_level = "medium"
            else:
                risk_level = "low"

            # Compute linear log-odds feature contributions for explainability
            contribs = X_scaled[idx] * coefs
            paired = sorted(
                zip(FEATURE_NAMES, contribs, raw_maps[idx].values()),
                key=lambda item: item[1],
                reverse=True,
            )

            reason_codes: List[str] = []
            trace_rules: List[Dict[str, Any]] = []
            for fname, contrib, actual_val in paired:
                label, unit = FEATURE_REASON_LABELS[fname]
                triggered = bool(contrib > 0.25 and actual_val > 0)
                if triggered:
                    reason_codes.append(label)
                trace_rules.append(
                    {
                        "rule_name": label,
                        "triggered": triggered,
                        "score_contribution": round(float(contrib) * 10.0, 2),
                        "actual_value": actual_val,
                        "threshold_value": None,
                        "metric_unit": unit,
                    }
                )

            results.append(
                {
                    "transaction_id": tx_id,
                    "decision": decision,
                    "routing_action": routing_action,
                    "predicted_label": predicted_label,
                    "risk_score": risk_score,
                    "risk_level": risk_level,
                    "reason_codes": reason_codes[:5],
                    "triggered_rules": reason_codes[:5],
                    "latency_ms": per_tx_latency_ms,
                    "decision_trace": {
                        "risk_score": risk_score,
                        "decision_threshold": self.block_threshold,
                        "review_threshold": self.review_threshold,
                        "decision": routing_action,
                        "predicted_label": predicted_label,
                        "rules": trace_rules,
                    },
                }
            )

        return results
