"""Shared Experiment Runner service executing Defense Engine and Evaluation Engine and persisting results."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy.orm import Session

from ..models import (
    Dataset,
    DefenseConfiguration,
    Experiment,
    ExperimentResult,
    Recommendation,
    SyntheticTransaction,
    VirtualCustomer,
)
from .ai_analyst import analyze_experiment_deterministic
from .defense_engine import DefenseEngine
from .evaluation_engine import evaluate_predictions


def run_experiment_pipeline(
    db: Session,
    dataset: Dataset,
    defense_config: DefenseConfiguration,
    name: str,
    split_name: str = "all",
    scenarios: Optional[Sequence[str]] = None,
) -> Experiment:
    """
    Load transactions (strictly stripping ground truth before passing to Defense Engine),
    evaluate predictions, compute metrics, run AI Security Analyst diagnostics, and persist.
    """
    tx_query = db.query(SyntheticTransaction).filter(SyntheticTransaction.dataset_id == dataset.id)
    if split_name != "all":
        tx_query = tx_query.filter(SyntheticTransaction.split_name == split_name)
    if scenarios:
        tx_query = tx_query.filter(SyntheticTransaction.scenario_type.in_(list(scenarios)))

    tx_rows = tx_query.order_by(SyntheticTransaction.timestamp.asc(), SyntheticTransaction.id.asc()).all()
    cust_rows = db.query(VirtualCustomer).filter(VirtualCustomer.dataset_id == dataset.id).all()

    customers_by_code: Dict[str, Dict[str, Any]] = {
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

    # Sanitized transactions: ground_truth_label and scenario_type are intentionally omitted!
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
                "device_changed": bool(meta.get("device_changed", False)),
                "geo_changed": bool(meta.get("geo_changed", False)),
                "minutes_since_device_change": meta.get("minutes_since_device_change"),
            }
        )
        ground_truth_by_tx_id[row.id] = {
            "ground_truth_label": row.ground_truth_label,
            "scenario_type": row.scenario_type,
        }

    engine = DefenseEngine(
        rules_config=defense_config.rules_config_json,
        decision_threshold=defense_config.decision_threshold,
        risk_levels=defense_config.risk_levels_json,
    )

    t0 = time.perf_counter()
    predictions = engine.evaluate_transactions(sanitized_txs, customers_by_code)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    eval_out = evaluate_predictions(
        predictions=predictions,
        ground_truth_by_tx_id=ground_truth_by_tx_id,
        processing_time_ms=elapsed_ms,
    )

    analyst_out = analyze_experiment_deterministic(
        metrics=eval_out["metrics"],
        scenario_metrics=eval_out["scenario_metrics"],
        rule_impact=eval_out["rule_impact"],
        results=eval_out["joined_results"],
        rules_config=defense_config.rules_config_json,
        decision_threshold=defense_config.decision_threshold,
    )

    active_scenarios = list(scenarios) if scenarios else list(dataset.scenarios_json)
    experiment = Experiment(
        name=name,
        dataset_id=dataset.id,
        defense_config_id=defense_config.id,
        split_name=split_name,
        scenarios_json=active_scenarios,
        status="completed",
        processing_time_ms=round(elapsed_ms, 2),
        metrics_json=eval_out["metrics"],
        confusion_matrix_json=eval_out["confusion_matrix"],
        scenario_metrics_json=eval_out["scenario_metrics"],
        rule_impact_json=eval_out["rule_impact"],
        summary_text=analyst_out["summary"],
    )
    db.add(experiment)
    db.flush()

    result_objects = [
        ExperimentResult(
            experiment_id=experiment.id,
            transaction_id=item["transaction_id"],
            transaction_code=item["transaction_code"],
            customer_code=item["customer_code"],
            recipient_code=item["recipient_code"],
            amount_kzt=item["amount_kzt"],
            timestamp=item["timestamp"],
            scenario_type=item["scenario_type"],
            split_name=item["split_name"],
            risk_score=item["risk_score"],
            risk_level=item["risk_level"],
            predicted_label=item["predicted_label"],
            ground_truth_label=item["ground_truth_label"],
            triggered_rules_json=item["triggered_rules"],
            decision_trace_json=item.get("decision_trace") or {},
            explanation=item["explanation"],
        )
        for item in eval_out["joined_results"]
    ]
    if result_objects:
        db.bulk_save_objects(result_objects)

    for rec in analyst_out["recommendations"]:
        db.add(
            Recommendation(
                experiment_id=experiment.id,
                target_rule=rec["target_rule"],
                issue_category=rec["issue_category"],
                severity=rec["severity"],
                title=rec["title"],
                explanation=rec["explanation"],
                proposed_changes_json=rec["proposed_changes_json"],
                expected_impact=rec["expected_impact"],
            )
        )

    db.commit()
    db.refresh(experiment)
    return experiment
