"""Configurable Anti-Fraud Defense Engine 2.0 with causal evaluation and transparent multi-factor scoring."""

from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
from datetime import datetime
from typing import Any, Deque, Dict, Iterable, List, Optional


DEFAULT_RISK_LEVELS: Dict[str, float] = {
    "low_max": 30.0,
    "medium_max": 55.0,
    "high_max": 80.0,
}

DEFAULT_RULES_CONFIG: Dict[str, Dict[str, Any]] = {
    "unusual_amount": {
        "enabled": True,
        "threshold": 4.8,
        "weight": 30.0,
        "min_amount_kzt": 25000.0,
        "description": "Detects amounts exceeding customer's typical maximum by the configured multiplier, weighted by z-score and P2P/channel context.",
    },
    "new_recipient_risk": {
        "enabled": True,
        "threshold": 2.0,
        "weight": 26.0,
        "context_amount_ratio": 2.2,
        "description": "Evaluates new recipients only when combined with contextual risk factors (amount, hour, channel).",
    },
    "duplicate_payment": {
        "enabled": True,
        "threshold": 1.0,
        "weight": 34.0,
        "window_minutes": 5,
        "amount_tolerance_pct": 0.015,
        "description": "Flags repeated transfers to the same recipient with near-identical amounts inside the time window.",
    },
    "unusual_frequency": {
        "enabled": True,
        "threshold": 5.0,
        "weight": 26.0,
        "window_minutes": 60,
        "description": "Monitors rolling transaction counts within the configured minute window (adjusted for business profiles).",
    },
    "suspicious_sequence": {
        "enabled": True,
        "threshold": 4.0,
        "weight": 28.0,
        "window_minutes": 15,
        "night_bonus": 12.0,
        "description": "Detects rapid multi-step bursts, nocturnal cascades, and atypical P2P sequences.",
    },
    "structuring_smurfing": {
        "enabled": True,
        "threshold": 4.0,
        "weight": 24.0,
        "window_minutes": 20,
        "context_amount_ratio": 3.0,
        "description": "Detects 3–5 near-threshold transfers structured inside a short rolling window.",
    },
    "account_takeover_ato": {
        "enabled": True,
        "threshold": 2.0,
        "weight": 24.0,
        "window_minutes": 10,
        "context_amount_ratio": 3.2,
        "description": "Detects device or geo shifts followed rapidly by an atypical transfer to a new recipient.",
    },
}

DEFAULT_DECISION_THRESHOLD = 55.0


def get_default_config_payload() -> Dict[str, Any]:
    return {
        "name": "Defense Baseline",
        "version": "Defense v1.0",
        "description": "Initial baseline anti-fraud rule configuration before Defense Evolution.",
        "is_baseline": True,
        "decision_threshold": DEFAULT_DECISION_THRESHOLD,
        "risk_levels_json": deepcopy(DEFAULT_RISK_LEVELS),
        "rules_config_json": deepcopy(DEFAULT_RULES_CONFIG),
        "changed_params_json": [],
    }


def classify_risk_level(score: float, risk_levels: Dict[str, float]) -> str:
    low_max = float(risk_levels.get("low_max", 30.0))
    medium_max = float(risk_levels.get("medium_max", 55.0))
    high_max = float(risk_levels.get("high_max", 80.0))
    if score < low_max:
        return "low"
    if score < medium_max:
        return "medium"
    if score < high_max:
        return "high"
    return "critical"


def compute_config_diff(
    parent_rules: Dict[str, Dict[str, Any]],
    new_rules: Dict[str, Dict[str, Any]],
    parent_threshold: float,
    new_threshold: float,
) -> List[Dict[str, Any]]:
    diffs: List[Dict[str, Any]] = []
    if round(parent_threshold, 4) != round(new_threshold, 4):
        diffs.append(
            {
                "rule": "global",
                "param": "decision_threshold",
                "old_value": parent_threshold,
                "new_value": new_threshold,
            }
        )
    all_rules = sorted(set(parent_rules.keys()) | set(new_rules.keys()))
    for rule_name in all_rules:
        old_r = parent_rules.get(rule_name, {})
        new_r = new_rules.get(rule_name, {})
        for key in sorted(set(old_r.keys()) | set(new_r.keys())):
            if key == "description":
                continue
            if old_r.get(key) != new_r.get(key):
                diffs.append(
                    {
                        "rule": rule_name,
                        "param": key,
                        "old_value": old_r.get(key),
                        "new_value": new_r.get(key),
                    }
                )
    return diffs


def _is_business_profile(cust: Dict[str, Any]) -> bool:
    return cust.get("customer_type") in ("business", "small_business", "medium_business")


class DefenseEngine:
    """
    Deterministic, transparent rule-based anti-fraud engine.
    Strictly blind to ground_truth_label and scenario_type.
    """

    def __init__(
        self,
        rules_config: Dict[str, Dict[str, Any]],
        decision_threshold: float = DEFAULT_DECISION_THRESHOLD,
        risk_levels: Optional[Dict[str, float]] = None,
    ) -> None:
        self.rules_config = rules_config
        self.decision_threshold = float(decision_threshold)
        self.risk_levels = risk_levels or deepcopy(DEFAULT_RISK_LEVELS)

    def evaluate_transactions(
        self,
        transactions: Iterable[Dict[str, Any]],
        customers_by_code: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Evaluate sanitized transactions chronologically using only observable
        transaction attributes, customer baseline profiles, and causal prior history.
        """
        sorted_txs = sorted(transactions, key=lambda t: (t["timestamp"], t["id"]))
        customer_history: Dict[str, Deque[Dict[str, Any]]] = defaultdict(deque)
        results: List[Dict[str, Any]] = []

        for tx in sorted_txs:
            # Anti-leakage assertion: engine must never receive ground_truth_label or scenario_type
            if "ground_truth_label" in tx or "scenario_type" in tx:
                raise ValueError("Security violation: ground_truth_label or scenario_type leaked into DefenseEngine")

            cust_code = tx["customer_code"]
            cust = customers_by_code.get(cust_code, {})
            ts: datetime = tx["timestamp"]
            hist = customer_history[cust_code]

            while hist and (ts - hist[0]["timestamp"]).total_seconds() > 86400:
                hist.popleft()

            triggered_rules: List[Dict[str, Any]] = []
            rule_traces: List[Dict[str, Any]] = []
            reasons: List[str] = []
            total_score = 0.0

            # 1. Unusual Amount Rule (with multi-factor severity & transfer context)
            ua_cfg = self.rules_config.get("unusual_amount", {})
            if ua_cfg.get("enabled", False):
                typical_max = float(cust.get("typical_amount_max_kzt", 50000.0))
                avg_amt = float(cust.get("avg_amount_kzt", 25000.0))
                std_amt = max(float(cust.get("std_amount_kzt", 10000.0)), 1000.0)
                min_amt = float(ua_cfg.get("min_amount_kzt", 25000.0))
                ratio = float(tx["amount_kzt"]) / max(typical_max, 1.0)
                z_score = (float(tx["amount_kzt"]) - avg_amt) / std_amt
                thresh = float(ua_cfg.get("threshold", 4.8))
                weight = float(ua_cfg.get("weight", 30.0))
                ua_contrib = 0.0
                ua_hit = tx["amount_kzt"] >= min_amt and ratio >= thresh

                if ua_hit:
                    excess = min(1.5, (ratio - thresh) / max(thresh, 1.0))
                    ctx_bonus = 0.0
                    ua_factors: List[str] = [f"{ratio:.1f}x_max"]

                    # Secondary contextual signals on high-value outlier transfers
                    if tx["transaction_type"] == "p2p_transfer" and tx["channel"] in ("mobile_app", "api_gateway"):
                        ctx_bonus += 13.0
                        ua_factors.append("p2p_digital_channel")
                    if 0 <= ts.hour <= 5:
                        ctx_bonus += 10.0
                        ua_factors.append("nocturnal_hour")
                    if ratio >= thresh * 1.35 or z_score >= 11.0:
                        ctx_bonus += 8.0
                        ua_factors.append(f"z={z_score:.1f}")
                    if int(cust.get("account_age_days", 365)) < 90:
                        ctx_bonus += 5.0
                        ua_factors.append("young_account")

                    raw_contrib = weight + excess * 7.0 + ctx_bonus

                    # Safeguard: routine daytime merchant/POS or B2B invoice to known payee is dampened
                    is_daytime_commerce = (
                        tx["transaction_type"] in ("merchant_payment", "b2b_invoice", "bill_payment")
                        and tx["channel"] in ("web_banking", "card_pos")
                        and not tx["is_new_recipient"]
                        and not (0 <= ts.hour <= 5)
                    )
                    if is_daytime_commerce:
                        raw_contrib *= 0.68
                        ua_factors.append("commerce_dampened")

                    ua_contrib = round(min(60.0, raw_contrib), 2)
                    total_score += ua_contrib
                    reason = (
                        f"Amount {tx['amount_kzt']:,.0f} KZT is {ratio:.1f}x customer typical max "
                        f"({typical_max:,.0f} KZT; z={z_score:.1f})"
                    )
                    triggered_rules.append(
                        {
                            "rule": "unusual_amount",
                            "contribution": ua_contrib,
                            "ratio": round(ratio, 2),
                            "z_score": round(z_score, 1),
                            "factors": ua_factors,
                        }
                    )
                    reasons.append(reason)
                rule_traces.append(
                    {
                        "rule_name": "unusual_amount",
                        "triggered": ua_hit,
                        "score_contribution": ua_contrib,
                        "actual_value": round(ratio, 2),
                        "threshold_value": round(thresh, 2),
                        "metric_unit": "x_max",
                        "detail": (
                            f"min_amount={min_amt:,.0f}" if tx["amount_kzt"] < min_amt else None
                        ),
                    }
                )

            # 2. New Recipient Risk Rule (requires new recipient + contextual risk factors)
            nr_cfg = self.rules_config.get("new_recipient_risk", {})
            if nr_cfg.get("enabled", False):
                avg_amt = float(cust.get("avg_amount_kzt", 25000.0))
                typical_max = float(cust.get("typical_amount_max_kzt", 50000.0))
                ctx_ratio = float(nr_cfg.get("context_amount_ratio", 2.2))
                min_factors = max(1, int(round(float(nr_cfg.get("threshold", 2.0)))))
                weight = float(nr_cfg.get("weight", 26.0))

                factors: List[str] = []
                if bool(tx["is_new_recipient"]):
                    if tx["amount_kzt"] >= avg_amt * ctx_ratio:
                        factors.append("elevated_amount")
                    if 0 <= ts.hour <= 5:
                        factors.append("nocturnal_hour")
                    if tx["channel"] in ("mobile_app", "api_gateway") and tx["transaction_type"] == "p2p_transfer":
                        if int(cust.get("account_age_days", 365)) < 180 or tx["amount_kzt"] > typical_max * 0.85:
                            factors.append("high_risk_channel_context")

                nr_hit = bool(tx["is_new_recipient"]) and len(factors) >= min_factors
                nr_contrib = 0.0
                if nr_hit:
                    if len(factors) >= 3:
                        bonus = 28.0
                    elif (
                        len(factors) == 2
                        and tx["transaction_type"] == "p2p_transfer"
                        and tx["amount_kzt"] >= typical_max * 1.45
                    ):
                        bonus = 23.5
                    else:
                        bonus = 10.0
                    nr_contrib = round(min(62.0, weight + bonus), 2)
                    total_score += nr_contrib
                    triggered_rules.append(
                        {"rule": "new_recipient_risk", "contribution": nr_contrib, "factors": factors}
                    )
                    reasons.append(f"New recipient with contextual signals: {', '.join(factors)}")
                rule_traces.append(
                    {
                        "rule_name": "new_recipient_risk",
                        "triggered": nr_hit,
                        "score_contribution": nr_contrib,
                        "actual_value": len(factors) if bool(tx["is_new_recipient"]) else 0,
                        "threshold_value": min_factors,
                        "metric_unit": "signals",
                        "detail": "known_recipient" if not bool(tx["is_new_recipient"]) else None,
                    }
                )

            # 3. Duplicate Payment Rule
            dp_cfg = self.rules_config.get("duplicate_payment", {})
            if dp_cfg.get("enabled", False):
                win_min = float(dp_cfg.get("window_minutes", 5))
                tol = float(dp_cfg.get("amount_tolerance_pct", 0.015))
                weight = float(dp_cfg.get("weight", 34.0))
                min_matches = max(1, int(round(float(dp_cfg.get("threshold", 1.0)))))

                matches = 0
                min_delay = None
                closest_delay = None
                for prev in reversed(hist):
                    dt_min = (ts - prev["timestamp"]).total_seconds() / 60.0
                    if prev["recipient_code"] == tx["recipient_code"]:
                        diff_pct = abs(tx["amount_kzt"] - prev["amount_kzt"]) / max(prev["amount_kzt"], 1.0)
                        if diff_pct <= tol and (closest_delay is None or dt_min < closest_delay):
                            closest_delay = dt_min
                    if dt_min > win_min:
                        continue
                    if prev["recipient_code"] == tx["recipient_code"]:
                        diff_pct = abs(tx["amount_kzt"] - prev["amount_kzt"]) / max(prev["amount_kzt"], 1.0)
                        if diff_pct <= tol:
                            matches += 1
                            if min_delay is None or dt_min < min_delay:
                                min_delay = dt_min

                dp_hit = matches >= min_matches
                dp_contrib = 0.0
                if dp_hit:
                    ctx_bonus = 0.0
                    if tx["is_new_recipient"]:
                        ctx_bonus += 14.0
                    if 0 <= ts.hour <= 5:
                        ctx_bonus += 10.0
                    if tx["amount_kzt"] >= float(cust.get("avg_amount_kzt", 25000.0)) * 0.9:
                        ctx_bonus += 10.0
                    if tx["transaction_type"] == "p2p_transfer":
                        ctx_bonus += 6.0
                    dp_contrib = round(min(60.0, weight + ctx_bonus), 2)
                    total_score += dp_contrib
                    triggered_rules.append(
                        {
                            "rule": "duplicate_payment",
                            "contribution": dp_contrib,
                            "matches": matches,
                            "delay_minutes": round(min_delay or 0.0, 1),
                        }
                    )
                    reasons.append(
                        f"Near-identical transfer to {tx['recipient_code']} repeated within {min_delay:.1f} min"
                    )
                rule_traces.append(
                    {
                        "rule_name": "duplicate_payment",
                        "triggered": dp_hit,
                        "score_contribution": dp_contrib,
                        "actual_value": (
                            round(closest_delay, 1)
                            if not dp_hit and closest_delay is not None
                            else matches
                        ),
                        "threshold_value": (
                            round(win_min, 1)
                            if not dp_hit and closest_delay is not None
                            else min_matches
                        ),
                        "metric_unit": (
                            "min"
                            if not dp_hit and closest_delay is not None
                            else "matches"
                        ),
                    }
                )

            # 4. Unusual Frequency Rule
            uf_cfg = self.rules_config.get("unusual_frequency", {})
            if uf_cfg.get("enabled", False):
                win_min = float(uf_cfg.get("window_minutes", 60))
                base_thresh = float(uf_cfg.get("threshold", 5.0))
                weight = float(uf_cfg.get("weight", 26.0))
                is_business = _is_business_profile(cust)
                eff_thresh = base_thresh * 1.5 if is_business else base_thresh

                count_in_win = 1 + sum(
                    1 for prev in hist if (ts - prev["timestamp"]).total_seconds() / 60.0 <= win_min
                )
                uf_hit = count_in_win >= eff_thresh
                uf_contrib = 0.0
                if uf_hit:
                    uf_contrib = round(min(38.0, weight + (count_in_win - eff_thresh) * 2.0), 2)
                    total_score += uf_contrib
                    triggered_rules.append(
                        {
                            "rule": "unusual_frequency",
                            "contribution": uf_contrib,
                            "count_in_window": count_in_win,
                        }
                    )
                    reasons.append(f"High velocity: {count_in_win} transactions within {int(win_min)} min")
                rule_traces.append(
                    {
                        "rule_name": "unusual_frequency",
                        "triggered": uf_hit,
                        "score_contribution": uf_contrib,
                        "actual_value": count_in_win,
                        "threshold_value": round(eff_thresh, 1),
                        "metric_unit": f"tx/{int(win_min)}m",
                    }
                )

            # 5. Suspicious Sequence Rule
            ss_cfg = self.rules_config.get("suspicious_sequence", {})
            if ss_cfg.get("enabled", False):
                win_min = float(ss_cfg.get("window_minutes", 15))
                burst_thresh = max(2, int(round(float(ss_cfg.get("threshold", 4.0)))))
                weight = float(ss_cfg.get("weight", 28.0))
                night_bonus = float(ss_cfg.get("night_bonus", 12.0))

                recent_seq = [
                    prev for prev in hist if (ts - prev["timestamp"]).total_seconds() / 60.0 <= win_min
                ]
                seq_count = len(recent_seq) + 1
                is_night = 0 <= ts.hour <= 5
                new_rec_in_seq = sum(1 for p in recent_seq if p["is_new_recipient"]) + (
                    1 if tx["is_new_recipient"] else 0
                )

                seq_hit = seq_count >= burst_thresh or (
                    is_night and seq_count >= max(2, burst_thresh - 1) and new_rec_in_seq >= 2
                )
                ss_contrib = 0.0
                if seq_hit:
                    is_routine_biz = (
                        _is_business_profile(cust)
                        and tx["transaction_type"] == "b2b_invoice"
                        and not tx["is_new_recipient"]
                        and not is_night
                    )
                    raw_contrib = weight + (night_bonus if is_night else 0.0) + (
                        6.0 if new_rec_in_seq >= 2 else 0.0
                    )
                    if is_routine_biz:
                        raw_contrib *= 0.45
                    ss_contrib = round(min(46.0, raw_contrib), 2)
                    total_score += ss_contrib
                    triggered_rules.append(
                        {
                            "rule": "suspicious_sequence",
                            "contribution": ss_contrib,
                            "seq_count": seq_count,
                            "is_night": is_night,
                        }
                    )
                    reasons.append(
                        f"Rapid sequence ({seq_count} ops in {int(win_min)} min"
                        + (", nocturnal" if is_night else "")
                        + ")"
                    )
                rule_traces.append(
                    {
                        "rule_name": "suspicious_sequence",
                        "triggered": seq_hit,
                        "score_contribution": ss_contrib,
                        "actual_value": seq_count,
                        "threshold_value": burst_thresh,
                        "metric_unit": f"tx/{int(win_min)}m",
                    }
                )

            # 6. Structuring / Smurfing Rule (cumulative multi-slice volume just below single-tx thresholds)
            sm_cfg = self.rules_config.get("structuring_smurfing", {})
            if sm_cfg.get("enabled", False):
                win_min = float(sm_cfg.get("window_minutes", 20))
                min_slices = max(2, int(round(float(sm_cfg.get("threshold", 4.0)))))
                weight = float(sm_cfg.get("weight", 24.0))
                cum_ratio_thresh = float(sm_cfg.get("context_amount_ratio", 3.0))
                typical_max = float(cust.get("typical_amount_max_kzt", 50000.0))

                recent_sm = [
                    prev for prev in hist if (ts - prev["timestamp"]).total_seconds() / 60.0 <= win_min
                ]
                slice_count = len(recent_sm) + 1
                window_sum = float(tx["amount_kzt"]) + sum(float(p["amount_kzt"]) for p in recent_sm)
                cum_ratio = window_sum / max(typical_max, 1.0)

                sm_hit = slice_count >= min_slices and cum_ratio >= cum_ratio_thresh
                sm_contrib = 0.0
                if sm_hit:
                    is_routine_commerce = (
                        tx["transaction_type"] in ("b2b_invoice", "merchant_payment", "bill_payment")
                        and not tx["is_new_recipient"]
                        and not (0 <= ts.hour <= 5)
                        and cum_ratio < cum_ratio_thresh * 1.15
                    )
                    excess_bonus = min(14.0, (cum_ratio - cum_ratio_thresh) * 6.0)
                    new_rec_bonus = 10.0 if tx["is_new_recipient"] else 5.0
                    raw_contrib = weight + excess_bonus + new_rec_bonus
                    if is_routine_commerce:
                        raw_contrib *= 0.45
                    sm_contrib = round(min(60.0, raw_contrib), 2)
                    total_score += sm_contrib
                    triggered_rules.append(
                        {
                            "rule": "structuring_smurfing",
                            "contribution": sm_contrib,
                            "slice_count": slice_count,
                            "cumulative_ratio": round(cum_ratio, 2),
                        }
                    )
                    reasons.append(
                        f"Structured split pattern ({slice_count} tx in {int(win_min)} min, cumulative {cum_ratio:.1f}x typical max)"
                    )
                rule_traces.append(
                    {
                        "rule_name": "structuring_smurfing",
                        "triggered": sm_hit,
                        "score_contribution": sm_contrib,
                        "actual_value": slice_count if slice_count < min_slices else round(cum_ratio, 2),
                        "threshold_value": min_slices if slice_count < min_slices else round(cum_ratio_thresh, 2),
                        "metric_unit": "slices" if slice_count < min_slices else "x_cum",
                    }
                )

            # 7. Account Takeover (ATO) Rule (device/geo shift + rapid transfer to new recipient + atypical amount)
            ato_cfg = self.rules_config.get("account_takeover_ato", {})
            device_changed = bool(tx.get("device_changed", False))
            geo_changed = bool(tx.get("geo_changed", False))
            mins_since_dev = tx.get("minutes_since_device_change")
            if ato_cfg.get("enabled", False):
                win_min = float(ato_cfg.get("window_minutes", 10))
                weight = float(ato_cfg.get("weight", 24.0))
                amt_ratio_thresh = float(ato_cfg.get("context_amount_ratio", 3.2))
                typical_max = float(cust.get("typical_amount_max_kzt", 50000.0))
                ratio = float(tx["amount_kzt"]) / max(typical_max, 1.0)
                rapid_after_change = (
                    (device_changed or geo_changed)
                    and mins_since_dev is not None
                    and 0.0 <= float(mins_since_dev) <= win_min
                )

                ato_factors: List[str] = []
                if device_changed or geo_changed:
                    if device_changed:
                        ato_factors.append("device_changed")
                    if geo_changed:
                        ato_factors.append("geo_changed")
                    if rapid_after_change:
                        ato_factors.append(f"rapid_{float(mins_since_dev):.0f}m")
                    if tx["is_new_recipient"]:
                        ato_factors.append("new_recipient")
                    if ratio >= amt_ratio_thresh:
                        ato_factors.append(f"{ratio:.1f}x_max")

                min_signals = max(2, int(round(float(ato_cfg.get("threshold", 2.0)))))
                ato_hit = (
                    (device_changed or geo_changed)
                    and len(ato_factors) >= min_signals
                    and (rapid_after_change or ratio >= amt_ratio_thresh)
                    and bool(tx["is_new_recipient"])
                    and ratio >= 1.45
                )
                ato_contrib = 0.0
                if ato_hit:
                    bonus = 0.0
                    if device_changed and geo_changed:
                        bonus += 10.0
                    if rapid_after_change:
                        bonus += 10.0
                    if ratio >= amt_ratio_thresh:
                        bonus += 10.0
                    if 0 <= ts.hour <= 5:
                        bonus += 6.0
                    ato_contrib = round(min(64.0, weight + bonus), 2)
                    total_score += ato_contrib
                    triggered_rules.append(
                        {
                            "rule": "account_takeover_ato",
                            "contribution": ato_contrib,
                            "factors": ato_factors,
                        }
                    )
                    reasons.append(f"Account takeover indicators: {', '.join(ato_factors)}")
                rule_traces.append(
                    {
                        "rule_name": "account_takeover_ato",
                        "triggered": ato_hit,
                        "score_contribution": ato_contrib,
                        "actual_value": len(ato_factors),
                        "threshold_value": min_signals,
                        "metric_unit": "signals",
                        "detail": (
                            f"dev_age={float(mins_since_dev):.0f}m/win={int(win_min)}m"
                            if (device_changed or geo_changed) and mins_since_dev is not None
                            else None
                        ),
                    }
                )

            final_score = round(min(100.0, total_score), 2)
            risk_level = classify_risk_level(final_score, self.risk_levels)
            predicted_label = 1 if final_score >= self.decision_threshold else 0
            low_max = float(self.risk_levels.get("low_max", 30.0))
            routing_action = (
                "block"
                if predicted_label == 1
                else ("review" if final_score >= low_max else "allow")
            )

            if not reasons:
                explanation = "No defensive rule thresholds exceeded; activity within expected profile."
            else:
                explanation = "; ".join(reasons) + "."

            decision_trace = {
                "risk_score": final_score,
                "decision_threshold": round(self.decision_threshold, 2),
                "review_threshold": round(low_max, 2),
                "decision": routing_action,
                "predicted_label": predicted_label,
                "rules": rule_traces,
            }

            results.append(
                {
                    "transaction_id": tx["id"],
                    "transaction_code": tx["transaction_code"],
                    "customer_code": cust_code,
                    "recipient_code": tx["recipient_code"],
                    "amount_kzt": tx["amount_kzt"],
                    "timestamp": ts,
                    "split_name": tx["split_name"],
                    "risk_score": final_score,
                    "risk_level": risk_level,
                    "predicted_label": predicted_label,
                    "routing_action": routing_action,
                    "triggered_rules": triggered_rules,
                    "decision_trace": decision_trace,
                    "explanation": explanation,
                }
            )

            hist.append(
                {
                    "timestamp": ts,
                    "recipient_code": tx["recipient_code"],
                    "amount_kzt": tx["amount_kzt"],
                    "is_new_recipient": tx["is_new_recipient"],
                }
            )

        return results
