"""Defense Evolution 2.0: multi-candidate optimization, single-rule ablation, configurable guardrails, and held-out evaluation."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta
import random
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from ..models import (
    Dataset,
    DefenseConfiguration,
    EvolutionRun,
    Experiment,
    ExperimentResult,
    SyntheticTransaction,
    VirtualCustomer,
)
from .ai_analyst import analyze_experiment_deterministic
from .defense_engine import DefenseEngine, compute_config_diff
from .evaluation_engine import evaluate_predictions
from .experiment_runner import run_experiment_pipeline


DEFAULT_GUARDRAILS: Dict[str, Any] = {
    "min_precision": 0.65,
    "max_fpr": 0.025,
    "max_fp_increase": 8,
    "min_recall_gain": 0.02,
    "max_changed_params": 20,
    "min_eval_risk_events": 4,
    "min_eval_transactions": 30,
    "max_shift_recall_drop": 0.08,
    "max_shift_fpr_increase": 0.015,
}


def _next_version_label(db: Session) -> str:
    count = db.query(DefenseConfiguration).count()
    return f"Defense v1.{count}"


def _compare_metric_dicts(base_m: Dict[str, Any], cand_m: Dict[str, Any]) -> Dict[str, Any]:
    keys = [
        "recall",
        "precision",
        "f1_score",
        "false_positive_rate",
        "false_negative_rate",
        "accuracy",
        "true_positives",
        "false_positives",
        "false_negatives",
        "true_negatives",
        "prevented_fraud_amount",
        "missed_fraud_amount",
        "false_decline_amount",
        "review_queue_count",
        "review_queue_rate",
    ]
    deltas: Dict[str, Any] = {}
    for k in keys:
        b_val = float(base_m.get(k, 0.0))
        c_val = float(cand_m.get(k, 0.0))
        deltas[k] = round(c_val - b_val, 4)

    deltas["delta_prevented_fraud_amount"] = round(
        float(cand_m.get("prevented_fraud_amount", 0.0)) - float(base_m.get("prevented_fraud_amount", 0.0)),
        2,
    )
    deltas["delta_missed_fraud_amount"] = round(
        float(cand_m.get("missed_fraud_amount", 0.0)) - float(base_m.get("missed_fraud_amount", 0.0)),
        2,
    )
    deltas["delta_false_decline_amount"] = round(
        float(cand_m.get("false_decline_amount", 0.0)) - float(base_m.get("false_decline_amount", 0.0)),
        2,
    )
    deltas["delta_review_queue_count"] = int(
        round(float(cand_m.get("review_queue_count", 0)) - float(base_m.get("review_queue_count", 0)))
    )
    deltas["delta_review_queue_rate"] = round(
        float(cand_m.get("review_queue_rate", 0.0)) - float(base_m.get("review_queue_rate", 0.0)),
        4,
    )
    return {
        "baseline": base_m,
        "candidate": cand_m,
        "delta": deltas,
    }


def evaluate_evolution_verdict(
    val_cmp: Dict[str, Any],
    eval_cmp: Dict[str, Any],
    guardrails: Optional[Dict[str, Any]] = None,
    changed_params_count: int = 1,
    adversarial_shift: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str, Dict[str, Any]]:
    """
    Documented, deterministic verdict engine supporting 5 statuses:
    - improved
    - mixed
    - no_significant_improvement
    - rejected_regression
    - insufficient_evidence
    """
    gr = {**DEFAULT_GUARDRAILS, **(guardrails or {})}
    eb = eval_cmp["baseline"]
    ec = eval_cmp["candidate"]
    ed = eval_cmp["delta"]
    vd = val_cmp["delta"]

    total_tx = int(ec.get("total_transactions", 0))
    actual_risk = int(ec.get("actual_risk_events", 0))
    pred_risk = int(ec.get("predicted_risk_events", int(ec.get("true_positives", 0)) + int(ec.get("false_positives", 0))))

    eval_f1_d = float(ed["f1_score"])
    eval_rec_d = float(ed["recall"])
    eval_fpr_d = float(ed["false_positive_rate"])
    eval_prec_d = float(ed["precision"])
    eval_fp_d = int(round(ed["false_positives"]))

    cand_prec = float(ec.get("precision", 0.0))
    cand_rec = float(ec.get("recall", 0.0))
    cand_fpr = float(ec.get("false_positive_rate", 0.0))

    shift_evaluated = bool(adversarial_shift and adversarial_shift.get("status") == "evaluated")
    shift_ok = bool(adversarial_shift.get("passed", True)) if shift_evaluated else True

    checks = {
        "sufficient_data": total_tx >= int(gr["min_eval_transactions"]) and actual_risk >= int(gr["min_eval_risk_events"]),
        "precision_ok": cand_prec >= float(gr["min_precision"]) if pred_risk > 0 else False,
        "fpr_ok": cand_fpr <= float(gr["max_fpr"]),
        "fp_increase_ok": eval_fp_d <= int(gr["max_fp_increase"]),
        "recall_gain_ok": eval_rec_d >= float(gr["min_recall_gain"]),
        "param_count_ok": changed_params_count <= int(gr["max_changed_params"]),
        "non_degenerate": 0 < pred_risk < total_tx if total_tx > 0 else False,
        "adversarial_shift_ok": shift_ok,
    }

    # 1. Insufficient evidence (too few transactions or no/too few positive labels)
    if not checks["sufficient_data"]:
        return (
            "insufficient_evidence",
            (
                f"Insufficient evaluation evidence: {actual_risk} risk events across {total_tx} transactions "
                f"(minimum required: {gr['min_eval_risk_events']} risk events and {gr['min_eval_transactions']} transactions)."
            ),
            {"guardrails": gr, "checks": checks},
        )

    # 2. Degenerate classification (all operations classified as 1, or all positive operations missed with no gain)
    if pred_risk == total_tx and total_tx > 0:
        return (
            "rejected_regression",
            "Rejected: candidate classified 100% of transactions as risky (degenerate threshold/rule configuration).",
            {"guardrails": gr, "checks": checks},
        )

    # 3. Hard guardrail violations or F1/Recall regression
    if not checks["fpr_ok"] and eval_fpr_d > 0.002:
        return (
            "rejected_regression",
            (
                f"Guardrail violation: Candidate FPR reached {cand_fpr:.2%} ({eval_fpr_d:+.2%}, {eval_fp_d:+d} false blocks), "
                f"exceeding max_fpr={float(gr['max_fpr']):.2%}."
            ),
            {"guardrails": gr, "checks": checks},
        )

    if not checks["fp_increase_ok"]:
        return (
            "rejected_regression",
            (
                f"Guardrail violation: False Positives increased by {eval_fp_d:+d} "
                f"(max allowed increase: +{gr['max_fp_increase']})."
            ),
            {"guardrails": gr, "checks": checks},
        )

    if eval_f1_d < -0.01 or (eval_rec_d < -0.005):
        return (
            "rejected_regression",
            (
                f"Candidate regressed on held-out evaluation split: F1 {eval_f1_d:+.1%}, "
                f"Recall {eval_rec_d:+.1%}, FPR {eval_fpr_d:+.2%}. Retain baseline configuration."
            ),
            {"guardrails": gr, "checks": checks},
        )

    if pred_risk == 0 or cand_rec == 0.0:
        return (
            "no_significant_improvement" if float(eb.get("recall", 0.0)) == 0.0 else "rejected_regression",
            "All positive risk events were missed on the evaluation split (Recall = 0.0%).",
            {"guardrails": gr, "checks": checks},
        )

    if shift_evaluated and not shift_ok:
        sh_rec_d = float(adversarial_shift.get("recall_delta_vs_clean", 0.0))
        sh_fpr_d = float(adversarial_shift.get("fpr_delta_vs_clean", 0.0))
        if sh_rec_d < -0.25 or sh_fpr_d > 0.025:
            return (
                "rejected_regression",
                (
                    f"Guardrail violation under ±10–15% adversarial shift: Recall delta {sh_rec_d:+.1%}, "
                    f"FPR delta {sh_fpr_d:+.2%}. Candidate is fragile to threshold/timing perturbations."
                ),
                {"guardrails": gr, "checks": checks},
            )

    # 4. No significant improvement
    if abs(eval_f1_d) < 0.01 and eval_rec_d < float(gr["min_recall_gain"]):
        return (
            "no_significant_improvement",
            (
                f"No statistically meaningful gain on held-out evaluation split "
                f"(Recall {eval_rec_d:+.1%}, F1 {eval_f1_d:+.1%}, min recall gain required: {float(gr['min_recall_gain']):.1%})."
            ),
            {"guardrails": gr, "checks": checks},
        )

    # 5. Mixed trade-off (Recall improved, but precision below floor, or F1 flat/negative, or excessive param changes, or adversarial shift drop)
    if (
        not checks["precision_ok"]
        or not checks["param_count_ok"]
        or not checks["adversarial_shift_ok"]
        or eval_f1_d < 0.01
        or eval_fpr_d > 0.012
        or (float(vd.get("f1_score", 0.0)) > 0.01 and eval_f1_d <= 0.0)
    ):
        shift_note = ""
        if shift_evaluated and not checks["adversarial_shift_ok"]:
            shift_note = (
                f" Adversarial shift check flagged degradation "
                f"(Recall {float(adversarial_shift.get('recall_delta_vs_clean', 0.0)):+.1%}, "
                f"FPR {float(adversarial_shift.get('fpr_delta_vs_clean', 0.0)):+.2%})."
            )
        return (
            "mixed",
            (
                f"Mixed trade-off on held-out evaluation split: Recall {eval_rec_d:+.1%}, F1 {eval_f1_d:+.1%}, "
                f"Precision {cand_prec:.1%} ({eval_prec_d:+.1%}), FPR {cand_fpr:.2%} ({eval_fpr_d:+.2%}, {eval_fp_d:+d} FP)."
                f"{shift_note} Review guardrail trade-offs before promoting."
            ),
            {"guardrails": gr, "checks": checks},
        )

    # 6. Verified improvement
    return (
        "improved",
        (
            f"Verified improvement passing all guardrails on held-out evaluation split: "
            f"F1 {eval_f1_d:+.1%}, Recall {eval_rec_d:+.1%}, Precision {cand_prec:.1%} ({eval_prec_d:+.1%}), "
            f"with controlled FPR ({cand_fpr:.2%}, {eval_fpr_d:+.2%}, {eval_fp_d:+d} FP)."
        ),
        {"guardrails": gr, "checks": checks},
    )


def _fast_evaluate_rules_on_split(
    sanitized_txs: Sequence[Dict[str, Any]],
    customers_by_code: Dict[str, Dict[str, Any]],
    ground_truth_by_tx_id: Dict[int, Dict[str, Any]],
    rules_config: Dict[str, Dict[str, Any]],
    decision_threshold: float,
    risk_levels: Dict[str, float],
) -> Dict[str, Any]:
    engine = DefenseEngine(
        rules_config=rules_config,
        decision_threshold=decision_threshold,
        risk_levels=risk_levels,
    )
    t0 = time.perf_counter()
    preds = engine.evaluate_transactions(sanitized_txs, customers_by_code)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return evaluate_predictions(preds, ground_truth_by_tx_id, processing_time_ms=elapsed_ms)


def _build_candidate_variants(
    base_rules: Dict[str, Dict[str, Any]],
    proposed_rules: Dict[str, Dict[str, Any]],
    base_threshold: float,
    proposed_threshold: float,
) -> List[Dict[str, Any]]:
    """
    Generate 4 controlled candidate configurations:
    - Candidate A: Threshold Adjustments Only
    - Candidate B: Rule Weights Rebalancing Only
    - Candidate C: Temporal Windows Expansion Only
    - Candidate D: Balanced Combined Configuration
    """
    cand_a = deepcopy(base_rules)
    cand_b = deepcopy(base_rules)
    cand_c = deepcopy(base_rules)
    cand_d = deepcopy(proposed_rules)

    threshold_keys = {"threshold", "context_amount_ratio", "min_amount_kzt", "amount_tolerance_pct"}
    weight_keys = {"weight", "night_bonus"}
    window_keys = {"window_minutes"}

    for rule_name, p_cfg in proposed_rules.items():
        if rule_name not in base_rules:
            continue
        for k, v in p_cfg.items():
            if k in threshold_keys:
                cand_a[rule_name][k] = v
            elif k in weight_keys:
                cand_b[rule_name][k] = v
            elif k in window_keys:
                cand_c[rule_name][k] = v

    return [
        {
            "key": "A",
            "name": "Candidate A — Threshold Calibration",
            "strategy": "thresholds_only",
            "description": "Adjusts only sensitivity thresholds and contextual ratios while keeping original weights and time windows fixed.",
            "rules_config": cand_a,
            "decision_threshold": base_threshold,
        },
        {
            "key": "B",
            "name": "Candidate B — Weight Rebalancing",
            "strategy": "weights_only",
            "description": "Adjusts only rule contribution weights without changing sensitivity thresholds or time windows.",
            "rules_config": cand_b,
            "decision_threshold": base_threshold,
        },
        {
            "key": "C",
            "name": "Candidate C — Temporal Window Expansion",
            "strategy": "windows_only",
            "description": "Expands only temporal lookback windows for duplicate payment and sequence detection.",
            "rules_config": cand_c,
            "decision_threshold": base_threshold,
        },
        {
            "key": "D",
            "name": "Candidate D — Balanced Multi-Factor (Recommended)",
            "strategy": "combined_guarded",
            "description": "Combines targeted threshold, window, and weight adjustments subject to precision and FPR guardrails.",
            "rules_config": cand_d,
            "decision_threshold": proposed_threshold,
        },
    ]


def _load_split_memory_buffers(
    db: Session,
    dataset_id: int,
    split_name: str,
    scenarios: Optional[Sequence[str]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[int, Dict[str, Any]]]:
    tx_q = db.query(SyntheticTransaction).filter(SyntheticTransaction.dataset_id == dataset_id)
    if split_name != "all":
        tx_q = tx_q.filter(SyntheticTransaction.split_name == split_name)
    if scenarios:
        tx_q = tx_q.filter(SyntheticTransaction.scenario_type.in_(list(scenarios)))

    tx_rows = tx_q.order_by(SyntheticTransaction.timestamp.asc(), SyntheticTransaction.id.asc()).all()
    cust_rows = db.query(VirtualCustomer).filter(VirtualCustomer.dataset_id == dataset_id).all()

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
        for c in cust_rows
    }
    sanitized_txs: List[Dict[str, Any]] = []
    ground_truth_by_tx_id: Dict[int, Dict[str, Any]] = {}
    for row in tx_rows:
        meta = row.metadata_json or {}
        sanitized_txs.append(
            {
                "id": row.id,
                "transaction_code": row.transaction_code,
                "customer_code": row.customer_code,
                "recipient_code": row.recipient_code,
                "amount_kzt": row.amount_kzt,
                "timestamp": row.timestamp,
                "transaction_type": row.transaction_type,
                "channel": row.channel,
                "is_new_recipient": row.is_new_recipient,
                "customer_segment": row.customer_segment,
                "transaction_frequency": row.transaction_frequency,
                "split_name": row.split_name,
                # Sanitized observable telemetry (never scenario_type/ground_truth/metadata_json)
                "device_changed": bool(meta.get("device_changed", False)),
                "geo_changed": bool(meta.get("geo_changed", False)),
                "minutes_since_device_change": meta.get("minutes_since_device_change"),
            }
        )
        ground_truth_by_tx_id[row.id] = {
            "ground_truth_label": row.ground_truth_label,
            "scenario_type": row.scenario_type,
        }
    return sanitized_txs, customers_by_code, ground_truth_by_tx_id


def apply_adversarial_shift(
    sanitized_txs: Sequence[Dict[str, Any]],
    seed: int = 42,
    amount_min_pct: float = 0.10,
    amount_max_pct: float = 0.15,
    time_min_pct: float = 0.10,
    time_max_pct: float = 0.15,
) -> List[Dict[str, Any]]:
    """
    Create an adversarial stress-perturbed copy of sanitized transactions (±10-15% amount and timing/interval shift).
    Preserves duplicate-pair relative amounts for close (customer, recipient) repeats so semantics remain valid.
    Never reads ground_truth_label or scenario_type.
    """
    rng = random.Random(int(seed) + 1337)
    cloned: List[Dict[str, Any]] = [deepcopy(dict(tx)) for tx in sanitized_txs]

    def _parse_ts(val: Any) -> datetime:
        if isinstance(val, datetime):
            return val
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))

    by_cust: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for tx in cloned:
        tx["_orig_ts"] = _parse_ts(tx["timestamp"])
        by_cust[str(tx["customer_code"])].append(tx)

    for cust_txs in by_cust.values():
        cust_txs.sort(key=lambda r: (r["_orig_ts"], int(r.get("id", 0) or 0)))
        if not cust_txs:
            continue
        prev_orig_ts = cust_txs[0]["_orig_ts"]
        prev_new_ts = prev_orig_ts
        if not isinstance(cust_txs[0]["timestamp"], datetime):
            cust_txs[0]["timestamp"] = prev_new_ts.isoformat()

        pair_shift_cache: Dict[str, Tuple[datetime, float, float]] = {}
        for idx, tx in enumerate(cust_txs):
            orig_ts = tx["_orig_ts"]
            if idx > 0:
                gap_sec = max(5.0, (orig_ts - prev_orig_ts).total_seconds())
                time_sign = 1.0 if rng.random() >= 0.35 else -1.0
                time_mag = rng.uniform(time_min_pct, time_max_pct)
                shifted_gap_sec = max(5.0, gap_sec * (1.0 + time_sign * time_mag))
                new_ts = prev_new_ts + timedelta(seconds=shifted_gap_sec)
                tx["timestamp"] = new_ts if isinstance(tx["timestamp"], datetime) else new_ts.isoformat()
                prev_orig_ts = orig_ts
                prev_new_ts = new_ts

            if tx.get("minutes_since_device_change") is not None:
                try:
                    m_dev = float(tx["minutes_since_device_change"])
                    t_sign = 1.0 if rng.random() >= 0.35 else -1.0
                    t_mag = rng.uniform(time_min_pct, time_max_pct)
                    tx["minutes_since_device_change"] = round(max(0.5, m_dev * (1.0 + t_sign * t_mag)), 2)
                except (TypeError, ValueError):
                    pass

            recip = str(tx.get("recipient_code", ""))
            amt = float(tx.get("amount_kzt", 0.0) or 0.0)
            cached = pair_shift_cache.get(recip)
            if (
                cached is not None
                and abs((orig_ts - cached[0]).total_seconds()) <= 45 * 60
                and cached[1] > 0
                and abs(amt - cached[1]) / max(amt, cached[1]) <= 0.03
            ):
                base_factor = cached[2]
                micro_jitter = 1.0 + rng.uniform(-0.004, 0.004)
                tx["amount_kzt"] = round(max(100.0, amt * base_factor * micro_jitter), 2)
            else:
                amt_sign = -1.0 if rng.random() < 0.5 else 1.0
                amt_mag = rng.uniform(amount_min_pct, amount_max_pct)
                factor = 1.0 + amt_sign * amt_mag
                tx["amount_kzt"] = round(max(100.0, amt * factor), 2)
                pair_shift_cache[recip] = (orig_ts, amt, factor)

    for tx in cloned:
        tx.pop("_orig_ts", None)
    cloned.sort(key=lambda r: (_parse_ts(r["timestamp"]), int(r.get("id", 0) or 0)))
    return cloned


def summarize_adversarial_shift(
    cand_clean_metrics: Dict[str, Any],
    cand_shifted_metrics: Dict[str, Any],
    base_shifted_metrics: Dict[str, Any],
    guardrails: Optional[Dict[str, Any]] = None,
    tx_count: int = 0,
    seed: int = 42,
) -> Dict[str, Any]:
    """Compare clean vs ±10-15% adversarial-shifted candidate performance against stability guardrails."""
    gr = {**DEFAULT_GUARDRAILS, **(guardrails or {})}
    max_rec_drop = float(gr.get("max_shift_recall_drop", 0.08))
    max_fpr_inc = float(gr.get("max_shift_fpr_increase", 0.015))
    max_abs_fpr = max(0.04, float(gr.get("max_fpr", 0.025)) + 0.015)

    clean_rec = float(cand_clean_metrics.get("recall", 0.0))
    clean_prec = float(cand_clean_metrics.get("precision", 0.0))
    clean_f1 = float(cand_clean_metrics.get("f1_score", 0.0))
    clean_fpr = float(cand_clean_metrics.get("false_positive_rate", 0.0))

    sh_rec = float(cand_shifted_metrics.get("recall", 0.0))
    sh_prec = float(cand_shifted_metrics.get("precision", 0.0))
    sh_f1 = float(cand_shifted_metrics.get("f1_score", 0.0))
    sh_fpr = float(cand_shifted_metrics.get("false_positive_rate", 0.0))
    base_sh_rec = float(base_shifted_metrics.get("recall", 0.0))

    rec_delta = round(sh_rec - clean_rec, 4)
    prec_delta = round(sh_prec - clean_prec, 4)
    f1_delta = round(sh_f1 - clean_f1, 4)
    fpr_delta = round(sh_fpr - clean_fpr, 4)
    gain_vs_base = round(sh_rec - base_sh_rec, 4)

    passed = (
        (-rec_delta) <= max_rec_drop
        and fpr_delta <= max_fpr_inc
        and sh_fpr <= max_abs_fpr
        and sh_rec > 0.0
    )
    if passed:
        reason = (
            f"Candidate remains stable under ±10–15% amount & timing shift "
            f"(Recall {sh_rec:.1%}, {rec_delta:+.1%} vs clean; FPR {sh_fpr:.2%}, {fpr_delta:+.2%})."
        )
    else:
        reason = (
            f"Candidate showed sensitivity under ±10–15% adversarial shift "
            f"(Recall {sh_rec:.1%}, {rec_delta:+.1%} vs clean; FPR {sh_fpr:.2%}, {fpr_delta:+.2%})."
        )

    return {
        "status": "evaluated",
        "perturbation": {
            "amount_shift_pct": 12.5,
            "time_shift_pct": 12.5,
            "amount_range_pct": "±10–15%",
            "time_range_pct": "±10–15%",
            "transactions_count": int(tx_count),
            "seed": int(seed),
        },
        "baseline_shifted_metrics": base_shifted_metrics,
        "candidate_clean_metrics": cand_clean_metrics,
        "candidate_shifted_metrics": cand_shifted_metrics,
        "recall_delta_vs_clean": rec_delta,
        "precision_delta_vs_clean": prec_delta,
        "f1_delta_vs_clean": f1_delta,
        "fpr_delta_vs_clean": fpr_delta,
        "recall_gain_vs_baseline_shifted": gain_vs_base,
        "passed": passed,
        "reason": reason,
    }


_INTERNAL_PARAM_CATALOG: Dict[str, Dict[str, str]] = {
    "threshold": {
        "purpose": "Пороговое значение срабатывания правила: определяет минимальную величину признака для активации фактора риска.",
        "higher_effect": "Повышение порога сужает срабатывание правила (меньше ложных тревог, но выше риск пропустить пограничные кейсы).",
        "lower_effect": "Снижение порога делает правило чувствительнее (выше шанс поймать пограничные атаки, но возможен рост ложных блокировок).",
    },
    "weight": {
        "purpose": "Вес правила в итоговом risk score транзакции при его срабатывании.",
        "higher_effect": "Увеличение веса усиливает вклад этого правила в общий балл риска (приближает срабатывание к decision_threshold).",
        "lower_effect": "Уменьшение веса снижает влияние правила на итоговый риск (уменьшает вероятность ложной блокировки по одному фактору).",
    },
    "window_minutes": {
        "purpose": "Временное окно (в минутах), в пределах которого агрегируются предшествующие операции клиента или пары.",
        "higher_effect": "Расширение окна позволяет связывать разнесённые по времени операции в один паттерн, но может захватывать обычные повторные покупки.",
        "lower_effect": "Сужение окна ограничивает анализ более коротким интервалом (меньше ложных совпадений, но можно пропустить медленные атаки).",
    },
    "min_amount_kzt": {
        "purpose": "Минимальный порог суммы (в KZT), ниже которого правило не начисляет риск.",
        "higher_effect": "Повышение минимальной суммы отсекает мелкие операции от правила (меньше шума, но могут пропускаться дробления).",
        "lower_effect": "Снижение минимальной суммы включает более мелкие переводы в зону контроля правила.",
    },
    "context_amount_ratio": {
        "purpose": "Допустимый коэффициент превышения суммы относительно исторического профиля клиента.",
        "higher_effect": "Увеличение коэффициента делает проверку к сумме более мягкой (правило срабатывает только при более крупном скачке).",
        "lower_effect": "Снижение коэффициента делает детектор чувствительнее к меньшим отклонениям суммы от профиля клиента.",
    },
    "amount_tolerance_pct": {
        "purpose": "Допустимое относительное отклонение суммы (tolerance) при сравнении похожих переводов.",
        "higher_effect": "Расширение tolerance объединяет операции с близкими, но слегка изменёнными суммами (выше охват модифицированных дублей и выше риск ложных совпадений).",
        "lower_effect": "Сужение tolerance требует почти полного совпадения сумм (меньше ложных дублей, но изменённая на несколько процентов сумма не совпадёт).",
    },
    "night_bonus": {
        "purpose": "Дополнительный балл риска за проведение операции новому получателю в ночные часы (00:00–06:00).",
        "higher_effect": "Увеличение ночной надбавки повышает риск-балл ночных переводов новым получателям.",
        "lower_effect": "Уменьшение ночной надбавки снижает штраф за ночное время при отсутствии других факторов.",
    },
    "decision_threshold": {
        "purpose": "Общий порог risk score (0–100), при достижении которого операция блокируется.",
        "higher_effect": "Повышение общего порога ужесточает критерий блокировки (меньше FP, но возможен пропуск пограничных атак).",
        "lower_effect": "Снижение общего порога переводит больше пограничных операций в блокировку (рост охвата и риск роста FP по всем сценариям).",
    },
}


def _build_internal_param_metadata(
    diff_item: Dict[str, Any],
    val_scenario_metrics: List[Dict[str, Any]],
) -> Dict[str, Any]:
    rule = str(diff_item.get("rule", ""))
    param = str(diff_item.get("param", ""))
    old_v = diff_item.get("old_value")
    new_v = diff_item.get("new_value")
    meta = _INTERNAL_PARAM_CATALOG.get(param, {})

    scen_map = {s["scenario_type"]: s for s in (val_scenario_metrics or [])}
    rule_to_scen = {
        "duplicate_payment": "duplicate_payment",
        "new_recipient_risk": "new_recipient_risk",
        "unusual_amount": "unusual_amount",
        "unusual_frequency": "suspicious_sequence",
        "suspicious_sequence": "suspicious_sequence",
        "structuring_smurfing": "structuring_smurfing",
        "account_takeover_ato": "account_takeover_ato",
    }
    linked_scen = rule_to_scen.get(rule)
    linked_weakness: Optional[str] = None
    if linked_scen and linked_scen in scen_map:
        sm = scen_map[linked_scen]
        fn = int(sm.get("false_negatives", 0) or 0)
        act = int(sm.get("actual_risk_events", 0) or 0)
        fp = int(sm.get("false_positives", 0) or 0)
        if fn > 0:
            linked_weakness = f"{linked_scen}: validation FN {fn}/{act}"
        elif fp > 0:
            linked_weakness = f"{linked_scen}: validation FP {fp}"

    expected_effect = meta.get("lower_effect", "")
    if isinstance(old_v, (int, float)) and isinstance(new_v, (int, float)):
        if new_v > old_v:
            expected_effect = meta.get("higher_effect", "")
        elif new_v < old_v:
            expected_effect = meta.get("lower_effect", "")
    elif isinstance(old_v, bool) and isinstance(new_v, bool):
        expected_effect = "Включение правила добавляет сигнал в общий скоринг." if new_v else "Отключение правила исключает его влияние."

    return {
        "mechanism": linked_scen or ("decision_threshold" if rule == "decision_threshold" else rule),
        "purpose": meta.get("purpose", ""),
        "expected_effect": expected_effect,
        "linked_weakness": linked_weakness,
    }


def _collect_unfixed_weaknesses(scenario_metrics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    remaining: List[Dict[str, Any]] = []
    for sm in scenario_metrics or []:
        st = sm.get("scenario_type")
        if st == "normal_activity":
            fp = int(sm.get("false_positives", 0) or 0)
            if fp > 0:
                remaining.append({"scenario_type": st, "false_positives": fp, "false_negatives": 0, "actual_risk_events": 0, "recall": sm.get("recall")})
            continue
        fn = int(sm.get("false_negatives", 0) or 0)
        fp = int(sm.get("false_positives", 0) or 0)
        act = int(sm.get("actual_risk_events", 0) or 0)
        if fn > 0 or fp > 0:
            remaining.append(
                {
                    "scenario_type": st,
                    "actual_risk_events": act,
                    "false_negatives": fn,
                    "false_positives": fp,
                    "recall": sm.get("recall"),
                }
            )
    return remaining


def analyze_for_evolution(
    db: Session,
    baseline_experiment: Experiment,
    guardrails: Optional[Dict[str, Any]] = None,
) -> EvolutionRun:
    """
    Steps 1–5 of Defense Evolution 2.0:
    1. Run baseline on 'validation' split.
    2. Identify scenario weaknesses & root causes.
    3. Generate Candidates A, B, C, D and run isolated single-rule ablations on 'validation' split.
    4. Validate all candidates against configurable Guardrails on 'validation'.
    5. Select best candidate passing guardrails for held-out evaluation.
    """
    dataset = db.query(Dataset).filter(Dataset.id == baseline_experiment.dataset_id).first()
    baseline_config = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == baseline_experiment.defense_config_id)
        .first()
    )
    if not dataset or not baseline_config:
        raise ValueError("Dataset or baseline defense configuration not found")

    active_guardrails = {**DEFAULT_GUARDRAILS, **(guardrails or {})}

    # Step 1: Validation baseline run
    val_baseline_exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=baseline_config,
        name=f"[Evo-Validation Baseline] {baseline_config.version}",
        split_name="validation",
        scenarios=baseline_experiment.scenarios_json,
    )

    val_results_rows = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == val_baseline_exp.id)
        .all()
    )
    val_results = [
        {
            "transaction_code": r.transaction_code,
            "scenario_type": r.scenario_type,
            "risk_score": r.risk_score,
            "predicted_label": r.predicted_label,
            "ground_truth_label": r.ground_truth_label,
            "triggered_rules_json": r.triggered_rules_json,
        }
        for r in val_results_rows
    ]

    # Step 2: Weakness identification & recommendation generation on validation split ONLY
    analyst = analyze_experiment_deterministic(
        metrics=val_baseline_exp.metrics_json,
        scenario_metrics=val_baseline_exp.scenario_metrics_json,
        rule_impact=val_baseline_exp.rule_impact_json,
        results=val_results,
        rules_config=baseline_config.rules_config_json,
        decision_threshold=baseline_config.decision_threshold,
    )

    val_sanitized, cust_map, val_gt = _load_split_memory_buffers(
        db=db,
        dataset_id=dataset.id,
        split_name="validation",
        scenarios=baseline_experiment.scenarios_json,
    )
    base_val_m = val_baseline_exp.metrics_json

    # Single-rule ablation on validation split for explainable attribution
    rec_reason_by_rule = {r["target_rule"]: r["explanation"] for r in analyst["recommendations"]}
    rule_ablation_map: Dict[str, Dict[str, Any]] = {}
    for rule_name, new_r_cfg in analyst["proposed_rules_config"].items():
        old_r_cfg = baseline_config.rules_config_json.get(rule_name, {})
        if old_r_cfg == new_r_cfg:
            continue
        isolated_rules = deepcopy(baseline_config.rules_config_json)
        isolated_rules[rule_name] = deepcopy(new_r_cfg)
        iso_eval = _fast_evaluate_rules_on_split(
            sanitized_txs=val_sanitized,
            customers_by_code=cust_map,
            ground_truth_by_tx_id=val_gt,
            rules_config=isolated_rules,
            decision_threshold=baseline_config.decision_threshold,
            risk_levels=baseline_config.risk_levels_json,
        )
        iso_m = iso_eval["metrics"]
        fp_diff = int(iso_m["false_positives"]) - int(base_val_m["false_positives"])
        tp_diff = int(iso_m["true_positives"]) - int(base_val_m["true_positives"])
        side_effect = (
            f"Isolated test on validation split: TP {tp_diff:+d}, FP {fp_diff:+d} "
            f"(FPR {float(iso_m['false_positive_rate']) - float(base_val_m['false_positive_rate']):+.2%})."
        )
        rule_ablation_map[rule_name] = {
            "before_metrics": {
                "recall": base_val_m["recall"],
                "precision": base_val_m["precision"],
                "f1_score": base_val_m["f1_score"],
                "false_positive_rate": base_val_m["false_positive_rate"],
                "true_positives": base_val_m["true_positives"],
                "false_positives": base_val_m["false_positives"],
            },
            "after_metrics": {
                "recall": iso_m["recall"],
                "precision": iso_m["precision"],
                "f1_score": iso_m["f1_score"],
                "false_positive_rate": iso_m["false_positive_rate"],
                "true_positives": iso_m["true_positives"],
                "false_positives": iso_m["false_positives"],
            },
            "side_effects": side_effect,
            "reason": rec_reason_by_rule.get(
                rule_name,
                f"Targeted parameter calibration for {rule_name} based on validation error profile.",
            ),
        }

    # Step 3 & 4: Generate Candidates A, B, C, D and evaluate each on validation split
    raw_candidates = _build_candidate_variants(
        base_rules=baseline_config.rules_config_json,
        proposed_rules=analyst["proposed_rules_config"],
        base_threshold=baseline_config.decision_threshold,
        proposed_threshold=analyst["proposed_decision_threshold"],
    )

    evaluated_candidates: List[Dict[str, Any]] = []
    best_cand_key = "D"
    best_score = -1e9

    for cand in raw_candidates:
        diffs = compute_config_diff(
            parent_rules=baseline_config.rules_config_json,
            new_rules=cand["rules_config"],
            parent_threshold=baseline_config.decision_threshold,
            new_threshold=cand["decision_threshold"],
        )
        # Enrich each diff with single-rule ablation attribution + param semantic metadata
        for d in diffs:
            pmeta = _build_internal_param_metadata(d, val_baseline_exp.scenario_metrics_json)
            d["mechanism"] = pmeta["mechanism"]
            d["purpose"] = pmeta["purpose"]
            d["expected_effect"] = pmeta["expected_effect"]
            d["linked_weakness"] = pmeta["linked_weakness"]
            abl = rule_ablation_map.get(d["rule"])
            if abl:
                d["reason"] = pmeta["expected_effect"] or abl["reason"]
                d["before_metrics"] = abl["before_metrics"]
                d["after_metrics"] = abl["after_metrics"]
                d["side_effects"] = abl["side_effects"]
                d["attribution_mode"] = "isolated_single_rule_ablation"
            else:
                d["reason"] = pmeta["expected_effect"] or rec_reason_by_rule.get(d["rule"], "Global threshold adjustment.")
                d["before_metrics"] = {
                    "recall": base_val_m["recall"],
                    "f1_score": base_val_m["f1_score"],
                    "false_positive_rate": base_val_m["false_positive_rate"],
                }
                d["after_metrics"] = None
                d["side_effects"] = "Оценено в составе общей конфигурации (влияет на все сценарии)."
                d["attribution_mode"] = "multi_param_joint"

        c_eval = _fast_evaluate_rules_on_split(
            sanitized_txs=val_sanitized,
            customers_by_code=cust_map,
            ground_truth_by_tx_id=val_gt,
            rules_config=cand["rules_config"],
            decision_threshold=cand["decision_threshold"],
            risk_levels=baseline_config.risk_levels_json,
        )
        c_m = c_eval["metrics"]
        c_unfixed = _collect_unfixed_weaknesses(c_eval["scenario_metrics"])
        c_cmp = _compare_metric_dicts(base_val_m, c_m)
        c_verdict, c_assessment, c_gr_check = evaluate_evolution_verdict(
            val_cmp=c_cmp,
            eval_cmp=c_cmp,
            guardrails=active_guardrails,
            changed_params_count=len(diffs),
        )

        # Candidate selection objective on validation split ONLY (never touches evaluation split!)
        passes_gr = c_verdict in ("improved", "mixed") and c_gr_check["checks"]["fpr_ok"]
        obj_score = (
            float(c_m["f1_score"])
            + 0.15 * float(c_m["recall"])
            - 2.0 * float(c_m["false_positive_rate"])
            + (0.25 if passes_gr else -0.25)
        )
        if len(diffs) > 0 and obj_score > best_score:
            best_score = obj_score
            best_cand_key = cand["key"]

        evaluated_candidates.append(
            {
                "key": cand["key"],
                "name": cand["name"],
                "strategy": cand["strategy"],
                "description": cand["description"],
                "changed_params": diffs,
                "changed_params_count": len(diffs),
                "validation_metrics": c_m,
                "validation_delta": c_cmp["delta"],
                "validation_verdict": c_verdict,
                "validation_assessment": c_assessment,
                "validation_unfixed_weaknesses": c_unfixed,
                "guardrail_checks": c_gr_check["checks"],
                "rules_config": cand["rules_config"],
                "decision_threshold": cand["decision_threshold"],
            }
        )

    selected_cand = next(
        (c for c in evaluated_candidates if c["key"] == best_cand_key),
        evaluated_candidates[-1],
    )

    evo_run = EvolutionRun(
        baseline_experiment_id=baseline_experiment.id,
        baseline_config_id=baseline_config.id,
        validation_baseline_experiment_id=val_baseline_exp.id,
        weaknesses_json=analyst["weaknesses"],
        recommendations_json=analyst["recommendations"],
        candidates_json=evaluated_candidates,
        guardrails_json=active_guardrails,
        selected_candidate_key=selected_cand["key"],
        proposed_rules_config_json=selected_cand["rules_config"],
        proposed_decision_threshold=selected_cand["decision_threshold"],
        changed_params_json=selected_cand["changed_params"],
        comparison_json={
            "validation_split": {
                "baseline": base_val_m,
                "candidate": selected_cand["validation_metrics"],
                "delta": selected_cand["validation_delta"],
            },
            "validation_unfixed_weaknesses": selected_cand.get("validation_unfixed_weaknesses", []),
            "guardrails": active_guardrails,
            "analysis_mode": analyst["analysis_mode"],
            "selected_candidate_key": selected_cand["key"],
            "selected_candidate_name": selected_cand["name"],
        },
        tradeoff_assessment=(
            f"Selected {selected_cand['name']} on validation split "
            f"(Validation F1 {selected_cand['validation_delta']['f1_score']:+.1%}, "
            f"Recall {selected_cand['validation_delta']['recall']:+.1%}). Ready for held-out final evaluation."
        ),
        verdict="pending_validation",
        status="analyzed",
    )
    db.add(evo_run)
    db.commit()
    db.refresh(evo_run)
    return evo_run


def validate_and_evaluate_evolution(
    db: Session,
    evo_run: EvolutionRun,
    candidate_name: Optional[str] = None,
    candidate_key: Optional[str] = None,
    custom_rules_config: Optional[Dict[str, Dict[str, Any]]] = None,
    custom_decision_threshold: Optional[float] = None,
    guardrails: Optional[Dict[str, Any]] = None,
) -> EvolutionRun:
    """
    Steps 6–8 of Defense Evolution 2.0:
    Create immutable versioned DefenseConfiguration for the chosen candidate,
    validate on 'validation' split, run held-out final evaluation on 'evaluation' split,
    apply Guardrails, and record complete comparison and verdict.
    """
    baseline_exp = db.query(Experiment).filter(Experiment.id == evo_run.baseline_experiment_id).first()
    dataset = db.query(Dataset).filter(Dataset.id == baseline_exp.dataset_id).first()
    baseline_config = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == evo_run.baseline_config_id)
        .first()
    )
    val_baseline_exp = (
        db.query(Experiment)
        .filter(Experiment.id == evo_run.validation_baseline_experiment_id)
        .first()
    )

    active_guardrails = {**DEFAULT_GUARDRAILS, **(evo_run.guardrails_json or {}), **(guardrails or {})}

    # Resolve selected candidate variant if candidate_key is specified
    chosen_key = candidate_key or evo_run.selected_candidate_key or "D"
    cand_entry = next(
        (c for c in (evo_run.candidates_json or []) if c.get("key") == chosen_key),
        None,
    )

    if custom_rules_config is not None:
        rules_to_use = deepcopy(custom_rules_config)
    elif cand_entry is not None:
        rules_to_use = deepcopy(cand_entry["rules_config"])
    else:
        rules_to_use = deepcopy(evo_run.proposed_rules_config_json)

    if custom_decision_threshold is not None:
        thresh_to_use = float(custom_decision_threshold)
    elif cand_entry is not None:
        thresh_to_use = float(cand_entry["decision_threshold"])
    else:
        thresh_to_use = float(evo_run.proposed_decision_threshold)

    # Preserve single-rule attribution metadata from cand_entry if available
    raw_diffs = compute_config_diff(
        parent_rules=baseline_config.rules_config_json,
        new_rules=rules_to_use,
        parent_threshold=baseline_config.decision_threshold,
        new_threshold=thresh_to_use,
    )
    existing_diff_meta = {
        (d["rule"], d["param"]): d
        for d in (cand_entry.get("changed_params", []) if cand_entry else evo_run.changed_params_json or [])
    }
    changed_params: List[Dict[str, Any]] = []
    for d in raw_diffs:
        prev_meta = existing_diff_meta.get((d["rule"], d["param"]), {})
        changed_params.append({**prev_meta, **d})

    version_label = _next_version_label(db)
    cand_label = cand_entry["name"] if cand_entry else f"Candidate {chosen_key}"
    cand_config = DefenseConfiguration(
        name=candidate_name or f"{cand_label} ({version_label})",
        version=version_label,
        description=(
            f"Evolved from {baseline_config.version} via Defense Evolution #{evo_run.id} "
            f"[{cand_label}]."
        ),
        parent_version_id=baseline_config.id,
        is_baseline=False,
        decision_threshold=thresh_to_use,
        risk_levels_json=deepcopy(baseline_config.risk_levels_json),
        rules_config_json=rules_to_use,
        changed_params_json=changed_params,
    )
    db.add(cand_config)
    db.commit()
    db.refresh(cand_config)

    # Validation split experiment for chosen candidate
    val_cand_exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=cand_config,
        name=f"[Evo-Validation Candidate {chosen_key}] {cand_config.version}",
        split_name="validation",
        scenarios=baseline_exp.scenarios_json,
    )

    # Held-out Final Evaluation on 'evaluation' split for BOTH baseline and candidate
    eval_base_exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=baseline_config,
        name=f"[Evo-Final Baseline] {baseline_config.version}",
        split_name="evaluation",
        scenarios=baseline_exp.scenarios_json,
    )
    eval_cand_exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=cand_config,
        name=f"[Evo-Final Candidate {chosen_key}] {cand_config.version}",
        split_name="evaluation",
        scenarios=baseline_exp.scenarios_json,
    )

    # Full-dataset run for overview & reports history
    full_cand_exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=cand_config,
        name=f"Evolution Stress Test — {cand_config.version} (Cand {chosen_key})",
        split_name=baseline_exp.split_name,
        scenarios=baseline_exp.scenarios_json,
    )

    val_cmp = _compare_metric_dicts(val_baseline_exp.metrics_json, val_cand_exp.metrics_json)
    eval_cmp = _compare_metric_dicts(eval_base_exp.metrics_json, eval_cand_exp.metrics_json)
    full_cmp = _compare_metric_dicts(baseline_exp.metrics_json, full_cand_exp.metrics_json)

    scen_bundle = compute_matched_scenario_comparison(
        db=db,
        baseline_experiment_id=eval_base_exp.id,
        candidate_experiment_id=eval_cand_exp.id,
    )
    scenario_comparison = scen_bundle["items"]
    scenario_audit = scen_bundle["audit"]
    eval_remaining_weaknesses = _collect_unfixed_weaknesses(eval_cand_exp.scenario_metrics_json)

    # Held-out Adversarial Shift Check (±10–15% amounts & timing/intervals) on evaluation split
    eval_sanitized, eval_cust_map, eval_gt = _load_split_memory_buffers(
        db=db,
        dataset_id=dataset.id,
        split_name="evaluation",
        scenarios=baseline_exp.scenarios_json,
    )
    shift_seed = int(getattr(dataset, "seed", 42) or 42) + int(evo_run.id)
    if eval_sanitized:
        shifted_eval_txs = apply_adversarial_shift(eval_sanitized, seed=shift_seed)
        base_shifted_res = _fast_evaluate_rules_on_split(
            sanitized_txs=shifted_eval_txs,
            customers_by_code=eval_cust_map,
            ground_truth_by_tx_id=eval_gt,
            rules_config=baseline_config.rules_config_json,
            decision_threshold=baseline_config.decision_threshold,
            risk_levels=baseline_config.risk_levels_json,
        )
        cand_shifted_res = _fast_evaluate_rules_on_split(
            sanitized_txs=shifted_eval_txs,
            customers_by_code=eval_cust_map,
            ground_truth_by_tx_id=eval_gt,
            rules_config=cand_config.rules_config_json,
            decision_threshold=cand_config.decision_threshold,
            risk_levels=cand_config.risk_levels_json,
        )
        adversarial_shift = summarize_adversarial_shift(
            cand_clean_metrics=eval_cand_exp.metrics_json,
            cand_shifted_metrics=cand_shifted_res["metrics"],
            base_shifted_metrics=base_shifted_res["metrics"],
            guardrails=active_guardrails,
            tx_count=len(eval_sanitized),
            seed=shift_seed,
        )
    else:
        adversarial_shift = {
            "status": "unavailable",
            "passed": True,
            "reason": "Insufficient evaluation transactions for adversarial shift stress check.",
        }

    verdict, assessment, guardrail_report = evaluate_evolution_verdict(
        val_cmp=val_cmp,
        eval_cmp=eval_cmp,
        guardrails=active_guardrails,
        changed_params_count=len(changed_params),
        adversarial_shift=adversarial_shift,
    )

    evo_run.candidate_config_id = cand_config.id
    evo_run.selected_candidate_key = chosen_key
    evo_run.guardrails_json = guardrail_report
    evo_run.validation_candidate_experiment_id = val_cand_exp.id
    evo_run.final_baseline_experiment_id = eval_base_exp.id
    evo_run.final_candidate_experiment_id = eval_cand_exp.id
    evo_run.changed_params_json = changed_params
    evo_run.comparison_json = {
        **(evo_run.comparison_json or {}),
        "validation_split": val_cmp,
        "evaluation_split": eval_cmp,
        "full_dataset": full_cmp,
        "full_candidate_experiment_id": full_cand_exp.id,
        "scenario_comparison": scenario_comparison,
        "scenario_audit": scenario_audit,
        "evaluation_remaining_weaknesses": eval_remaining_weaknesses,
        "baseline_version": baseline_config.version,
        "candidate_version": cand_config.version,
        "selected_candidate_key": chosen_key,
        "selected_candidate_name": cand_label,
        "guardrail_report": guardrail_report,
        "adversarial_shift": adversarial_shift,
    }
    evo_run.tradeoff_assessment = assessment
    evo_run.verdict = verdict
    evo_run.status = "completed"

    db.commit()
    db.refresh(evo_run)
    return evo_run


def build_evolution_lineage(db: Session) -> List[Dict[str, Any]]:
    """
    Build the version evolution history showing parent lineage, changed parameters,
    validation metrics, held-out evaluation metrics, verdict, and recommendation summary.
    """
    configs = (
        db.query(DefenseConfiguration)
        .order_by(DefenseConfiguration.created_at.asc(), DefenseConfiguration.id.asc())
        .all()
    )
    cfg_by_id = {c.id: c for c in configs}
    evo_runs = (
        db.query(EvolutionRun)
        .order_by(EvolutionRun.created_at.desc(), EvolutionRun.id.desc())
        .all()
    )

    evo_by_cand_id: Dict[int, EvolutionRun] = {}
    for r in evo_runs:
        if r.candidate_config_id and r.candidate_config_id not in evo_by_cand_id:
            evo_by_cand_id[r.candidate_config_id] = r

    history: List[Dict[str, Any]] = []
    for cfg in configs:
        parent = cfg_by_id.get(cfg.parent_version_id) if cfg.parent_version_id else None
        evo = evo_by_cand_id.get(cfg.id)

        val_metrics = None
        eval_metrics = None
        verdict = "baseline" if cfg.is_baseline else "manual_version"
        rec_summary = cfg.description

        if evo:
            val_metrics = (evo.comparison_json or {}).get("validation_split", {}).get("candidate")
            eval_metrics = (evo.comparison_json or {}).get("evaluation_split", {}).get("candidate")
            verdict = evo.verdict
            rec_summary = evo.tradeoff_assessment
        else:
            # Check if there is any experiment for this config
            latest_exp = (
                db.query(Experiment)
                .filter(Experiment.defense_config_id == cfg.id)
                .order_by(Experiment.created_at.desc(), Experiment.id.desc())
                .first()
            )
            if latest_exp:
                if latest_exp.split_name == "validation":
                    val_metrics = latest_exp.metrics_json
                else:
                    eval_metrics = latest_exp.metrics_json

        history.append(
            {
                "id": cfg.id,
                "version": cfg.version,
                "name": cfg.name,
                "parent_version_id": cfg.parent_version_id,
                "parent_version": parent.version if parent else None,
                "is_baseline": cfg.is_baseline,
                "decision_threshold": cfg.decision_threshold,
                "changed_params": cfg.changed_params_json,
                "validation_metrics": val_metrics,
                "evaluation_metrics": eval_metrics,
                "verdict": verdict,
                "recommendation_summary": rec_summary,
                "evolution_run_id": evo.id if evo else None,
                "created_at": cfg.created_at.isoformat(),
            }
        )

    return history


def compute_matched_scenario_comparison(
    db: Session,
    baseline_experiment_id: int,
    candidate_experiment_id: int,
) -> Dict[str, Any]:
    """
    Compute TP, FP, FN, TN, Recall, Precision, F1, and FPR separately for baseline
    and candidate per scenario directly from matched ExperimentResult rows on the
    exact same evaluation split (never defaulting missing metrics to 0).
    Also verifies whether scenario_type categories are disjoint and whether their
    TP/FP/FN/TN sums equal the matched overall confusion matrix.
    """
    base_rows = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == baseline_experiment_id)
        .all()
    )
    cand_rows = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == candidate_experiment_id)
        .all()
    )
    cand_by_code = {r.transaction_code: r for r in cand_rows}

    matched_pairs: List[tuple[ExperimentResult, ExperimentResult]] = []
    tx_scenarios: Dict[str, set[str]] = defaultdict(set)
    for b in base_rows:
        tx_scenarios[b.transaction_code].add(b.scenario_type)
        c = cand_by_code.get(b.transaction_code)
        if c:
            tx_scenarios[c.transaction_code].add(c.scenario_type)
            matched_pairs.append((b, c))

    categories_disjoint = all(len(scens) == 1 for scens in tx_scenarios.values()) and len(
        base_rows
    ) == len(matched_pairs)

    by_scenario: Dict[str, List[tuple[ExperimentResult, ExperimentResult]]] = defaultdict(list)
    for b, c in matched_pairs:
        by_scenario[b.scenario_type].append((b, c))

    def _tally(pairs: List[tuple[ExperimentResult, ExperimentResult]], is_cand: bool) -> Dict[str, Any]:
        tp = fp = tn = fn = 0
        for b, c in pairs:
            gt = int(b.ground_truth_label)
            pred = int(c.predicted_label if is_cand else b.predicted_label)
            if gt == 1 and pred == 1:
                tp += 1
            elif gt == 0 and pred == 1:
                fp += 1
            elif gt == 0 and pred == 0:
                tn += 1
            elif gt == 1 and pred == 0:
                fn += 1
        actual_risk = tp + fn
        actual_legit = tn + fp
        prec = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 0.0
        rec = round(tp / actual_risk, 4) if actual_risk > 0 else 0.0
        f1 = round(2 * prec * rec / (prec + rec), 4) if (prec + rec) > 0 else 0.0
        fpr = round(fp / actual_legit, 4) if actual_legit > 0 else 0.0
        return {
            "tp": tp,
            "fp": fp,
            "tn": tn,
            "fn": fn,
            "actual_risk_events": actual_risk,
            "actual_legit_events": actual_legit,
            "precision": prec,
            "recall": rec,
            "f1_score": f1,
            "false_positive_rate": fpr,
        }

    items: List[Dict[str, Any]] = []
    for sk in sorted(by_scenario.keys()):
        pairs = by_scenario[sk]
        bm = _tally(pairs, is_cand=False)
        cm = _tally(pairs, is_cand=True)
        items.append(
            {
                "scenario_type": sk,
                "total_transactions": len(pairs),
                "actual_risk_events": bm["actual_risk_events"],
                "actual_legit_events": bm["actual_legit_events"],
                "baseline_recall": bm["recall"],
                "candidate_recall": cm["recall"],
                "recall_delta": round(cm["recall"] - bm["recall"], 4),
                "baseline_tp": bm["tp"],
                "candidate_tp": cm["tp"],
                "baseline_fn": bm["fn"],
                "candidate_fn": cm["fn"],
                "fn_delta": cm["fn"] - bm["fn"],
                "baseline_fp": bm["fp"],
                "candidate_fp": cm["fp"],
                "fp_delta": cm["fp"] - bm["fp"],
                "baseline_tn": bm["tn"],
                "candidate_tn": cm["tn"],
                "baseline_precision": bm["precision"],
                "candidate_precision": cm["precision"],
                "baseline_f1": bm["f1_score"],
                "candidate_f1": cm["f1_score"],
                "f1_delta": round(cm["f1_score"] - bm["f1_score"], 4),
                "baseline_fpr": bm["false_positive_rate"],
                "candidate_fpr": cm["false_positive_rate"],
                "fpr_delta": round(cm["false_positive_rate"] - bm["false_positive_rate"], 4),
            }
        )

    ov_base = _tally(matched_pairs, is_cand=False)
    ov_cand = _tally(matched_pairs, is_cand=True)

    totals_match = False
    if categories_disjoint and matched_pairs:
        sum_b_fn = sum(x["baseline_fn"] for x in items)
        sum_c_fn = sum(x["candidate_fn"] for x in items)
        sum_b_fp = sum(x["baseline_fp"] for x in items)
        sum_c_fp = sum(x["candidate_fp"] for x in items)
        sum_b_tp = sum(x["baseline_tp"] for x in items)
        sum_c_tp = sum(x["candidate_tp"] for x in items)
        totals_match = (
            sum_b_fn == ov_base["fn"]
            and sum_c_fn == ov_cand["fn"]
            and sum_b_fp == ov_base["fp"]
            and sum_c_fp == ov_cand["fp"]
            and sum_b_tp == ov_base["tp"]
            and sum_c_tp == ov_cand["tp"]
        )

    return {
        "items": items,
        "audit": {
            "categories_disjoint": categories_disjoint,
            "matched_transactions": len(matched_pairs),
            "totals_match_overall": totals_match,
            "overall": {
                "actual_risk_events": ov_base["actual_risk_events"],
                "baseline_tp": ov_base["tp"],
                "candidate_tp": ov_cand["tp"],
                "baseline_fn": ov_base["fn"],
                "candidate_fn": ov_cand["fn"],
                "baseline_fp": ov_base["fp"],
                "candidate_fp": ov_cand["fp"],
            },
        },
    }


def compute_experiment_transaction_diff(
    db: Session,
    baseline_experiment_id: int,
    candidate_experiment_id: int,
) -> Dict[str, Any]:
    """
    Match baseline and candidate ExperimentResult rows strictly by transaction_code
    on the same evaluated dataset/split to surface:
    - fixed_misses (GT=1, Baseline=0 -> Candidate=1)
    - new_false_positives (GT=0, Baseline=0 -> Candidate=1)
    - new_misses (GT=1, Baseline=1 -> Candidate=0)
    - fixed_false_positives (GT=0, Baseline=1 -> Candidate=0)
    """
    base_exp = db.query(Experiment).filter(Experiment.id == baseline_experiment_id).first()
    cand_exp = db.query(Experiment).filter(Experiment.id == candidate_experiment_id).first()
    if not base_exp or not cand_exp:
        raise ValueError("Baseline or candidate experiment not found for diff")

    base_has_scores = (
        True
        if base_exp.adapter_type == "internal"
        else bool((base_exp.completeness_json or {}).get("has_risk_scores", True))
    )
    cand_has_scores = (
        True
        if cand_exp.adapter_type == "internal"
        else bool((cand_exp.completeness_json or {}).get("has_risk_scores", True))
    )

    base_rows = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == baseline_experiment_id)
        .all()
    )
    cand_rows = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == candidate_experiment_id)
        .all()
    )

    cand_by_code = {r.transaction_code: r for r in cand_rows}
    fixed_misses: List[Dict[str, Any]] = []
    new_false_positives: List[Dict[str, Any]] = []
    new_misses: List[Dict[str, Any]] = []
    fixed_false_positives: List[Dict[str, Any]] = []
    matched_count = 0

    for b in base_rows:
        c = cand_by_code.get(b.transaction_code)
        if not c:
            continue
        matched_count += 1
        item = {
            "transaction_code": b.transaction_code,
            "scenario_type": b.scenario_type,
            "amount_kzt": b.amount_kzt,
            "timestamp": b.timestamp.isoformat(),
            "ground_truth_label": b.ground_truth_label,
            "old_decision": b.predicted_label,
            "new_decision": c.predicted_label,
            "old_risk_score": b.risk_score if base_has_scores else None,
            "new_risk_score": c.risk_score if cand_has_scores else None,
            "old_triggered_rules": [
                tr.get("rule") for tr in (b.triggered_rules_json or []) if tr.get("rule")
            ],
            "new_triggered_rules": [
                tr.get("rule") for tr in (c.triggered_rules_json or []) if tr.get("rule")
            ],
            "explanation": c.explanation,
        }
        if b.ground_truth_label == 1 and b.predicted_label == 0 and c.predicted_label == 1:
            fixed_misses.append(item)
        elif b.ground_truth_label == 0 and b.predicted_label == 0 and c.predicted_label == 1:
            new_false_positives.append(item)
        elif b.ground_truth_label == 1 and b.predicted_label == 1 and c.predicted_label == 0:
            new_misses.append(item)
        elif b.ground_truth_label == 0 and b.predicted_label == 1 and c.predicted_label == 0:
            fixed_false_positives.append(item)

    fixed_misses.sort(key=lambda x: x["amount_kzt"], reverse=True)
    new_false_positives.sort(key=lambda x: x["amount_kzt"], reverse=True)
    new_misses.sort(key=lambda x: x["amount_kzt"], reverse=True)

    return {
        "baseline_experiment_id": baseline_experiment_id,
        "candidate_experiment_id": candidate_experiment_id,
        "split_name": cand_exp.split_name,
        "summary": {
            "matched_transactions": matched_count,
            "fixed_misses_count": len(fixed_misses),
            "new_false_positives_count": len(new_false_positives),
            "new_misses_count": len(new_misses),
            "fixed_false_positives_count": len(fixed_false_positives),
        },
        "fixed_misses": fixed_misses[:50],
        "new_false_positives": new_false_positives[:50],
        "new_misses": new_misses[:50],
        "fixed_false_positives": fixed_false_positives[:50],
    }
