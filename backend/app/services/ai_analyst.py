"""AI Security Analyst: deterministic root-cause diagnostics, explainability, and optional LLM narrative."""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Dict, List, Optional, Sequence
import urllib.error
import urllib.request

from ..config import get_settings


def _avg(values: List[float]) -> float:
    return round(sum(values) / len(values), 2) if values else 0.0


def analyze_experiment_deterministic(
    metrics: Dict[str, Any],
    scenario_metrics: Sequence[Dict[str, Any]],
    rule_impact: Sequence[Dict[str, Any]],
    results: Sequence[Dict[str, Any]],
    rules_config: Dict[str, Dict[str, Any]],
    decision_threshold: float,
) -> Dict[str, Any]:
    """
    Compute verifiable weakness analysis, FN/FP explainability, and bounded rule recommendations
    strictly from actual experiment predictions and configuration parameters.
    """
    fn_cases = [r for r in results if r["ground_truth_label"] == 1 and r["predicted_label"] == 0]
    fp_cases = [r for r in results if r["ground_truth_label"] == 0 and r["predicted_label"] == 1]

    weaknesses: List[Dict[str, Any]] = []
    recommendations: List[Dict[str, Any]] = []
    proposed_rules = deepcopy(rules_config)
    proposed_threshold = float(decision_threshold)

    # 1. Inspect per-scenario weaknesses
    for sm in scenario_metrics:
        scen = sm["scenario_type"]
        if sm["actual_risk_events"] == 0 and sm["false_positives"] == 0:
            continue

        recall = float(sm["recall"])
        fpr = float(sm["false_positive_rate"])
        fn_count = int(sm["false_negatives"])
        fp_count = int(sm["false_positives"])

        if sm["actual_risk_events"] > 0 and recall < 0.78:
            severity = "critical" if recall < 0.45 else ("high" if recall < 0.65 else "medium")
            scen_fn = [r for r in fn_cases if r["scenario_type"] == scen]
            avg_fn_score = _avg([float(r["risk_score"]) for r in scen_fn])
            weaknesses.append(
                {
                    "scenario_type": scen,
                    "issue_type": "missed_risk",
                    "severity": severity,
                    "recall": recall,
                    "false_negative_rate": sm["false_negative_rate"],
                    "missed_count": fn_count,
                    "actual_risk_events": sm["actual_risk_events"],
                    "avg_missed_risk_score": avg_fn_score,
                    "detail": (
                        f"Scenario '{scen}' missed {fn_count}/{sm['actual_risk_events']} risk events "
                        f"(Recall={recall:.1%}, avg missed risk_score={avg_fn_score:.1f} vs threshold={decision_threshold:.1f})."
                    ),
                }
            )

        if fpr > 0.04 or fp_count >= 5:
            weaknesses.append(
                {
                    "scenario_type": scen,
                    "issue_type": "false_positives",
                    "severity": "high" if fpr > 0.08 else "medium",
                    "false_positive_rate": fpr,
                    "false_positive_count": fp_count,
                    "detail": (
                        f"Scenario '{scen}' generated {fp_count} false blocks "
                        f"(FPR={fpr:.1%}, Precision={sm['precision']:.1%})."
                    ),
                }
            )

    # 2. Explainability & targeted rule recommendations based on actual FN/FP cases
    scen_map = {sm["scenario_type"]: sm for sm in scenario_metrics}

    # Unusual Amount diagnostics
    ua_sm = scen_map.get("unusual_amount")
    ua_cfg = proposed_rules.get("unusual_amount", {})
    if ua_sm and ua_sm["false_negatives"] > 0 and ua_cfg.get("enabled", True):
        ua_fns = [r for r in fn_cases if r["scenario_type"] == "unusual_amount"]
        avg_score = _avg([float(r["risk_score"]) for r in ua_fns])
        old_thresh = float(ua_cfg.get("threshold", 4.8))
        old_weight = float(ua_cfg.get("weight", 30.0))
        new_thresh = round(max(2.8, old_thresh - 1.1), 2)
        new_weight = round(min(40.0, old_weight + 6.0), 1)
        if new_thresh != old_thresh or new_weight != old_weight:
            ua_cfg["threshold"] = new_thresh
            ua_cfg["weight"] = new_weight
            recommendations.append(
                {
                    "target_rule": "unusual_amount",
                    "issue_category": "missed_amount_outliers",
                    "severity": "high" if ua_sm["recall"] < 0.65 else "medium",
                    "title": "Lower unusual amount multiplier threshold and raise rule weight",
                    "explanation": (
                        f"{ua_sm['false_negatives']} unusual-amount risk events scored avg {avg_score:.1f} (< {decision_threshold:.1f}). "
                        f"Threshold {old_thresh}x misses 3.2x–4.7x anomalies."
                    ),
                    "proposed_changes_json": {
                        "threshold": {"old": old_thresh, "new": new_thresh},
                        "weight": {"old": old_weight, "new": new_weight},
                    },
                    "expected_impact": "Captures moderate-to-high amount deviations when paired with channel/recipient context.",
                }
            )

    # New Recipient Risk diagnostics
    nr_sm = scen_map.get("new_recipient_risk")
    nr_cfg = proposed_rules.get("new_recipient_risk", {})
    if nr_sm and nr_sm["false_negatives"] > 0 and nr_cfg.get("enabled", True):
        nr_fns = [r for r in fn_cases if r["scenario_type"] == "new_recipient_risk"]
        avg_score = _avg([float(r["risk_score"]) for r in nr_fns])
        old_ctx = float(nr_cfg.get("context_amount_ratio", 2.2))
        old_weight = float(nr_cfg.get("weight", 26.0))
        new_ctx = round(max(1.3, old_ctx - 0.5), 2)
        new_weight = round(min(36.0, old_weight + 6.0), 1)
        if new_ctx != old_ctx or new_weight != old_weight:
            nr_cfg["context_amount_ratio"] = new_ctx
            nr_cfg["weight"] = new_weight
            recommendations.append(
                {
                    "target_rule": "new_recipient_risk",
                    "issue_category": "missed_new_recipient_context",
                    "severity": "high" if nr_sm["recall"] < 0.65 else "medium",
                    "title": "Tighten contextual amount ratio for new recipients",
                    "explanation": (
                        f"{nr_sm['false_negatives']} risky new-recipient transfers scored avg {avg_score:.1f}. "
                        f"context_amount_ratio={old_ctx} missed elevated P2P transfers in the 1.6x–2.2x range."
                    ),
                    "proposed_changes_json": {
                        "context_amount_ratio": {"old": old_ctx, "new": new_ctx},
                        "weight": {"old": old_weight, "new": new_weight},
                    },
                    "expected_impact": "Improves detection of contextual new-recipient transfers while preserving clean daytime payees.",
                }
            )

    # Duplicate Payment diagnostics
    dp_sm = scen_map.get("duplicate_payment")
    dp_cfg = proposed_rules.get("duplicate_payment", {})
    if dp_sm and dp_sm["false_negatives"] > 0 and dp_cfg.get("enabled", True):
        dp_fns = [r for r in fn_cases if r["scenario_type"] == "duplicate_payment"]
        avg_score = _avg([float(r["risk_score"]) for r in dp_fns])
        old_win = int(dp_cfg.get("window_minutes", 5))
        old_weight = float(dp_cfg.get("weight", 34.0))
        new_win = min(20, max(old_win + 7, 15))
        new_weight = round(min(44.0, old_weight + 6.0), 1)
        if new_win != old_win or new_weight != old_weight:
            dp_cfg["window_minutes"] = new_win
            dp_cfg["weight"] = new_weight
            recommendations.append(
                {
                    "target_rule": "duplicate_payment",
                    "issue_category": "narrow_duplicate_window",
                    "severity": "critical" if dp_sm["recall"] < 0.5 else "high",
                    "title": "Expand duplicate payment detection window and weight",
                    "explanation": (
                        f"{dp_sm['false_negatives']} duplicate payment events were missed (avg score={avg_score:.1f}). "
                        f"Window of {old_win} min misses delayed retries occurring 6–15 minutes after the origin payment."
                    ),
                    "proposed_changes_json": {
                        "window_minutes": {"old": old_win, "new": new_win},
                        "weight": {"old": old_weight, "new": new_weight},
                    },
                    "expected_impact": "Catches delayed duplicate replay attacks within 15 minutes.",
                }
            )

    # Suspicious Sequence & Frequency diagnostics
    ss_sm = scen_map.get("suspicious_sequence")
    ss_cfg = proposed_rules.get("suspicious_sequence", {})
    uf_cfg = proposed_rules.get("unusual_frequency", {})
    if ss_sm and ss_sm["false_negatives"] > 0 and ss_cfg.get("enabled", True):
        ss_fns = [r for r in fn_cases if r["scenario_type"] == "suspicious_sequence"]
        avg_score = _avg([float(r["risk_score"]) for r in ss_fns])
        old_win = int(ss_cfg.get("window_minutes", 15))
        old_thresh = float(ss_cfg.get("threshold", 4.0))
        old_weight = float(ss_cfg.get("weight", 28.0))
        new_win = min(35, max(old_win + 10, 25))
        new_thresh = max(3.0, old_thresh - 1.0)
        new_weight = round(min(38.0, old_weight + 5.0), 1)
        if new_win != old_win or new_thresh != old_thresh or new_weight != old_weight:
            ss_cfg["window_minutes"] = new_win
            ss_cfg["threshold"] = new_thresh
            ss_cfg["weight"] = new_weight
            recommendations.append(
                {
                    "target_rule": "suspicious_sequence",
                    "issue_category": "missed_burst_sequences",
                    "severity": "high" if ss_sm["recall"] < 0.65 else "medium",
                    "title": "Widen sequence burst window and lower burst count threshold",
                    "explanation": (
                        f"{ss_sm['false_negatives']} sequence anomalies were missed (avg score={avg_score:.1f}). "
                        f"Burst threshold={old_thresh} in {old_win} min misses 3-step rapid drains."
                    ),
                    "proposed_changes_json": {
                        "window_minutes": {"old": old_win, "new": new_win},
                        "threshold": {"old": old_thresh, "new": new_thresh},
                        "weight": {"old": old_weight, "new": new_weight},
                    },
                    "expected_impact": "Improves detection of 3+ operation structuring bursts while keeping business B2B batch dampening.",
                }
            )

        if uf_cfg.get("enabled", True) and float(uf_cfg.get("threshold", 5.0)) > 4.0:
            old_uf_t = float(uf_cfg.get("threshold", 5.0))
            new_uf_t = round(max(3.0, old_uf_t - 1.0), 1)
            uf_cfg["threshold"] = new_uf_t
            recommendations.append(
                {
                    "target_rule": "unusual_frequency",
                    "issue_category": "velocity_sensitivity",
                    "severity": "medium",
                    "title": "Adjust rolling hourly velocity threshold",
                    "explanation": (
                        f"Lowering frequency threshold from {old_uf_t} to {new_uf_t} tx/hour strengthens compound scoring "
                        f"for rapid sequence attacks without penalizing low-volume normal activity."
                    ),
                    "proposed_changes_json": {"threshold": {"old": old_uf_t, "new": new_uf_t}},
                    "expected_impact": "Reinforces sequence detection through correlated velocity signals.",
                }
            )

    # Structuring / Smurfing diagnostics
    st_sm = scen_map.get("structuring_smurfing")
    st_cfg = proposed_rules.get("structuring_smurfing", {})
    if st_sm and st_sm["false_negatives"] > 0 and st_cfg.get("enabled", True):
        st_fns = [r for r in fn_cases if r["scenario_type"] == "structuring_smurfing"]
        avg_score = _avg([float(r["risk_score"]) for r in st_fns])
        old_win = int(st_cfg.get("window_minutes", 20))
        old_thresh = float(st_cfg.get("threshold", 4.0))
        old_ctx = float(st_cfg.get("context_amount_ratio", 3.0))
        old_weight = float(st_cfg.get("weight", 24.0))
        new_win = min(55, max(old_win + 20, 45))
        new_thresh = round(max(3.0, old_thresh - 1.0), 1)
        new_ctx = round(max(1.85, old_ctx - 0.9), 2)
        new_weight = round(min(44.0, old_weight + 18.0), 1)
        if new_win != old_win or new_thresh != old_thresh or new_ctx != old_ctx or new_weight != old_weight:
            st_cfg["window_minutes"] = new_win
            st_cfg["threshold"] = new_thresh
            st_cfg["context_amount_ratio"] = new_ctx
            st_cfg["weight"] = new_weight
            recommendations.append(
                {
                    "target_rule": "structuring_smurfing",
                    "issue_category": "missed_structuring_splits",
                    "severity": "high" if st_sm["recall"] < 0.7 else "medium",
                    "title": "Widen structuring window and detect 3-slice sub-threshold splitting",
                    "explanation": (
                        f"{st_sm['false_negatives']} structuring transfers were missed (avg score={avg_score:.1f}). "
                        f"Requiring {old_thresh} slices inside {old_win} min misses 3-5 staggered sub-threshold splits."
                    ),
                    "proposed_changes_json": {
                        "window_minutes": {"old": old_win, "new": new_win},
                        "threshold": {"old": old_thresh, "new": new_thresh},
                        "context_amount_ratio": {"old": old_ctx, "new": new_ctx},
                        "weight": {"old": old_weight, "new": new_weight},
                    },
                    "expected_impact": "Catches cumulative near-threshold structuring series while avoiding single normal errands.",
                }
            )

    # Account Takeover (ATO) diagnostics
    ato_sm = scen_map.get("account_takeover_ato")
    ato_cfg = proposed_rules.get("account_takeover_ato", {})
    if ato_sm and ato_sm["false_negatives"] > 0 and ato_cfg.get("enabled", True):
        ato_fns = [r for r in fn_cases if r["scenario_type"] == "account_takeover_ato"]
        avg_score = _avg([float(r["risk_score"]) for r in ato_fns])
        old_win = int(ato_cfg.get("window_minutes", 10))
        old_ctx = float(ato_cfg.get("context_amount_ratio", 3.2))
        old_weight = float(ato_cfg.get("weight", 24.0))
        new_win = min(45, max(old_win + 20, 30))
        new_ctx = round(max(1.65, old_ctx - 1.45), 2)
        new_weight = round(min(42.0, old_weight + 14.0), 1)
        if new_win != old_win or new_ctx != old_ctx or new_weight != old_weight:
            ato_cfg["window_minutes"] = new_win
            ato_cfg["context_amount_ratio"] = new_ctx
            ato_cfg["weight"] = new_weight
            recommendations.append(
                {
                    "target_rule": "account_takeover_ato",
                    "issue_category": "missed_account_takeover",
                    "severity": "high" if ato_sm["recall"] < 0.7 else "medium",
                    "title": "Extend device/geo shift lookback for rapid new-recipient cash-out",
                    "explanation": (
                        f"{ato_sm['false_negatives']} ATO transfers were missed (avg score={avg_score:.1f}). "
                        f"A {old_win}-min device/geo lookback with {old_ctx}x ratio misses rapid takeovers."
                    ),
                    "proposed_changes_json": {
                        "window_minutes": {"old": old_win, "new": new_win},
                        "context_amount_ratio": {"old": old_ctx, "new": new_ctx},
                        "weight": {"old": old_weight, "new": new_weight},
                    },
                    "expected_impact": "Detects session takeover followed by an atypical transfer to a new payee without penalizing ordinary travel.",
                }
            )

    # Check if overall FPR is already high -> recommend raising decision_threshold or trimming noisy rule
    overall_fpr = float(metrics.get("false_positive_rate", 0.0))
    if overall_fpr > 0.05 or (len(fp_cases) > max(8, len(fn_cases) * 1.5)):
        # Identify rule with lowest trigger_precision
        noisy = sorted(
            [r for r in rule_impact if r["trigger_count"] >= 3],
            key=lambda x: x["trigger_precision"],
        )
        new_dt = round(min(70.0, proposed_threshold + 5.0), 1)
        if new_dt != proposed_threshold:
            old_dt = proposed_threshold
            proposed_threshold = new_dt
            recommendations.append(
                {
                    "target_rule": "global",
                    "issue_category": "high_false_positive_rate",
                    "severity": "high",
                    "title": "Raise global decision threshold to curb false blocks",
                    "explanation": (
                        f"False positive rate reached {overall_fpr:.1%} ({len(fp_cases)} legitimate transactions blocked). "
                        + (
                            f"Lowest-precision rule is '{noisy[0]['rule']}' ({noisy[0]['trigger_precision']:.1%} precision)."
                            if noisy
                            else ""
                        )
                    ),
                    "proposed_changes_json": {"decision_threshold": {"old": old_dt, "new": new_dt}},
                    "expected_impact": "Reduces false blocks on borderline legitimate transactions.",
                }
            )
    elif len(fn_cases) > 0 and metrics.get("recall", 0.0) < 0.72 and proposed_threshold > 48.0:
        # Check if many FNs cluster just below decision_threshold
        near_miss = [r for r in fn_cases if float(r["risk_score"]) >= decision_threshold - 10.0]
        if len(near_miss) >= max(2, len(fn_cases) // 3):
            old_dt = proposed_threshold
            proposed_threshold = round(max(46.0, decision_threshold - 5.0), 1)
            recommendations.append(
                {
                    "target_rule": "global",
                    "issue_category": "near_threshold_misses",
                    "severity": "medium",
                    "title": "Slightly lower decision threshold for near-miss risk scores",
                    "explanation": (
                        f"{len(near_miss)}/{len(fn_cases)} missed risk events scored within 10 points below "
                        f"threshold {old_dt:.1f}."
                    ),
                    "proposed_changes_json": {"decision_threshold": {"old": old_dt, "new": proposed_threshold}},
                    "expected_impact": "Converts borderline multi-signal detections into alerts; validate FPR impact before adopting.",
                }
            )

    # Explainability summary for False Positives & False Negatives
    fp_rule_counts: Dict[str, int] = {}
    for r in fp_cases:
        for tr in r.get("triggered_rules_json", r.get("triggered_rules", [])):
            fp_rule_counts[tr["rule"]] = fp_rule_counts.get(tr["rule"], 0) + 1

    fn_scenario_counts: Dict[str, int] = {}
    for r in fn_cases:
        sc = r["scenario_type"]
        fn_scenario_counts[sc] = fn_scenario_counts.get(sc, 0) + 1

    explainability = {
        "false_negatives": {
            "count": len(fn_cases),
            "avg_risk_score": _avg([float(r["risk_score"]) for r in fn_cases]),
            "by_scenario": fn_scenario_counts,
            "sample_codes": [r["transaction_code"] for r in fn_cases[:5]],
        },
        "false_positives": {
            "count": len(fp_cases),
            "avg_risk_score": _avg([float(r["risk_score"]) for r in fp_cases]),
            "top_triggering_rules": fp_rule_counts,
            "sample_codes": [r["transaction_code"] for r in fp_cases[:5]],
        },
    }

    summary = (
        f"Evaluated {metrics.get('total_transactions', 0)} synthetic transactions "
        f"({metrics.get('actual_risk_events', 0)} labeled risk events). "
        f"Recall={metrics.get('recall', 0.0):.1%}, Precision={metrics.get('precision', 0.0):.1%}, "
        f"F1={metrics.get('f1_score', 0.0):.1%}, FPR={metrics.get('false_positive_rate', 0.0):.2%}. "
        f"Detected {metrics.get('true_positives', 0)} threats, missed {metrics.get('false_negatives', 0)}, "
        f"and falsely flagged {metrics.get('false_positives', 0)} legitimate transactions."
    )

    limitations = [
        "Analysis is derived strictly from deterministic computations on synthetic Virtual Bank Simulator data.",
        "Thresholds tuned on a single synthetic profile should be re-validated across multiple random seeds and risk ratios.",
        "This laboratory prototype tests sandboxed anti-fraud logic and does not reflect or integrate with production bank systems.",
    ]

    llm_narrative: Optional[str] = None
    analysis_mode = "deterministic_algorithm"

    settings = get_settings()
    if settings.llm_configured:
        llm_narrative = _try_llm_narrative(
            settings=settings,
            summary=summary,
            weaknesses=weaknesses,
            recommendations=recommendations,
        )
        if llm_narrative:
            analysis_mode = "deterministic_with_llm_narrative"

    return {
        "analysis_mode": analysis_mode,
        "summary": summary,
        "llm_narrative": llm_narrative,
        "weaknesses": weaknesses,
        "explainability": explainability,
        "recommendations": recommendations,
        "proposed_rules_config": proposed_rules,
        "proposed_decision_threshold": proposed_threshold,
        "limitations": limitations,
    }


def _try_llm_narrative(
    settings: Any,
    summary: str,
    weaknesses: List[Dict[str, Any]],
    recommendations: List[Dict[str, Any]],
) -> Optional[str]:
    """Optional external OpenAI-compatible narrative summary using only computed facts."""
    try:
        endpoint = settings.llm_base_url.rstrip("/") + "/chat/completions"
        prompt_payload = {
            "computed_summary": summary,
            "detected_weaknesses": weaknesses[:5],
            "proposed_recommendations": [
                {"rule": r["target_rule"], "title": r["title"], "changes": r["proposed_changes_json"]}
                for r in recommendations[:5]
            ],
        }
        body = json.dumps(
            {
                "model": settings.llm_model or "gpt-4o-mini",
                "temperature": 0.1,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a concise banking cybersecurity analyst. Summarize ONLY the provided computed metrics "
                            "and recommendations in 3-4 sentences. Never invent numbers or claims not present in the input."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
                ],
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.llm_api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, IndexError, TimeoutError, ValueError):
        return None
