"""Dashboard overview endpoint aggregating real stored experiment, evolution, and benchmark statistics."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import BenchmarkRun, Dataset, DefenseConfiguration, EvolutionRun, Experiment, ExperimentResult
from ..schemas import ExperimentSummary, OverviewResponse

router = APIRouter(prefix="/api", tags=["overview"])


def _ensure_business_metrics(exp: Experiment, db: Session) -> dict:
    """Backfill financial business metrics for legacy experiments lacking them in metrics_json."""
    metrics = dict(exp.metrics_json or {})
    if (
        "missed_fraud_amount" in metrics
        and "prevented_fraud_amount" in metrics
        and "false_decline_amount" in metrics
    ):
        return metrics

    rows = (
        db.query(
            ExperimentResult.amount_kzt,
            ExperimentResult.predicted_label,
            ExperimentResult.ground_truth_label,
            ExperimentResult.risk_level,
            ExperimentResult.risk_score,
        )
        .filter(ExperimentResult.experiment_id == exp.id)
        .all()
    )
    if not rows:
        return metrics

    prevented = sum(float(r.amount_kzt or 0.0) for r in rows if r.ground_truth_label == 1 and r.predicted_label == 1)
    missed = sum(float(r.amount_kzt or 0.0) for r in rows if r.ground_truth_label == 1 and r.predicted_label == 0)
    false_decline = sum(float(r.amount_kzt or 0.0) for r in rows if r.ground_truth_label == 0 and r.predicted_label == 1)
    review_cnt = sum(
        1
        for r in rows
        if r.predicted_label == 0
        and (r.risk_level == "medium" or (r.risk_score is not None and float(r.risk_score) >= 40.0))
    )
    total_cnt = len(rows)

    metrics["prevented_fraud_amount"] = round(prevented, 2)
    metrics["missed_fraud_amount"] = round(missed, 2)
    metrics["false_decline_amount"] = round(false_decline, 2)
    metrics.setdefault("review_queue_count", review_cnt)
    metrics.setdefault("review_queue_rate", round(review_cnt / total_cnt, 4) if total_cnt > 0 else 0.0)

    exp.metrics_json = metrics
    db.add(exp)
    try:
        db.commit()
    except Exception:
        db.rollback()
    return metrics


def _serialize_experiment_summary(exp: Experiment, db: Session) -> ExperimentSummary:
    dataset = db.query(Dataset).filter(Dataset.id == exp.dataset_id).first()
    is_internal = exp.adapter_type == "internal"
    defense = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == exp.defense_config_id)
        .first()
        if is_internal
        else None
    )
    metrics_data = _ensure_business_metrics(exp, db)
    return ExperimentSummary(
        id=exp.id,
        name=exp.name,
        dataset_id=exp.dataset_id,
        defense_config_id=exp.defense_config_id,
        defense_version=(
            (defense.version if defense else None)
            if is_internal
            else (exp.engine_version_label or exp.adapter_type)
        ),
        defense_name=(
            (defense.name if defense else None)
            if is_internal
            else exp.engine_name
        ),
        dataset_name=dataset.name if dataset else None,
        split_name=exp.split_name,
        scenarios_json=exp.scenarios_json,
        status=exp.status,
        processing_time_ms=exp.processing_time_ms,
        engine_id=exp.engine_id,
        engine_name=exp.engine_name,
        adapter_type=exp.adapter_type,
        diagnostic_mode=exp.diagnostic_mode,
        engine_version_label=exp.engine_version_label or (defense.version if defense else ""),
        completeness_json=exp.completeness_json or {},
        external_config_json=exp.external_config_json or {},
        metrics_json=metrics_data,
        confusion_matrix_json=exp.confusion_matrix_json,
        scenario_metrics_json=exp.scenario_metrics_json,
        rule_impact_json=exp.rule_impact_json,
        summary_text=exp.summary_text,
        created_at=exp.created_at,
    )


@router.get("/overview", response_model=OverviewResponse)
def get_overview(db: Session = Depends(get_db)):
    settings = get_settings()
    experiments = db.query(Experiment).order_by(Experiment.created_at.desc(), Experiment.id.desc()).all()
    total_datasets = db.query(Dataset).count()
    total_configs = db.query(DefenseConfiguration).count()
    evolutions = db.query(EvolutionRun).all()
    total_benchmarks = db.query(BenchmarkRun).count()

    confirmed_improvements = sum(1 for ev in evolutions if ev.verdict == "improved")
    latest_cfg = (
        db.query(DefenseConfiguration)
        .order_by(DefenseConfiguration.created_at.desc(), DefenseConfiguration.id.desc())
        .first()
    )

    primary_experiments = [e for e in experiments if not e.name.startswith("[Evo-")]
    display_experiments = primary_experiments if primary_experiments else experiments

    last_exp = _serialize_experiment_summary(display_experiments[0], db) if display_experiments else None

    total_tx_tested = sum(int(e.metrics_json.get("total_transactions", 0)) for e in primary_experiments)
    total_detected = sum(int(e.metrics_json.get("true_positives", 0)) for e in primary_experiments)
    total_missed = sum(int(e.metrics_json.get("false_negatives", 0)) for e in primary_experiments)
    total_fp = sum(int(e.metrics_json.get("false_positives", 0)) for e in primary_experiments)

    current_metrics = last_exp.metrics_json if last_exp else {}
    weakest_scenarios = []
    if last_exp:
        weakest_scenarios = sorted(
            [s for s in (last_exp.scenario_metrics_json or []) if int(s.get("actual_risk_events", 0)) > 0],
            key=lambda s: float(s.get("recall", 0.0)),
        )

    recent = [_serialize_experiment_summary(e, db) for e in display_experiments[:10]]

    return OverviewResponse(
        total_experiments=len(primary_experiments),
        total_datasets=total_datasets,
        total_defense_configs=total_configs,
        total_evolutions=len(evolutions),
        total_benchmarks=total_benchmarks,
        confirmed_improvements_count=confirmed_improvements,
        active_defense_version= (last_exp.defense_version if last_exp else (latest_cfg.version if latest_cfg else "Defense v1.0")),
        last_experiment=last_exp,
        total_transactions_tested=total_tx_tested,
        total_risk_detected=total_detected,
        total_risk_missed=total_missed,
        total_false_positives=total_fp,
        current_metrics=current_metrics,
        weakest_scenarios=weakest_scenarios,
        recent_experiments=recent,
        llm_enabled=settings.llm_configured,
    )
