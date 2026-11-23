"""Security Intelligence Service: Weakness Explorer, FP/FN Root-Cause Analysis, Transaction Inspector, and Reliability Report."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..models import (
    AntifraudEngine,
    Dataset,
    DefenseConfiguration,
    EvolutionRun,
    Experiment,
    ExperimentResult,
    SyntheticTransaction,
    VirtualCustomer,
)
from .ai_analyst import analyze_experiment_deterministic


def _classify_outcome(pred: int, gt: int) -> str:
    if pred == 1 and gt == 1:
        return "TP"
    if pred == 1 and gt == 0:
        return "FP"
    if pred == 0 and gt == 1:
        return "FN"
    return "TN"


def resolve_decision_trace(
    res: ExperimentResult,
    decision_threshold: float,
    is_internal: bool,
    has_risk_scores: bool,
) -> Dict[str, Any]:
    """Return structured decision trace, falling back honestly to triggered_rules when absent."""
    stored = getattr(res, "decision_trace_json", None)
    if isinstance(stored, dict) and isinstance(stored.get("rules"), list):
        return stored

    decision = "block" if res.predicted_label == 1 else ("review" if res.risk_level == "medium" else "allow")
    rules = [
        {
            "rule_name": str(tr.get("rule") or "rule"),
            "triggered": True,
            "score_contribution": tr.get("contribution") if is_internal else None,
            "actual_value": tr.get("ratio") or tr.get("slice_count") or tr.get("seq_count") or tr.get("count_in_window"),
            "threshold_value": None,
            "metric_unit": None,
        }
        for tr in (res.triggered_rules_json or [])
        if tr.get("rule")
    ]
    return {
        "risk_score": float(res.risk_score) if has_risk_scores else None,
        "decision_threshold": round(decision_threshold, 2) if is_internal else None,
        "review_threshold": None,
        "decision": decision,
        "predicted_label": int(res.predicted_label),
        "rules": rules,
    }


def build_security_intelligence_report(
    db: Session,
    experiment: Experiment,
    compare_experiment_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Generate the complete Security Intelligence diagnostic payload for an experiment,
    including Weakness Explorer, False Positive Analysis, False Negative Analysis,
    Transaction Inspector items, and Reliability Report.
    """
    dataset = db.query(Dataset).filter(Dataset.id == experiment.dataset_id).first()
    is_internal = experiment.adapter_type == "internal"
    is_black_box = experiment.diagnostic_mode == "black_box"
    defense = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == experiment.defense_config_id)
        .first()
        if is_internal
        else None
    )
    ext_cfg = experiment.external_config_json or {}
    decision_threshold = float(
        defense.decision_threshold
        if defense
        else ext_cfg.get("decision_threshold", 55.0)
    )

    # Find comparison baseline experiment if not explicitly provided
    compare_exp: Optional[Experiment] = None
    if compare_experiment_id:
        compare_exp = db.query(Experiment).filter(Experiment.id == compare_experiment_id).first()
    elif defense and defense.parent_version_id:
        compare_exp = (
            db.query(Experiment)
            .filter(
                Experiment.dataset_id == experiment.dataset_id,
                Experiment.defense_config_id == defense.parent_version_id,
                Experiment.split_name == experiment.split_name,
            )
            .order_by(Experiment.created_at.desc(), Experiment.id.desc())
            .first()
        )

    result_rows = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == experiment.id)
        .order_by(ExperimentResult.risk_score.desc(), ExperimentResult.id.asc())
        .all()
    )

    tx_rows = (
        db.query(SyntheticTransaction)
        .filter(SyntheticTransaction.dataset_id == experiment.dataset_id)
        .all()
    )
    tx_meta_by_id = {
        t.id: {
            "transaction_type": t.transaction_type,
            "channel": t.channel,
            "is_new_recipient": t.is_new_recipient,
            "customer_segment": t.customer_segment,
            "transaction_frequency": t.transaction_frequency,
        }
        for t in tx_rows
    }

    # Group results by scenario and outcome
    by_scenario_rows: Dict[str, List[ExperimentResult]] = defaultdict(list)
    fn_rows: List[ExperimentResult] = []
    fp_rows: List[ExperimentResult] = []
    tp_rows: List[ExperimentResult] = []
    tn_rows: List[ExperimentResult] = []

    for r in result_rows:
        by_scenario_rows[r.scenario_type].append(r)
        out = _classify_outcome(r.predicted_label, r.ground_truth_label)
        if out == "FN":
            fn_rows.append(r)
        elif out == "FP":
            fp_rows.append(r)
        elif out == "TP":
            tp_rows.append(r)
        else:
            tn_rows.append(r)

    compare_scen_map: Dict[str, Dict[str, Any]] = {}
    if compare_exp:
        compare_scen_map = {s["scenario_type"]: s for s in (compare_exp.scenario_metrics_json or [])}

    # 1. Weakness Explorer
    weakness_explorer: List[Dict[str, Any]] = []
    for sm in experiment.scenario_metrics_json or []:
        scen = sm["scenario_type"]
        s_rows = by_scenario_rows.get(scen, [])
        s_fns = [r for r in s_rows if r.ground_truth_label == 1 and r.predicted_label == 0]
        s_fps = [r for r in s_rows if r.ground_truth_label == 0 and r.predicted_label == 1]

        tp_c = int(sm["true_positives"])
        fp_c = int(sm["false_positives"])
        fn_c = int(sm["false_negatives"])
        precision_defined = (tp_c + fp_c) > 0

        causes: List[str] = []
        if is_black_box:
            if s_fns:
                causes.append(
                    f"Black-Box hypothesis: {len(s_fns)} risky events in '{scen}' were allowed (avg score unknown or below decision boundary); verify coverage for this pattern."
                )
            if s_fps:
                causes.append(
                    f"Black-Box hypothesis: {len(s_fps)} legitimate operations in '{scen}' were flagged; review boundary conditions for false-positive triggers."
                )
        else:
            if s_fns:
                zero_fns = sum(1 for r in s_fns if r.risk_score == 0)
                near_fns = sum(1 for r in s_fns if r.risk_score >= decision_threshold - 15.0)
                partial_fns = len(s_fns) - zero_fns - near_fns
                if near_fns > 0:
                    causes.append(
                        f"{near_fns} near-threshold misses (scored {decision_threshold - 15:.0f}–{decision_threshold - 0.1:.1f} vs threshold {decision_threshold:.0f})"
                    )
                if partial_fns > 0:
                    causes.append(
                        f"{partial_fns} single-rule triggers scored below decision threshold ({decision_threshold:.0f})"
                    )
                if zero_fns > 0:
                    causes.append(
                        f"{zero_fns} stealth events did not exceed active rule thresholds/windows"
                    )
            if s_fps:
                fp_rules = Counter(
                    tr["rule"] for r in s_fps for tr in (r.triggered_rules_json or [])
                )
                top_r = ", ".join(f"{k} ({v})" for k, v in fp_rules.most_common(2))
                causes.append(f"{len(s_fps)} legitimate operations over-triggered [{top_r}]")
        if not causes:
            causes.append("No classification errors observed in this scenario.")

        version_delta = None
        if scen in compare_scen_map:
            prev_s = compare_scen_map[scen]
            version_delta = {
                "recall_delta": round(float(sm["recall"]) - float(prev_s.get("recall", 0.0)), 4),
                "precision_delta": round(float(sm["precision"]) - float(prev_s.get("precision", 0.0)), 4),
                "f1_delta": round(float(sm["f1_score"]) - float(prev_s.get("f1_score", 0.0)), 4),
                "fpr_delta": round(
                    float(sm["false_positive_rate"]) - float(prev_s.get("false_positive_rate", 0.0)),
                    4,
                ),
                "fn_delta": fn_c - int(prev_s.get("false_negatives", 0)),
                "fp_delta": fp_c - int(prev_s.get("false_positives", 0)),
            }

        weakness_explorer.append(
            {
                "scenario_type": scen,
                "total_transactions": int(sm["total_transactions"]),
                "actual_risk_events": int(sm["actual_risk_events"]),
                "detected_risks": tp_c,
                "missed_risks": fn_c,
                "false_positives": fp_c,
                "recall": float(sm["recall"]),
                "precision": float(sm["precision"]) if precision_defined else None,
                "precision_defined": precision_defined,
                "f1_score": float(sm["f1_score"]),
                "false_positive_rate": float(sm["false_positive_rate"]),
                "avg_risk_score": float(sm["avg_risk_score"]),
                "typical_error_causes": causes,
                "version_delta": version_delta,
            }
        )

    # 2. False Positive Analysis
    fp_rule_counter: Counter[str] = Counter()
    fp_rule_contrib: Dict[str, List[float]] = defaultdict(list)
    fp_combo_counter: Counter[str] = Counter()
    fp_by_scenario: Counter[str] = Counter()

    for r in fp_rows:
        fp_by_scenario[r.scenario_type] += 1
        rules = sorted(tr["rule"] for tr in (r.triggered_rules_json or []))
        if rules:
            fp_combo_counter[" + ".join(rules)] += 1
        for tr in r.triggered_rules_json or []:
            fp_rule_counter[tr["rule"]] += 1
            fp_rule_contrib[tr["rule"]].append(float(tr.get("contribution", 0.0)))

    changed_rules_set = {ch["rule"] for ch in (defense.changed_params_json if defense else [])}
    fp_config_links: List[str] = []
    for r_name, cnt in fp_rule_counter.most_common():
        if r_name in changed_rules_set:
            fp_config_links.append(
                f"Rule '{r_name}' was modified in {defense.version if defense else 'current version'} and participated in {cnt} false blocks."
            )

    false_positive_analysis = {
        "total_false_positives": len(fp_rows),
        "false_positive_rate": float(experiment.metrics_json.get("false_positive_rate", 0.0)),
        "avg_fp_risk_score": round(
            sum(r.risk_score for r in fp_rows) / len(fp_rows), 2
        )
        if fp_rows
        else 0.0,
        "participating_rules": [
            {
                "rule": r_name,
                "fp_count": cnt,
                "share_of_fps": round(cnt / len(fp_rows), 4) if fp_rows else 0.0,
                "avg_contribution": round(
                    sum(fp_rule_contrib[r_name]) / len(fp_rule_contrib[r_name]), 2
                ),
                "modified_in_current_version": r_name in changed_rules_set,
            }
            for r_name, cnt in fp_rule_counter.most_common()
        ],
        "rule_combinations": [
            {"combination": combo, "count": cnt}
            for combo, cnt in fp_combo_counter.most_common(6)
        ],
        "by_scenario": dict(fp_by_scenario),
        "configuration_correlation": fp_config_links
        or ["No direct false-positive surge linked to recent parameter changes."],
    }

    # 3. False Negative Analysis
    near_miss_fns = [r for r in fn_rows if r.risk_score >= decision_threshold - 15.0]
    partial_fns = [r for r in fn_rows if 0.0 < r.risk_score < decision_threshold - 15.0]
    zero_fns = [r for r in fn_rows if r.risk_score == 0.0]

    hardest_scenarios = sorted(
        [w for w in weakness_explorer if w["actual_risk_events"] > 0],
        key=lambda x: (x["recall"], -x["missed_risks"]),
    )

    false_negative_analysis = {
        "total_false_negatives": len(fn_rows),
        "false_negative_rate": float(experiment.metrics_json.get("false_negative_rate", 0.0)),
        "avg_fn_risk_score": round(
            sum(r.risk_score for r in fn_rows) / len(fn_rows), 2
        )
        if fn_rows
        else 0.0,
        "miss_categories": {
            "near_threshold_misses": {
                "count": len(near_miss_fns),
                "description": f"Scored within 15 points below threshold ({decision_threshold - 15:.0f}–{decision_threshold - 0.1:.1f}); rules fired partially but total weight was insufficient.",
            },
            "partial_single_rule_misses": {
                "count": len(partial_fns),
                "description": f"Scored 1–{max(1.0, decision_threshold - 15.1):.0f}; only one weak signal triggered without corroborating context.",
            },
            "untriggered_blind_spots": {
                "count": len(zero_fns),
                "description": "Scored 0.0; event fell outside active multiplier thresholds or lookback windows.",
            },
        },
        "hardest_scenarios": [
            {
                "scenario_type": hs["scenario_type"],
                "actual_risk_events": hs["actual_risk_events"],
                "missed_risks": hs["missed_risks"],
                "recall": hs["recall"],
                "typical_error_causes": hs["typical_error_causes"],
            }
            for hs in hardest_scenarios
        ],
    }

    # 4. Transaction Inspector helper serialization
    def serialize_inspector_item(r: ExperimentResult) -> Dict[str, Any]:
        meta = tx_meta_by_id.get(r.transaction_id, {})
        outcome = _classify_outcome(r.predicted_label, r.ground_truth_label)
        gap = round(r.risk_score - decision_threshold, 2)
        if outcome == "TP":
            note = f"Correctly flagged (+{gap:.1f} pts above threshold {decision_threshold:.0f})."
        elif outcome == "FP":
            note = f"False block (+{gap:.1f} pts above threshold {decision_threshold:.0f}); legitimate operation exceeded rule weights."
        elif outcome == "FN":
            note = f"Missed threat ({abs(gap):.1f} pts below threshold {decision_threshold:.0f})."
        else:
            note = f"Correctly allowed ({abs(gap):.1f} pts below threshold {decision_threshold:.0f})."

        return {
            "id": r.id,
            "transaction_id": r.transaction_id,
            "transaction_code": r.transaction_code,
            "customer_code": r.customer_code,
            "recipient_code": r.recipient_code,
            "amount_kzt": r.amount_kzt,
            "timestamp": r.timestamp.isoformat(),
            "transaction_type": meta.get("transaction_type", "p2p_transfer"),
            "channel": meta.get("channel", "mobile_app"),
            "is_new_recipient": meta.get("is_new_recipient", False),
            "customer_segment": meta.get("customer_segment", "retail_standard"),
            "transaction_frequency": meta.get("transaction_frequency", 1.0),
            "scenario_type": r.scenario_type,
            "split_name": r.split_name,
            "risk_score": r.risk_score,
            "risk_level": r.risk_level,
            "decision_threshold": decision_threshold,
            "gap_to_threshold": gap,
            "triggered_rules": r.triggered_rules_json,
            "decision_trace": resolve_decision_trace(
                res=r,
                decision_threshold=decision_threshold,
                is_internal=is_internal,
                has_risk_scores=is_internal or bool((experiment.completeness_json or {}).get("has_risk_scores", True)),
            ),
            "explanation": r.explanation,
            "ground_truth_label": r.ground_truth_label,
            "predicted_label": r.predicted_label,
            "outcome": outcome,
            "diagnostic_note": note,
        }

    # Curated Transaction Inspector samples across FN, FP, TP, and high-scoring TN
    inspector_samples = (
        [serialize_inspector_item(r) for r in fn_rows[:12]]
        + [serialize_inspector_item(r) for r in fp_rows[:12]]
        + [serialize_inspector_item(r) for r in tp_rows[:12]]
        + [serialize_inspector_item(r) for r in tn_rows[:8]]
    )

    # 5. Deterministic AI Analyst output
    analyst_out = analyze_experiment_deterministic(
        metrics=experiment.metrics_json,
        scenario_metrics=experiment.scenario_metrics_json,
        rule_impact=experiment.rule_impact_json,
        results=[
            {
                "transaction_code": r.transaction_code,
                "scenario_type": r.scenario_type,
                "risk_score": r.risk_score,
                "predicted_label": r.predicted_label,
                "ground_truth_label": r.ground_truth_label,
                "triggered_rules_json": r.triggered_rules_json,
            }
            for r in result_rows
        ],
        rules_config=defense.rules_config_json if defense else {},
        decision_threshold=decision_threshold,
    )

    # 6. Reliability Report
    evo_run = (
        db.query(EvolutionRun)
        .filter(
            (EvolutionRun.baseline_experiment_id == experiment.id)
            | (EvolutionRun.final_candidate_experiment_id == experiment.id)
        )
        .order_by(EvolutionRun.id.desc())
        .first()
    )

    m = experiment.metrics_json
    weak_scen_names = [
        w["scenario_type"] for w in weakness_explorer if w["actual_risk_events"] > 0 and w["recall"] < 0.70
    ]

    verified_improvements: List[str] = []
    emerged_tradeoffs: List[str] = []
    if compare_exp:
        cm = compare_exp.metrics_json
        rec_d = float(m.get("recall", 0.0)) - float(cm.get("recall", 0.0))
        f1_d = float(m.get("f1_score", 0.0)) - float(cm.get("f1_score", 0.0))
        fpr_d = float(m.get("false_positive_rate", 0.0)) - float(cm.get("false_positive_rate", 0.0))
        if rec_d > 0.01:
            verified_improvements.append(
                f"Recall increased by {rec_d:+.1%} (F1 {f1_d:+.1%}) compared to {compare_exp.name}."
            )
        if fpr_d > 0.001:
            emerged_tradeoffs.append(
                f"False Positive Rate shifted by {fpr_d:+.2%} ({int(m.get('false_positives', 0)) - int(cm.get('false_positives', 0)):+d} FP)."
            )
    elif evo_run and evo_run.status == "completed":
        ed = (evo_run.comparison_json or {}).get("evaluation_split", {}).get("delta", {})
        if ed:
            verified_improvements.append(
                f"Held-out evaluation split showed Recall {float(ed.get('recall', 0.0)):+.1%}, F1 {float(ed.get('f1_score', 0.0)):+.1%} (Verdict: {evo_run.verdict})."
            )
            if float(ed.get("false_positive_rate", 0.0)) > 0:
                emerged_tradeoffs.append(
                    f"Held-out FPR changed by {float(ed.get('false_positive_rate', 0.0)):+.2%} ({int(ed.get('false_positives', 0)):+d} false blocks)."
                )

    completeness = experiment.completeness_json or {}
    has_risk_scores = True if is_internal else bool(completeness.get("has_risk_scores", True))
    engine_row = (
        db.query(AntifraudEngine).filter(AntifraudEngine.id == experiment.engine_id).first()
        if experiment.engine_id is not None
        else None
    )
    supports_config = (
        True
        if is_internal
        else bool(engine_row.supports_config if engine_row else False)
    )

    # 7. Real Risk Score Distribution (10-point buckets 0-100; omitted if external engine returned no scores)
    score_buckets: List[Dict[str, Any]] = []
    if has_risk_scores and result_rows:
        bucket_defs = [(i * 10, (i + 1) * 10) for i in range(10)]
        counts = [
            {
                "range": f"{lo}–{hi}",
                "min_score": lo,
                "max_score": hi,
                "legitimate": 0,
                "risky": 0,
                "detected": 0,
                "missed": 0,
            }
            for lo, hi in bucket_defs
        ]
        for r in result_rows:
            s = max(0.0, min(100.0, float(r.risk_score)))
            idx = 9 if s >= 100.0 else min(9, int(s // 10))
            b = counts[idx]
            if r.ground_truth_label == 1:
                b["risky"] += 1
                if r.predicted_label == 1:
                    b["detected"] += 1
                else:
                    b["missed"] += 1
            else:
                b["legitimate"] += 1
        score_buckets = counts

    risk_score_distribution = {
        "available": bool(has_risk_scores and result_rows),
        "buckets": score_buckets,
    }

    engine_label = (
        experiment.engine_version_label
        or (defense.version if defense else experiment.engine_name)
    )
    experiment_metadata = {
        "experiment_id": experiment.id,
        "experiment_name": experiment.name,
        "engine_name": experiment.engine_name,
        "defense_version": engine_label,
        "adapter_type": experiment.adapter_type,
        "diagnostic_mode": experiment.diagnostic_mode,
        "supports_config": supports_config,
        "dataset_id": experiment.dataset_id,
        "dataset_name": dataset.name if dataset else None,
        "seed": dataset.seed if dataset else None,
        "dataset_transaction_count": dataset.transaction_count if dataset else None,
        "customer_count": dataset.customer_count if dataset else None,
        "risk_ratio": dataset.risk_ratio if dataset else None,
        "split_name": experiment.split_name,
        "scenarios": experiment.scenarios_json,
        "created_at": experiment.created_at.isoformat(),
        "processing_time_ms": experiment.processing_time_ms,
        "completeness": completeness,
    }
    reliability_report = {
        "what_was_tested": (
            f"Evaluated {experiment.engine_name} ({engine_label}, mode={experiment.diagnostic_mode}) "
            f"on dataset '{dataset.name if dataset else experiment.dataset_id}' (split='{experiment.split_name}', "
            f"{m.get('total_transactions', 0)} evaluated transactions, {m.get('actual_risk_events', 0)} risk events, seed={dataset.seed if dataset else 'N/A'})."
        ),
        "covered_scenarios": experiment.scenarios_json,
        "confirmed_weaknesses": [
            f"{w['scenario_type']}: missed {w['missed_risks']}/{w['actual_risk_events']} threats (Recall={w['recall']:.1%})"
            for w in weakness_explorer
            if w["actual_risk_events"] > 0 and w["missed_risks"] > 0
        ]
        or ["All tested risk events were detected on this slice."],
        "verified_improvements": verified_improvements
        or ["Run Defense Evolution or select a comparison experiment to verify version-over-version improvements."],
        "emerged_tradeoffs": emerged_tradeoffs
        or [
            f"Current configuration produced {m.get('false_positives', 0)} false blocks (FPR={float(m.get('false_positive_rate', 0.0)):.2%})."
        ],
        "residual_risks": [
            f"Residual false negative rate is {float(m.get('false_negative_rate', 0.0)):.1%} ({m.get('false_negatives', 0)} undetected risk events)."
        ]
        + (
            [f"Scenarios requiring further rule or feature coverage: {', '.join(weak_scen_names)}."]
            if weak_scen_names
            else []
        ),
        "experiment_limitations": [
            "Results are measured strictly on synthetic Virtual Bank Simulator transactions and do not represent production banking traffic.",
            "Rule thresholds calibrated on single-seed slices must be verified across independent seeds in Benchmark Lab.",
            "Ground truth labels are used exclusively for post-test evaluation and never exposed to the Defense Engine.",
        ],
    }

    return {
        "experiment_id": experiment.id,
        "experiment_name": experiment.name,
        "defense_version": experiment.engine_version_label or (defense.version if defense else None),
        "engine_name": experiment.engine_name,
        "adapter_type": experiment.adapter_type,
        "diagnostic_mode": experiment.diagnostic_mode,
        "completeness": completeness,
        "decision_threshold": decision_threshold,
        "compare_experiment_id": compare_exp.id if compare_exp else None,
        "weakness_explorer": weakness_explorer,
        "false_positive_analysis": false_positive_analysis,
        "false_negative_analysis": false_negative_analysis,
        "transaction_inspector_samples": inspector_samples,
        "risk_score_distribution": risk_score_distribution,
        "experiment_metadata": experiment_metadata,
        "analyst": analyst_out,
        "reliability_report": reliability_report,
    }
