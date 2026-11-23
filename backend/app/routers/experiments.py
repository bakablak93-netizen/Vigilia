"""Stress-testing experiment execution and inspection endpoints."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Dataset, DefenseConfiguration, Experiment, ExperimentResult, Recommendation
from ..schemas import (
    ExperimentCreateRequest,
    ExperimentDetailResponse,
    ExperimentResultView,
    ExperimentSummary,
    RecommendationView,
)
from ..services.ai_analyst import analyze_experiment_deterministic
from ..services.experiment_runner import run_experiment_pipeline
from .overview import _serialize_experiment_summary

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


@router.post("", response_model=ExperimentSummary, status_code=status.HTTP_201_CREATED)
def run_experiment(payload: ExperimentCreateRequest, db: Session = Depends(get_db)):
    dataset = db.query(Dataset).filter(Dataset.id == payload.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")

    defense_config = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == payload.defense_config_id)
        .first()
    )
    if not defense_config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Defense configuration not found",
        )

    exp = run_experiment_pipeline(
        db=db,
        dataset=dataset,
        defense_config=defense_config,
        name=payload.name,
        split_name=payload.split_name,
        scenarios=payload.scenarios,
    )
    return _serialize_experiment_summary(exp, db)


@router.get("", response_model=List[ExperimentSummary])
def list_experiments(
    include_internal: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    rows = db.query(Experiment).order_by(Experiment.created_at.desc(), Experiment.id.desc()).all()
    if not include_internal:
        rows = [
            r
            for r in rows
            if not r.name.startswith("[Evo-") and not r.name.startswith("[Compare]")
        ]
    return [_serialize_experiment_summary(r, db) for r in rows]


@router.get("/{experiment_id}", response_model=ExperimentDetailResponse)
def get_experiment_detail(
    experiment_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    risk_level: Optional[str] = Query(default=None),
    predicted_label: Optional[int] = Query(default=None, ge=0, le=1),
    scenario_type: Optional[str] = Query(default=None),
    outcome: Optional[str] = Query(default=None),  # tp | fp | tn | fn
    db: Session = Depends(get_db),
):
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")

    defense_config = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == exp.defense_config_id)
        .first()
    )

    query = db.query(ExperimentResult).filter(ExperimentResult.experiment_id == experiment_id)
    if risk_level:
        query = query.filter(ExperimentResult.risk_level == risk_level)
    if predicted_label is not None:
        query = query.filter(ExperimentResult.predicted_label == predicted_label)
    if scenario_type:
        query = query.filter(ExperimentResult.scenario_type == scenario_type)
    if outcome == "tp":
        query = query.filter(ExperimentResult.predicted_label == 1, ExperimentResult.ground_truth_label == 1)
    elif outcome == "fp":
        query = query.filter(ExperimentResult.predicted_label == 1, ExperimentResult.ground_truth_label == 0)
    elif outcome == "tn":
        query = query.filter(ExperimentResult.predicted_label == 0, ExperimentResult.ground_truth_label == 0)
    elif outcome == "fn":
        query = query.filter(ExperimentResult.predicted_label == 0, ExperimentResult.ground_truth_label == 1)

    total = query.count()
    rows = (
        query.order_by(ExperimentResult.risk_score.desc(), ExperimentResult.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    all_results_rows = (
        db.query(ExperimentResult).filter(ExperimentResult.experiment_id == experiment_id).all()
    )
    recs = db.query(Recommendation).filter(Recommendation.experiment_id == experiment_id).all()

    analysis = analyze_experiment_deterministic(
        metrics=exp.metrics_json,
        scenario_metrics=exp.scenario_metrics_json,
        rule_impact=exp.rule_impact_json,
        results=[
            {
                "transaction_code": r.transaction_code,
                "scenario_type": r.scenario_type,
                "risk_score": r.risk_score,
                "predicted_label": r.predicted_label,
                "ground_truth_label": r.ground_truth_label,
                "triggered_rules_json": r.triggered_rules_json,
            }
            for r in all_results_rows
        ],
        rules_config=defense_config.rules_config_json if defense_config else {},
        decision_threshold=defense_config.decision_threshold if defense_config else 55.0,
    )

    return ExperimentDetailResponse(
        experiment=_serialize_experiment_summary(exp, db),
        results=[ExperimentResultView.model_validate(r) for r in rows],
        total_results=total,
        page=page,
        page_size=page_size,
        recommendations=[RecommendationView.model_validate(r) for r in recs],
        analysis=analysis,
    )
