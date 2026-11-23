"""Evaluation Engine: computes classification metrics, confusion matrices, and per-scenario diagnostics."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Sequence


def _safe_div(num: float, den: float) -> float:
    return round(num / den, 4) if den > 0 else 0.0


def compute_binary_metrics(records: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute confusion matrix and binary metrics with zero-division safety."""
    total = len(records)
    tp = sum(1 for r in records if r["predicted_label"] == 1 and r["ground_truth_label"] == 1)
    fp = sum(1 for r in records if r["predicted_label"] == 1 and r["ground_truth_label"] == 0)
    tn = sum(1 for r in records if r["predicted_label"] == 0 and r["ground_truth_label"] == 0)
    fn = sum(1 for r in records if r["predicted_label"] == 0 and r["ground_truth_label"] == 1)

    actual_risk = tp + fn
    actual_legit = tn + fp
    predicted_risk = tp + fp

    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    f1 = _safe_div(2 * precision * recall, precision + recall)
    fpr = _safe_div(fp, actual_legit)
    fnr = _safe_div(fn, actual_risk)
    accuracy = _safe_div(tp + tn, total)
    scored_records = [r for r in records if r.get("score_provided", True)]
    avg_risk_score = (
        round(sum(float(r["risk_score"]) for r in scored_records) / len(scored_records), 2)
        if scored_records
        else 0.0
    )

    prevented_fraud_amount = round(
        sum(
            float(r.get("amount_kzt", 0.0) or 0.0)
            for r in records
            if r["predicted_label"] == 1 and r["ground_truth_label"] == 1
        ),
        2,
    )
    missed_fraud_amount = round(
        sum(
            float(r.get("amount_kzt", 0.0) or 0.0)
            for r in records
            if r["predicted_label"] == 0 and r["ground_truth_label"] == 1
        ),
        2,
    )
    false_decline_amount = round(
        sum(
            float(r.get("amount_kzt", 0.0) or 0.0)
            for r in records
            if r["predicted_label"] == 1 and r["ground_truth_label"] == 0
        ),
        2,
    )
    review_queue_count = sum(
        1
        for r in records
        if r.get("routing_action") == "review"
        or ("routing_action" not in r and r["predicted_label"] == 0 and r.get("risk_level") == "medium")
    )
    review_queue_rate = _safe_div(review_queue_count, total)

    risk_dist = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    for r in records:
        lvl = r.get("risk_level", "low")
        if lvl in risk_dist:
            risk_dist[lvl] += 1

    return {
        "metrics": {
            "total_transactions": total,
            "actual_risk_events": actual_risk,
            "predicted_risk_events": predicted_risk,
            "true_positives": tp,
            "false_positives": fp,
            "true_negatives": tn,
            "false_negatives": fn,
            "precision": precision,
            "recall": recall,
            "f1_score": f1,
            "false_positive_rate": fpr,
            "false_negative_rate": fnr,
            "accuracy": accuracy,
            "avg_risk_score": avg_risk_score,
            "prevented_fraud_amount": prevented_fraud_amount,
            "missed_fraud_amount": missed_fraud_amount,
            "false_decline_amount": false_decline_amount,
            "review_queue_count": review_queue_count,
            "review_queue_rate": review_queue_rate,
            "risk_level_distribution": risk_dist,
        },
        "confusion_matrix": {
            "tp": tp,
            "fp": fp,
            "tn": tn,
            "fn": fn,
        },
    }


def evaluate_predictions(
    predictions: Sequence[Dict[str, Any]],
    ground_truth_by_tx_id: Dict[int, Dict[str, Any]],
    processing_time_ms: float = 0.0,
) -> Dict[str, Any]:
    """
    Join Defense Engine predictions with ground truth labels and scenario tags
    to produce overall, per-scenario, and per-rule metrics.
    """
    joined: List[Dict[str, Any]] = []
    by_scenario: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    rule_stats: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"rule": "", "trigger_count": 0, "tp_triggers": 0, "fp_triggers": 0, "total_contribution": 0.0}
    )

    for pred in predictions:
        gt = ground_truth_by_tx_id[pred["transaction_id"]]
        merged = {
            **pred,
            "ground_truth_label": int(gt["ground_truth_label"]),
            "scenario_type": str(gt["scenario_type"]),
        }
        joined.append(merged)
        by_scenario[merged["scenario_type"]].append(merged)

        for tr in pred.get("triggered_rules", []):
            r_name = tr["rule"]
            rs = rule_stats[r_name]
            rs["rule"] = r_name
            rs["trigger_count"] += 1
            rs["total_contribution"] += float(tr.get("contribution", 0.0))
            if merged["ground_truth_label"] == 1:
                rs["tp_triggers"] += 1
            else:
                rs["fp_triggers"] += 1

    overall = compute_binary_metrics(joined)
    overall["metrics"]["processing_time_ms"] = round(processing_time_ms, 2)

    scenario_metrics: List[Dict[str, Any]] = []
    for scenario_type in sorted(by_scenario.keys()):
        items = by_scenario[scenario_type]
        m = compute_binary_metrics(items)["metrics"]
        scenario_metrics.append(
            {
                "scenario_type": scenario_type,
                "total_transactions": m["total_transactions"],
                "actual_risk_events": m["actual_risk_events"],
                "true_positives": m["true_positives"],
                "false_positives": m["false_positives"],
                "true_negatives": m["true_negatives"],
                "false_negatives": m["false_negatives"],
                "precision": m["precision"],
                "recall": m["recall"],
                "f1_score": m["f1_score"],
                "false_positive_rate": m["false_positive_rate"],
                "false_negative_rate": m["false_negative_rate"],
                "avg_risk_score": m["avg_risk_score"],
            }
        )

    rule_impact: List[Dict[str, Any]] = []
    for r_name in sorted(rule_stats.keys()):
        rs = rule_stats[r_name]
        tc = rs["trigger_count"]
        rule_impact.append(
            {
                "rule": r_name,
                "trigger_count": tc,
                "tp_triggers": rs["tp_triggers"],
                "fp_triggers": rs["fp_triggers"],
                "trigger_precision": _safe_div(rs["tp_triggers"], tc),
                "avg_contribution": round(rs["total_contribution"] / tc, 2) if tc > 0 else 0.0,
            }
        )

    return {
        "joined_results": joined,
        "metrics": overall["metrics"],
        "confusion_matrix": overall["confusion_matrix"],
        "scenario_metrics": scenario_metrics,
        "rule_impact": rule_impact,
    }
