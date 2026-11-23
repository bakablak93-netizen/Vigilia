"""Antifraud Connector Engine: unified, security-hardened interface for Internal, External HTTP, and Imported engines."""

from __future__ import annotations

import csv
import io
import json
import math
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

import httpx

ALLOWED_LOOPBACK_HOSTS = {"127.0.0.1", "localhost"}
ALLOWED_EXTERNAL_PORTS = {8010, 8011, 8012, 8020}
FORBIDDEN_LEAKAGE_FIELDS = frozenset(
    {"ground_truth_label", "scenario_type", "split_name", "metadata_json"}
)

DEFAULT_BATCH_SIZE = 250
MAX_BATCH_SIZE = 500
DEFAULT_TIMEOUT_SEC = 8.0
MAX_IMPORT_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_IMPORT_ROWS = 20_000


class ConnectorSecurityError(ValueError):
    """Raised when an external engine URL or payload violates security policy."""


class ConnectorUnavailableError(RuntimeError):
    """Raised when a registered external antifraud service cannot be reached or returns an error."""


def validate_allowed_engine_url(url: str) -> str:
    """
    Strictly allow only pre-registered local loopback test endpoints on approved ports.
    Blocks arbitrary external URLs, userinfo tricks, non-HTTP schemes, and non-loopback hosts.
    """
    if not url or not isinstance(url, str):
        raise ConnectorSecurityError("External engine URL is required.")
    parsed = urlparse(url.strip())
    if parsed.scheme != "http":
        raise ConnectorSecurityError("Only http:// local loopback endpoints are permitted in this sandbox.")
    if parsed.username or parsed.password:
        raise ConnectorSecurityError("Credentials in URL are not permitted.")
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_LOOPBACK_HOSTS:
        raise ConnectorSecurityError(
            f"Host '{host}' is blocked by security policy. Only local loopback test addresses are allowed."
        )
    if parsed.port not in ALLOWED_EXTERNAL_PORTS:
        raise ConnectorSecurityError(
            f"Port '{parsed.port}' is blocked by security policy. Allowed local test ports: {sorted(ALLOWED_EXTERNAL_PORTS)}."
        )
    return f"http://{host}:{parsed.port}"


def sanitize_transactions_for_external(tx_rows: Sequence[Any]) -> List[Dict[str, Any]]:
    """
    Build Standard Antifraud API Protocol payloads strictly omitting ground truth,
    scenario labels, splits, and simulator metadata.
    """
    sanitized: List[Dict[str, Any]] = []
    for row in tx_rows:
        if isinstance(row, dict):
            meta = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
            item = {
                "transaction_id": str(row.get("transaction_code") or row.get("transaction_id")),
                "customer_id": str(row.get("customer_code") or row.get("customer_id")),
                "amount_kzt": float(row["amount_kzt"]),
                "recipient_id": str(row.get("recipient_code") or row.get("recipient_id")),
                "timestamp": (
                    row["timestamp"].isoformat()
                    if hasattr(row["timestamp"], "isoformat")
                    else str(row["timestamp"])
                ),
                "channel": str(row.get("channel", "mobile_app")),
                "transaction_type": str(row.get("transaction_type", "p2p_transfer")),
                "is_new_recipient": bool(row.get("is_new_recipient", False)),
                "customer_segment": str(row.get("customer_segment", "retail_standard")),
                "transaction_frequency": float(row.get("transaction_frequency", 1.0)),
                "device_changed": bool(row.get("device_changed", meta.get("device_changed", False))),
                "geo_changed": bool(row.get("geo_changed", meta.get("geo_changed", False))),
                "minutes_since_device_change": row.get(
                    "minutes_since_device_change",
                    meta.get("minutes_since_device_change"),
                ),
            }
        else:
            meta = getattr(row, "metadata_json", None) or {}
            item = {
                "transaction_id": str(row.transaction_code),
                "customer_id": str(row.customer_code),
                "amount_kzt": float(row.amount_kzt),
                "recipient_id": str(row.recipient_code),
                "timestamp": row.timestamp.isoformat(),
                "channel": str(row.channel),
                "transaction_type": str(row.transaction_type),
                "is_new_recipient": bool(row.is_new_recipient),
                "customer_segment": str(row.customer_segment),
                "transaction_frequency": float(row.transaction_frequency),
                "device_changed": bool(meta.get("device_changed", False)),
                "geo_changed": bool(meta.get("geo_changed", False)),
                "minutes_since_device_change": meta.get("minutes_since_device_change"),
            }

        leaked = FORBIDDEN_LEAKAGE_FIELDS.intersection(item.keys())
        if leaked:  # pragma: no cover
            raise ConnectorSecurityError(f"Leakage detected in external payload: {sorted(leaked)}")
        sanitized.append(item)
    return sanitized


def _normalize_predicted_label(raw: Any) -> Optional[int]:
    if isinstance(raw, bool):
        return 1 if raw else 0
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        if raw in (0, 1):
            return int(raw)
        return None
    if isinstance(raw, str):
        val = raw.strip().lower()
        if val in {"1", "true", "block", "blocked", "fraud", "risk", "high_risk"}:
            return 1
        if val in {"0", "false", "allow", "allowed", "legit", "legitimate", "normal"}:
            return 0
    return None


def _normalize_risk_score(raw: Any, score_scale: str = "auto") -> Tuple[Optional[float], bool]:
    """
    Normalize optional risk_score into 0..100 scale.
    Returns (normalized_score_or_none, is_valid).
    """
    if raw is None or raw == "":
        return None, True
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None, False
    if not math.isfinite(val):
        return None, False
    if score_scale == "unit" or (score_scale == "auto" and 0.0 <= val <= 1.0 and val not in (0.0, 1.0)):
        val = val * 100.0
    if val < 0.0 or val > 100.0:
        return None, False
    return round(val, 2), True


def _normalize_reason_codes(raw: Any) -> List[str]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()][:20]
    if isinstance(raw, str):
        stripped = raw.strip()
        if stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()][:20]
            except ValueError:
                pass
        sep = "|" if "|" in stripped else ","
        return [part.strip() for part in stripped.split(sep) if part.strip()][:20]
    return []


def _risk_level_from_score(score: Optional[float], predicted_label: int) -> str:
    if score is None:
        return "high" if predicted_label == 1 else "low"
    if score >= 80.0:
        return "critical"
    if score >= 55.0:
        return "high"
    if score >= 30.0:
        return "medium"
    return "low"


def match_and_normalize_predictions(
    expected_txs: Sequence[Any],
    raw_results: Sequence[Dict[str, Any]],
    score_scale: str = "auto",
    api_errors: Optional[List[str]] = None,
    batch_count: int = 1,
    failed_requests: int = 0,
) -> Dict[str, Any]:
    """
    Align external/imported predictions with expected dataset transactions strictly by transaction_id
    (order-independent), tracking missing, duplicate, unexpected, and invalid records without
    treating missing records as negative predictions.
    """
    expected_by_code: Dict[str, Any] = {}
    ordered_codes: List[str] = []
    for row in expected_txs:
        code = row["transaction_code"] if isinstance(row, dict) else row.transaction_code
        expected_by_code[str(code)] = row
        ordered_codes.append(str(code))

    matched_by_code: Dict[str, Dict[str, Any]] = {}
    duplicate_ids: List[str] = []
    unexpected_ids: List[str] = []
    invalid_records: List[str] = []
    has_any_risk_score = False

    for idx, rec in enumerate(raw_results):
        if not isinstance(rec, dict):
            invalid_records.append(f"row[{idx}]: not an object")
            continue
        tx_id = str(rec.get("transaction_id") or rec.get("transaction_code") or "").strip()
        if not tx_id:
            invalid_records.append(f"row[{idx}]: missing transaction_id")
            continue
        if tx_id not in expected_by_code:
            unexpected_ids.append(tx_id)
            continue
        if tx_id in matched_by_code:
            duplicate_ids.append(tx_id)
            continue

        pred_label = _normalize_predicted_label(rec.get("predicted_label"))
        if pred_label is None:
            invalid_records.append(f"{tx_id}: invalid predicted_label")
            continue

        norm_score, score_ok = _normalize_risk_score(rec.get("risk_score"), score_scale=score_scale)
        if not score_ok:
            invalid_records.append(f"{tx_id}: invalid risk_score")
            continue
        if norm_score is not None:
            has_any_risk_score = True

        reasons = _normalize_reason_codes(rec.get("reason_codes"))
        exp_row = expected_by_code[tx_id]
        if isinstance(exp_row, dict):
            tx_db_id = exp_row.get("id")
            cust_code = exp_row["customer_code"]
            rec_code = exp_row["recipient_code"]
            amount_kzt = exp_row["amount_kzt"]
            ts = exp_row["timestamp"]
            split_name = exp_row["split_name"]
        else:
            tx_db_id = getattr(exp_row, "id", None)
            cust_code = exp_row.customer_code
            rec_code = exp_row.recipient_code
            amount_kzt = exp_row.amount_kzt
            ts = exp_row.timestamp
            split_name = exp_row.split_name

        # Preserve empty triggered_rules when reason_codes are absent — never fabricate explanations
        triggered_rules = [{"rule": code, "contribution": 0.0} for code in reasons]
        routing_action = str(
            rec.get("routing_action")
            or ("block" if pred_label == 1 else ("review" if (norm_score is not None and 30.0 <= norm_score < 55.0) else "allow"))
        )
        raw_trace = rec.get("decision_trace")
        if isinstance(raw_trace, dict) and isinstance(raw_trace.get("rules"), list):
            decision_trace = raw_trace
        else:
            decision_trace = {
                "risk_score": float(norm_score) if norm_score is not None else None,
                "decision_threshold": None,
                "review_threshold": None,
                "decision": routing_action,
                "predicted_label": pred_label,
                "rules": [
                    {
                        "rule_name": code,
                        "triggered": True,
                        "score_contribution": None,
                        "actual_value": None,
                        "threshold_value": None,
                        "metric_unit": None,
                    }
                    for code in reasons
                ],
            }

        if reasons:
            explanation = f"External decision={pred_label}; reason_codes={', '.join(reasons)}."
        elif norm_score is not None:
            explanation = f"External decision={pred_label}; risk_score={norm_score:.1f} (no reason codes provided)."
        else:
            explanation = f"External decision={pred_label} (no risk score or reason codes provided)."

        matched_by_code[tx_id] = {
            "transaction_id": tx_db_id,
            "transaction_code": tx_id,
            "customer_code": cust_code,
            "recipient_code": rec_code,
            "amount_kzt": float(amount_kzt),
            "timestamp": ts,
            "split_name": split_name,
            "risk_score": float(norm_score) if norm_score is not None else (100.0 if pred_label == 1 else 0.0),
            "score_provided": norm_score is not None,
            "risk_level": str(rec.get("risk_level") or _risk_level_from_score(norm_score, pred_label)),
            "predicted_label": pred_label,
            "routing_action": routing_action,
            "triggered_rules": triggered_rules,
            "decision_trace": decision_trace,
            "reason_codes": reasons,
            "explanation": explanation,
        }

    ordered_predictions = [matched_by_code[c] for c in ordered_codes if c in matched_by_code]
    missing_ids = [c for c in ordered_codes if c not in matched_by_code]

    total_sent = len(ordered_codes)
    evaluated_count = len(ordered_predictions)
    completeness_ratio = round(evaluated_count / total_sent, 4) if total_sent > 0 else 0.0

    completeness = {
        "total_sent": total_sent,
        "received_count": len(raw_results),
        "evaluated_count": evaluated_count,
        "missing_count": len(missing_ids),
        "missing_ids_sample": missing_ids[:20],
        "duplicate_count": len(duplicate_ids),
        "unexpected_count": len(unexpected_ids),
        "invalid_count": len(invalid_records),
        "invalid_samples": invalid_records[:10],
        "completeness_ratio": completeness_ratio,
        "has_risk_scores": has_any_risk_score,
        "batch_count": batch_count,
        "failed_requests": failed_requests,
        "api_errors": api_errors or [],
    }

    return {
        "predictions": ordered_predictions,
        "completeness": completeness,
    }


def parse_imported_predictions(
    file_format: str,
    content: str,
) -> List[Dict[str, Any]]:
    """Parse and validate CSV or JSON imported predictions with strict size and row limits."""
    raw_bytes = content.encode("utf-8", errors="replace")
    if len(raw_bytes) > MAX_IMPORT_BYTES:
        raise ValueError(f"Import payload exceeds maximum allowed size ({MAX_IMPORT_BYTES // (1024 * 1024)} MB).")

    fmt = file_format.strip().lower()
    if fmt == "json":
        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON format: {exc}") from exc
        if isinstance(data, dict):
            for key in ("results", "predictions", "items", "data"):
                if isinstance(data.get(key), list):
                    data = data[key]
                    break
        if not isinstance(data, list):
            raise ValueError("JSON import must be a list of prediction objects or contain a 'results' list.")
        if len(data) > MAX_IMPORT_ROWS:
            raise ValueError(f"Imported row count exceeds limit ({MAX_IMPORT_ROWS}).")
        return data

    if fmt == "csv":
        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            raise ValueError("CSV import has no header row.")
        rows: List[Dict[str, Any]] = []
        for idx, row in enumerate(reader):
            if idx >= MAX_IMPORT_ROWS:
                raise ValueError(f"Imported CSV row count exceeds limit ({MAX_IMPORT_ROWS}).")
            rows.append(dict(row))
        return rows

    raise ValueError(f"Unsupported import format '{file_format}'. Expected 'csv' or 'json'.")


class ExternalHttpConnector:
    """Secure HTTP client adapter for registered loopback external antifraud services."""

    def __init__(
        self,
        base_url: str,
        timeout_sec: float = DEFAULT_TIMEOUT_SEC,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        self.base_url = validate_allowed_engine_url(base_url)
        self.timeout_sec = timeout_sec
        self.transport = transport

    def _client(self) -> httpx.Client:
        kwargs: Dict[str, Any] = {
            "base_url": self.base_url,
            "timeout": self.timeout_sec,
            "follow_redirects": False,
        }
        if self.transport is not None:
            kwargs["transport"] = self.transport
        return httpx.Client(**kwargs)

    def check_health(self) -> Dict[str, Any]:
        try:
            with self._client() as client:
                resp = client.get("/health")
                if 300 <= resp.status_code < 400:
                    return {"online": False, "error": "HTTP redirects are forbidden by security policy."}
                resp.raise_for_status()
                data = resp.json()
                return {"online": True, **data}
        except (httpx.HTTPError, ValueError) as exc:
            return {"online": False, "error": str(exc)}

    def fetch_config(self, profile: Optional[str] = None) -> Dict[str, Any]:
        params = {"profile": profile} if profile else None
        try:
            with self._client() as client:
                resp = client.get("/config", params=params)
                if 300 <= resp.status_code < 400:
                    raise ConnectorSecurityError("HTTP redirects are forbidden by security policy.")
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as exc:
            raise ConnectorUnavailableError(f"Failed to fetch external engine configuration: {exc}") from exc

    def analyze_transactions(
        self,
        tx_rows: Sequence[Any],
        profile: Optional[str] = None,
        config_override: Optional[Dict[str, Any]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> Dict[str, Any]:
        safe_batch_size = max(1, min(MAX_BATCH_SIZE, int(batch_size)))
        sanitized = sanitize_transactions_for_external(tx_rows)

        all_raw_results: List[Dict[str, Any]] = []
        api_errors: List[str] = []
        engine_version = ""
        total_ms = 0.0
        batch_count = 0
        failed_requests = 0

        try:
            with self._client() as client:
                for start in range(0, len(sanitized), safe_batch_size):
                    batch_count += 1
                    batch = sanitized[start : start + safe_batch_size]
                    payload: Dict[str, Any] = {
                        "protocol_version": "1.0",
                        "transactions": batch,
                    }
                    if profile:
                        payload["profile"] = profile
                    if config_override:
                        payload["config_override"] = config_override

                    t0 = time.perf_counter()
                    resp = client.post("/analyze", json=payload)
                    total_ms += (time.perf_counter() - t0) * 1000.0

                    if 300 <= resp.status_code < 400:
                        raise ConnectorSecurityError("HTTP redirects from external antifraud service are blocked.")
                    if resp.status_code >= 400:
                        failed_requests += 1
                        api_errors.append(f"Batch {start}:{start + len(batch)} HTTP {resp.status_code}")
                        continue

                    body = resp.json()
                    if not engine_version:
                        engine_version = str(body.get("engine_version") or "")
                    batch_results = body.get("results")
                    if not isinstance(batch_results, list):
                        failed_requests += 1
                        api_errors.append(f"Batch {start}:{start + len(batch)} missing results list")
                        continue
                    all_raw_results.extend(batch_results)

        except ConnectorSecurityError:
            raise
        except httpx.TimeoutException as exc:
            raise ConnectorUnavailableError(f"External antifraud service timed out: {exc}") from exc
        except httpx.ConnectError as exc:
            raise ConnectorUnavailableError(f"External antifraud service is unavailable: {exc}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ConnectorUnavailableError(f"External antifraud communication error: {exc}") from exc

        if api_errors and not all_raw_results:
            raise ConnectorUnavailableError("; ".join(api_errors))

        normalized = match_and_normalize_predictions(
            expected_txs=tx_rows,
            raw_results=all_raw_results,
            api_errors=api_errors,
            batch_count=batch_count,
            failed_requests=failed_requests,
        )
        return {
            "engine_version": engine_version or (profile or "external"),
            "processing_time_ms": round(total_ms, 2),
            **normalized,
        }
