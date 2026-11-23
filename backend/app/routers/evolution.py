"""Defense Evolution 2.0 endpoints: weakness analysis, multi-candidate generation, guardrail validation, and version history."""

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EvolutionRun, Experiment
from ..schemas import EvolutionAnalyzeRequest, EvolutionRunResponse, EvolutionValidateRequest
from ..services.defense_evolution import (
    analyze_for_evolution,
    build_evolution_lineage,
    compute_experiment_transaction_diff,
    validate_and_evaluate_evolution,
)

router = APIRouter(prefix="/api/evolution", tags=["evolution"])


@router.post("/analyze", response_model=EvolutionRunResponse, status_code=status.HTTP_201_CREATED)
def analyze_evolution(payload: EvolutionAnalyzeRequest, db: Session = Depends(get_db)):
    exp = db.query(Experiment).filter(Experiment.id == payload.experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Baseline experiment not found")
    guardrails = payload.guardrails.model_dump() if payload.guardrails else None
    return analyze_for_evolution(db, exp, guardrails=guardrails)


@router.post("/validate", response_model=EvolutionRunResponse)
def validate_evolution(payload: EvolutionValidateRequest, db: Session = Depends(get_db)):
    evo_run = db.query(EvolutionRun).filter(EvolutionRun.id == payload.evolution_run_id).first()
    if not evo_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evolution run not found")
    guardrails = payload.guardrails.model_dump() if payload.guardrails else None
    return validate_and_evaluate_evolution(
        db=db,
        evo_run=evo_run,
        candidate_name=payload.candidate_name,
        candidate_key=payload.candidate_key,
        custom_rules_config=payload.custom_rules_config,
        custom_decision_threshold=payload.custom_decision_threshold,
        guardrails=guardrails,
    )


@router.get("/runs", response_model=List[EvolutionRunResponse])
def list_evolution_runs(db: Session = Depends(get_db)):
    return db.query(EvolutionRun).order_by(EvolutionRun.created_at.desc(), EvolutionRun.id.desc()).all()


@router.get("/runs/{run_id}", response_model=EvolutionRunResponse)
def get_evolution_run(run_id: int, db: Session = Depends(get_db)):
    evo_run = db.query(EvolutionRun).filter(EvolutionRun.id == run_id).first()
    if not evo_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evolution run not found")
    return evo_run


@router.get("/runs/{run_id}/diff")
def get_evolution_run_diff(run_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    evo_run = db.query(EvolutionRun).filter(EvolutionRun.id == run_id).first()
    if not evo_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evolution run not found")
    if not evo_run.final_baseline_experiment_id or not evo_run.final_candidate_experiment_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Evolution run has not completed held-out evaluation yet",
        )
    return compute_experiment_transaction_diff(
        db=db,
        baseline_experiment_id=evo_run.final_baseline_experiment_id,
        candidate_experiment_id=evo_run.final_candidate_experiment_id,
    )


@router.get("/history", response_model=List[Dict[str, Any]])
def get_evolution_history(db: Session = Depends(get_db)):
    return build_evolution_lineage(db)
