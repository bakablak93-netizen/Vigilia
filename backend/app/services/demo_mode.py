"""Competition Demo Mode service: one-click reproducible seed=42 walkthrough and non-destructive reset."""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict

from sqlalchemy.orm import Session

from ..models import (
    BenchmarkRun,
    Dataset,
    DefenseConfiguration,
    EvolutionRun,
    Experiment,
    SyntheticTransaction,
    VirtualCustomer,
)
from .defense_engine import get_default_config_payload
from .defense_evolution import analyze_for_evolution, validate_and_evaluate_evolution
from .experiment_runner import run_experiment_pipeline
from .simulator import SCENARIO_CATALOG, generate_synthetic_dataset

DEMO_PREFIX = "[Demo]"


def launch_competition_demo(db: Session, seed: int = 42) -> Dict[str, Any]:
    """
    Execute the full reproducible 3-minute jury demonstration pipeline on real synthetic data:
    1. Generate 1,000 synthetic transactions (seed=42, 100 customers, 5% risk).
    2. Evaluate Baseline Defense v1.0.
    3. Run Defense Evolution 2.0 (weakness diagnosis, Candidates A/B/C/D generation, single-rule ablation).
    4. Validate and evaluate chosen candidate on held-out evaluation split.
    """
    # Ensure baseline config exists
    baseline_cfg = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.is_baseline.is_(True))
        .order_by(DefenseConfiguration.id.asc())
        .first()
    )
    if not baseline_cfg:
        baseline_cfg = DefenseConfiguration(**get_default_config_payload())
        db.add(baseline_cfg)
        db.commit()
        db.refresh(baseline_cfg)

    scenarios = [s["key"] for s in SCENARIO_CATALOG]
    customers, transactions = generate_synthetic_dataset(
        transaction_count=1000,
        customer_count=100,
        risk_ratio=0.05,
        scenarios=scenarios,
        seed=seed,
    )

    split_counts = dict(Counter(t.split_name for t in transactions))
    actual_risk_count = sum(t.ground_truth_label for t in transactions)

    dataset = Dataset(
        name=f"{DEMO_PREFIX} BCC Jury Synthetic Bank (1,000 tx · seed={seed})",
        description="Synthetic competition demonstration dataset generated with fixed seed for reproducible verification.",
        seed=seed,
        transaction_count=len(transactions),
        customer_count=len(customers),
        risk_ratio=0.05,
        actual_risk_count=actual_risk_count,
        scenarios_json=scenarios,
        split_counts_json=split_counts,
    )
    db.add(dataset)
    db.flush()

    db.bulk_save_objects(
        [
            VirtualCustomer(
                dataset_id=dataset.id,
                customer_code=c.customer_code,
                customer_type=c.customer_type,
                activity_category=c.activity_category,
                customer_segment=c.customer_segment,
                account_age_days=c.account_age_days,
                typical_amount_min_kzt=c.typical_amount_min_kzt,
                typical_amount_max_kzt=c.typical_amount_max_kzt,
                avg_amount_kzt=c.avg_amount_kzt,
                std_amount_kzt=c.std_amount_kzt,
                avg_tx_frequency_per_day=c.avg_tx_frequency_per_day,
                known_recipients_json=c.known_recipients_json,
            )
            for c in customers
        ]
    )
    db.bulk_save_objects(
        [
            SyntheticTransaction(
                dataset_id=dataset.id,
                transaction_code=t.transaction_code,
                customer_code=t.customer_code,
                recipient_code=t.recipient_code,
                amount_kzt=t.amount_kzt,
                timestamp=t.timestamp,
                transaction_type=t.transaction_type,
                channel=t.channel,
                is_new_recipient=t.is_new_recipient,
                customer_segment=t.customer_segment,
                transaction_frequency=t.transaction_frequency,
                scenario_type=t.scenario_type,
                split_name=t.split_name,
                ground_truth_label=t.ground_truth_label,
                metadata_json=t.metadata_json,
            )
            for t in transactions
        ]
    )
    db.commit()
    db.refresh(dataset)

    baseline_exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=baseline_cfg,
        name=f"{DEMO_PREFIX} Baseline Stress Test ({baseline_cfg.version})",
        split_name="all",
        scenarios=scenarios,
    )

    evo_analyzed = analyze_for_evolution(db=db, baseline_experiment=baseline_exp)
    evo_completed = validate_and_evaluate_evolution(
        db=db,
        evo_run=evo_analyzed,
        candidate_name=f"{DEMO_PREFIX} Evolved Defense",
    )

    full_cand_exp_id = (evo_completed.comparison_json or {}).get("full_candidate_experiment_id")

    return {
        "status": "completed",
        "synthetic_disclaimer": "All demo profiles and transactions are 100% synthetic and computed live.",
        "dataset_id": dataset.id,
        "baseline_experiment_id": baseline_exp.id,
        "candidate_experiment_id": full_cand_exp_id or evo_completed.final_candidate_experiment_id,
        "evolution_run_id": evo_completed.id,
        "candidate_config_id": evo_completed.candidate_config_id,
        "verdict": evo_completed.verdict,
        "tradeoff_assessment": evo_completed.tradeoff_assessment,
        "baseline_metrics": baseline_exp.metrics_json,
        "evaluation_comparison": (evo_completed.comparison_json or {}).get("evaluation_split"),
    }


def reset_competition_demo(db: Session) -> Dict[str, Any]:
    """
    Remove ONLY demo-tagged datasets, experiments, evolution runs, and defense configurations,
    leaving all user-created data intact.
    """
    demo_datasets = db.query(Dataset).filter(Dataset.name.like(f"{DEMO_PREFIX}%")).all()
    demo_ds_ids = [d.id for d in demo_datasets]

    removed_evolutions = 0
    if demo_ds_ids:
        demo_exp_ids = [
            e.id
            for e in db.query(Experiment).filter(Experiment.dataset_id.in_(demo_ds_ids)).all()
        ]
        if demo_exp_ids:
            removed_evolutions = (
                db.query(EvolutionRun)
                .filter(EvolutionRun.baseline_experiment_id.in_(demo_exp_ids))
                .delete(synchronize_session=False)
            )

    removed_datasets = 0
    for ds in demo_datasets:
        db.delete(ds)
        removed_datasets += 1

    removed_configs = (
        db.query(DefenseConfiguration)
        .filter(
            DefenseConfiguration.name.like(f"{DEMO_PREFIX}%"),
            DefenseConfiguration.is_baseline.is_(False),
        )
        .delete(synchronize_session=False)
    )

    removed_benchmarks = (
        db.query(BenchmarkRun)
        .filter(BenchmarkRun.name.like(f"{DEMO_PREFIX}%"))
        .delete(synchronize_session=False)
    )

    db.commit()
    return {
        "status": "reset_completed",
        "removed_demo_datasets": removed_datasets,
        "removed_demo_evolutions": removed_evolutions,
        "removed_demo_configs": removed_configs,
        "removed_demo_benchmarks": removed_benchmarks,
    }
