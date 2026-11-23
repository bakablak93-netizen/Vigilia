"""Multi-Scenario Benchmark Engine: evaluates defense configurations across independent seeds with Macro & Micro aggregation."""

from __future__ import annotations

from collections import defaultdict
import math
import time
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
from sqlalchemy.orm import Session

from ..models import BenchmarkRun, Dataset, DefenseConfiguration, SyntheticTransaction, VirtualCustomer
from .defense_engine import DefenseEngine
from .evaluation_engine import compute_binary_metrics, evaluate_predictions
from .simulator import SCENARIO_CATALOG, generate_synthetic_dataset

# Two-tailed 95% Student-t critical values by degrees of freedom (df = n - 1)
T_CRIT_95: Dict[int, float] = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
}


def _t_crit(n: int) -> float:
    if n <= 1:
        return 0.0
    df = n - 1
    return T_CRIT_95.get(df, 1.96)


def _summarize_series(values: Sequence[float], clamp_01: bool = True) -> Dict[str, Any]:
    if not values:
        return {
            "mean": 0.0,
            "median": 0.0,
            "min": 0.0,
            "max": 0.0,
            "std": 0.0,
            "ci95_low": 0.0,
            "ci95_high": 0.0,
        }
    arr = np.array(values, dtype=float)
    n = len(arr)
    mean = float(np.mean(arr))
    median = float(np.median(arr))
    min_v = float(np.min(arr))
    max_v = float(np.max(arr))
    std = float(np.std(arr, ddof=1)) if n > 1 else 0.0
    margin = _t_crit(n) * (std / math.sqrt(n)) if n > 1 else 0.0
    ci_low = mean - margin
    ci_high = mean + margin
    if clamp_01:
        ci_low = max(0.0, ci_low)
        ci_high = min(1.0, ci_high)
    return {
        "mean": round(mean, 4),
        "median": round(median, 4),
        "min": round(min_v, 4),
        "max": round(max_v, 4),
        "std": round(std, 4),
        "ci95_low": round(ci_low, 4),
        "ci95_high": round(ci_high, 4),
    }


def _aggregate_seed_metrics(seed_metrics_list: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compute both:
    - Macro-average across seeds (mean, median, min, max, sample std, 95% Student-t CI)
    - Micro-average from pooled confusion matrix (sum of TP, FP, TN, FN across all seeds)
    """
    metric_keys = [
        "precision",
        "recall",
        "f1_score",
        "false_positive_rate",
        "false_negative_rate",
        "accuracy",
    ]
    macro: Dict[str, Any] = {}
    for k in metric_keys:
        vals = [float(m.get(k, 0.0)) for m in seed_metrics_list]
        macro[k] = _summarize_series(vals, clamp_01=True)

    macro["processing_time_ms"] = _summarize_series(
        [float(m.get("processing_time_ms", 0.0)) for m in seed_metrics_list],
        clamp_01=False,
    )

    # Micro-average from pooled confusion matrix
    pooled_tp = sum(int(m.get("true_positives", 0)) for m in seed_metrics_list)
    pooled_fp = sum(int(m.get("false_positives", 0)) for m in seed_metrics_list)
    pooled_tn = sum(int(m.get("true_negatives", 0)) for m in seed_metrics_list)
    pooled_fn = sum(int(m.get("false_negatives", 0)) for m in seed_metrics_list)
    pooled_total = pooled_tp + pooled_fp + pooled_tn + pooled_fn

    def sdiv(a: float, b: float) -> float:
        return round(a / b, 4) if b > 0 else 0.0

    micro_prec = sdiv(pooled_tp, pooled_tp + pooled_fp)
    micro_rec = sdiv(pooled_tp, pooled_tp + pooled_fn)
    micro_f1 = sdiv(2 * micro_prec * micro_rec, micro_prec + micro_rec)
    micro_fpr = sdiv(pooled_fp, pooled_tn + pooled_fp)
    micro_fnr = sdiv(pooled_fn, pooled_tp + pooled_fn)
    micro_acc = sdiv(pooled_tp + pooled_tn, pooled_total)

    micro = {
        "total_transactions": pooled_total,
        "actual_risk_events": pooled_tp + pooled_fn,
        "true_positives": pooled_tp,
        "false_positives": pooled_fp,
        "true_negatives": pooled_tn,
        "false_negatives": pooled_fn,
        "precision": micro_prec,
        "recall": micro_rec,
        "f1_score": micro_f1,
        "false_positive_rate": micro_fpr,
        "false_negative_rate": micro_fnr,
        "accuracy": micro_acc,
    }

    return {"macro": macro, "micro": micro}


def _evaluate_config_on_memory_dataset(
    customers: Sequence[Any],
    transactions: Sequence[Any],
    config: DefenseConfiguration,
    split_name: str,
) -> Dict[str, Any]:
    """
    Evaluate a DefenseConfiguration on in-memory synthetic transactions for a specific split
    while strictly stripping ground_truth_label and scenario_type.
    """
    filtered_txs = [
        t for t in transactions if split_name == "all" or t.split_name == split_name
    ]
    customers_by_code = {
        c.customer_code: {
            "customer_type": c.customer_type,
            "activity_category": c.activity_category,
            "customer_segment": c.customer_segment,
            "account_age_days": c.account_age_days,
            "typical_amount_min_kzt": c.typical_amount_min_kzt,
            "typical_amount_max_kzt": c.typical_amount_max_kzt,
            "avg_amount_kzt": c.avg_amount_kzt,
            "std_amount_kzt": c.std_amount_kzt,
            "avg_tx_frequency_per_day": c.avg_tx_frequency_per_day,
        }
        for c in customers
    }

    sanitized_txs: List[Dict[str, Any]] = []
    ground_truth_by_tx_id: Dict[int, Dict[str, Any]] = {}

    for idx, tx in enumerate(filtered_txs, start=1):
        meta = getattr(tx, "metadata_json", None) or {}
        sanitized_txs.append(
            {
                "id": idx,
                "transaction_code": tx.transaction_code,
                "customer_code": tx.customer_code,
                "recipient_code": tx.recipient_code,
                "amount_kzt": tx.amount_kzt,
                "timestamp": tx.timestamp,
                "transaction_type": tx.transaction_type,
                "channel": tx.channel,
                "is_new_recipient": tx.is_new_recipient,
                "customer_segment": tx.customer_segment,
                "transaction_frequency": tx.transaction_frequency,
                "split_name": tx.split_name,
                "device_changed": bool(meta.get("device_changed", False)),
                "geo_changed": bool(meta.get("geo_changed", False)),
                "minutes_since_device_change": meta.get("minutes_since_device_change"),
            }
        )
        ground_truth_by_tx_id[idx] = {
            "ground_truth_label": tx.ground_truth_label,
            "scenario_type": tx.scenario_type,
        }

    engine = DefenseEngine(
        rules_config=config.rules_config_json,
        decision_threshold=config.decision_threshold,
        risk_levels=config.risk_levels_json,
    )

    t0 = time.perf_counter()
    preds = engine.evaluate_transactions(sanitized_txs, customers_by_code)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return evaluate_predictions(
        predictions=preds,
        ground_truth_by_tx_id=ground_truth_by_tx_id,
        processing_time_ms=elapsed_ms,
    )


def run_multi_seed_benchmark(
    db: Session,
    name: str,
    baseline_config: DefenseConfiguration,
    candidate_config: Optional[DefenseConfiguration] = None,
    transaction_count: int = 1000,
    customer_count: int = 100,
    risk_ratio: float = 0.05,
    seeds: Optional[Sequence[int]] = None,
    scenarios: Optional[Sequence[str]] = None,
    split_name: str = "evaluation",
) -> BenchmarkRun:
    """
    Execute a multi-seed benchmark across independent synthetic datasets.
    Both Baseline and Candidate are evaluated on the exact same transactions per seed.
    """
    active_seeds = list(seeds) if seeds else [42, 101, 202, 303, 404]
    active_scenarios = list(scenarios) if scenarios else [s["key"] for s in SCENARIO_CATALOG]

    bm_run = BenchmarkRun(
        name=name,
        transaction_count=transaction_count,
        customer_count=customer_count,
        risk_ratio=risk_ratio,
        seeds_json=active_seeds,
        scenarios_json=active_scenarios,
        split_name=split_name,
        baseline_config_id=baseline_config.id,
        candidate_config_id=candidate_config.id if candidate_config else None,
        status="running",
        completed_runs=0,
        total_runs=len(active_seeds),
    )
    db.add(bm_run)
    db.commit()
    db.refresh(bm_run)

    per_seed_results: List[Dict[str, Any]] = []
    baseline_seed_metrics: List[Dict[str, Any]] = []
    candidate_seed_metrics: List[Dict[str, Any]] = []

    base_scen_by_seed: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    cand_scen_by_seed: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    successful_runs = 0
    failed_runs = 0

    for seed_val in active_seeds:
        try:
            customers, transactions = generate_synthetic_dataset(
                transaction_count=transaction_count,
                customer_count=customer_count,
                risk_ratio=risk_ratio,
                scenarios=active_scenarios,
                seed=int(seed_val),
            )
            base_eval = _evaluate_config_on_memory_dataset(
                customers=customers,
                transactions=transactions,
                config=baseline_config,
                split_name=split_name,
            )
            base_m = base_eval["metrics"]
            baseline_seed_metrics.append(base_m)
            for sm in base_eval["scenario_metrics"]:
                base_scen_by_seed[sm["scenario_type"]].append(sm)

            cand_m = None
            cand_scen = None
            delta_m = None
            if candidate_config is not None:
                cand_eval = _evaluate_config_on_memory_dataset(
                    customers=customers,
                    transactions=transactions,
                    config=candidate_config,
                    split_name=split_name,
                )
                cand_m = cand_eval["metrics"]
                cand_scen = cand_eval["scenario_metrics"]
                candidate_seed_metrics.append(cand_m)
                for sm in cand_scen:
                    cand_scen_by_seed[sm["scenario_type"]].append(sm)

                delta_m = {
                    k: round(float(cand_m.get(k, 0.0)) - float(base_m.get(k, 0.0)), 4)
                    for k in (
                        "recall",
                        "precision",
                        "f1_score",
                        "false_positive_rate",
                        "false_negative_rate",
                        "accuracy",
                        "true_positives",
                        "false_positives",
                        "false_negatives",
                    )
                }

            per_seed_results.append(
                {
                    "seed": int(seed_val),
                    "status": "completed",
                    "split_name": split_name,
                    "baseline": base_m,
                    "baseline_scenarios": base_eval["scenario_metrics"],
                    "candidate": cand_m,
                    "candidate_scenarios": cand_scen,
                    "delta": delta_m,
                }
            )
            successful_runs += 1
        except Exception as exc:  # pragma: no cover
            failed_runs += 1
            per_seed_results.append(
                {
                    "seed": int(seed_val),
                    "status": "failed",
                    "error": str(exc),
                }
            )
        bm_run.completed_runs = successful_runs + failed_runs
        db.commit()

    base_agg = _aggregate_seed_metrics(baseline_seed_metrics)
    cand_agg = _aggregate_seed_metrics(candidate_seed_metrics) if candidate_config else None

    # Scenario stability analysis across seeds
    scenario_stability: List[Dict[str, Any]] = []
    for scen_key in sorted(base_scen_by_seed.keys()):
        b_list = base_scen_by_seed[scen_key]
        b_rec_stats = _summarize_series([float(x["recall"]) for x in b_list])
        b_prec_stats = _summarize_series([float(x["precision"]) for x in b_list])
        b_f1_stats = _summarize_series([float(x["f1_score"]) for x in b_list])
        b_fpr_stats = _summarize_series([float(x["false_positive_rate"]) for x in b_list])

        std_rec = b_rec_stats["std"]
        if std_rec <= 0.10:
            stability = "stable"
        elif std_rec <= 0.22:
            stability = "moderate_variance"
        else:
            stability = "unstable"

        mean_rec = b_rec_stats["mean"]
        tier = "strong" if mean_rec >= 0.70 else ("moderate" if mean_rec >= 0.40 else "weak")

        entry: Dict[str, Any] = {
            "scenario_type": scen_key,
            "baseline_recall": b_rec_stats,
            "baseline_precision": b_prec_stats,
            "baseline_f1": b_f1_stats,
            "baseline_fpr": b_fpr_stats,
            "stability_status": stability,
            "performance_tier": tier,
        }

        if candidate_config and scen_key in cand_scen_by_seed:
            c_list = cand_scen_by_seed[scen_key]
            c_rec_stats = _summarize_series([float(x["recall"]) for x in c_list])
            c_f1_stats = _summarize_series([float(x["f1_score"]) for x in c_list])
            c_fpr_stats = _summarize_series([float(x["false_positive_rate"]) for x in c_list])
            c_std = c_rec_stats["std"]
            entry["candidate_recall"] = c_rec_stats
            entry["candidate_f1"] = c_f1_stats
            entry["candidate_fpr"] = c_fpr_stats
            entry["candidate_stability_status"] = (
                "stable" if c_std <= 0.10 else ("moderate_variance" if c_std <= 0.22 else "unstable")
            )
            entry["recall_delta_mean"] = round(c_rec_stats["mean"] - b_rec_stats["mean"], 4)
            entry["f1_delta_mean"] = round(c_f1_stats["mean"] - b_f1_stats["mean"], 4)
            entry["fpr_delta_mean"] = round(c_fpr_stats["mean"] - b_fpr_stats["mean"], 4)

        scenario_stability.append(entry)

    # Comparison summary across seeds
    comparison_summary: Dict[str, Any] = {
        "baseline_version": baseline_config.version,
        "candidate_version": candidate_config.version if candidate_config else None,
    }
    if cand_agg is not None:
        b_mac = base_agg["macro"]
        c_mac = cand_agg["macro"]
        b_mic = base_agg["micro"]
        c_mic = cand_agg["micro"]

        f1_wins = sum(
            1
            for r in per_seed_results
            if r.get("delta") and r["delta"]["f1_score"] > 0.005
        )
        f1_losses = sum(
            1
            for r in per_seed_results
            if r.get("delta") and r["delta"]["f1_score"] < -0.005
        )
        f1_ties = successful_runs - f1_wins - f1_losses

        macro_deltas = {
            k: round(c_mac[k]["mean"] - b_mac[k]["mean"], 4)
            for k in ("recall", "precision", "f1_score", "false_positive_rate", "false_negative_rate", "accuracy")
        }
        micro_deltas = {
            k: round(float(c_mic[k]) - float(b_mic[k]), 4)
            for k in (
                "recall",
                "precision",
                "f1_score",
                "false_positive_rate",
                "false_negative_rate",
                "accuracy",
                "true_positives",
                "false_positives",
                "false_negatives",
            )
        }

        if macro_deltas["f1_score"] >= 0.015 and macro_deltas["false_positive_rate"] <= 0.025 and f1_wins > f1_losses:
            verdict = "improved"
        elif macro_deltas["f1_score"] < -0.01 or macro_deltas["false_positive_rate"] > 0.03:
            verdict = "rejected_regression"
        elif abs(macro_deltas["f1_score"]) < 0.01 and abs(macro_deltas["recall"]) < 0.015:
            verdict = "no_significant_improvement"
        else:
            verdict = "mixed"

        comparison_summary.update(
            {
                "macro_deltas": macro_deltas,
                "micro_deltas": micro_deltas,
                "seed_f1_wins": f1_wins,
                "seed_f1_ties": f1_ties,
                "seed_f1_losses": f1_losses,
                "verdict": verdict,
            }
        )

    small_sample_warning = (
        f"Executed {successful_runs} independent seed runs (split='{split_name}'). "
        + (
            "Caution: N < 10 runs provides multi-sample directional stability but has wide 95% Student-t confidence intervals and should not be treated as a large-sample statistical proof."
            if successful_runs < 10
            else "Multi-seed sample size N >= 10."
        )
    )

    bm_run.per_seed_results_json = per_seed_results
    bm_run.aggregated_metrics_json = {
        "successful_runs": successful_runs,
        "failed_runs": failed_runs,
        "aggregation_note": (
            "Macro-average computes unweighted mean/median/std/CI across seed runs. "
            "Micro-average pools TP, FP, TN, FN across all seeds into a single aggregate confusion matrix."
        ),
        "small_sample_warning": small_sample_warning,
        "baseline": base_agg,
        "candidate": cand_agg,
    }
    bm_run.scenario_stability_json = scenario_stability
    bm_run.comparison_summary_json = comparison_summary
    bm_run.status = "completed" if successful_runs > 0 else "failed"

    db.commit()
    db.refresh(bm_run)
    return bm_run
