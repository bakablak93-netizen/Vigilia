"""Defense configuration management, versioning, and side-by-side comparison endpoints."""

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import DefenseConfiguration, Experiment
from ..schemas import DefenseConfigCreateRequest, DefenseConfigResponse
from ..services.defense_engine import compute_config_diff

router = APIRouter(prefix="/api/defense", tags=["defense"])


@router.get("/configurations", response_model=List[DefenseConfigResponse])
def list_defense_configurations(db: Session = Depends(get_db)):
    return (
        db.query(DefenseConfiguration)
        .order_by(DefenseConfiguration.created_at.desc(), DefenseConfiguration.id.desc())
        .all()
    )


@router.post("/configurations", response_model=DefenseConfigResponse, status_code=status.HTTP_201_CREATED)
def create_defense_configuration(payload: DefenseConfigCreateRequest, db: Session = Depends(get_db)):
    rules_dict = {k: v.model_dump() for k, v in payload.rules_config.items()}
    if not rules_dict:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one defense rule must be configured",
        )

    parent_config = None
    if payload.parent_version_id is not None:
        parent_config = (
            db.query(DefenseConfiguration)
            .filter(DefenseConfiguration.id == payload.parent_version_id)
            .first()
        )
        if not parent_config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent defense configuration not found",
            )

    existing_count = db.query(DefenseConfiguration).count()
    version_str = payload.version or f"Defense v1.{existing_count}"

    changed_params = []
    if parent_config:
        changed_params = compute_config_diff(
            parent_rules=parent_config.rules_config_json,
            new_rules=rules_dict,
            parent_threshold=parent_config.decision_threshold,
            new_threshold=payload.decision_threshold,
        )

    config = DefenseConfiguration(
        name=payload.name,
        version=version_str,
        description=payload.description,
        parent_version_id=payload.parent_version_id,
        is_baseline=False,
        decision_threshold=payload.decision_threshold,
        risk_levels_json=payload.risk_levels.model_dump(),
        rules_config_json=rules_dict,
        changed_params_json=changed_params,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.get("/compare")
def compare_defense_configurations(
    baseline_id: int = Query(...),
    candidate_id: int = Query(...),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    base_cfg = db.query(DefenseConfiguration).filter(DefenseConfiguration.id == baseline_id).first()
    cand_cfg = db.query(DefenseConfiguration).filter(DefenseConfiguration.id == candidate_id).first()
    if not base_cfg or not cand_cfg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Defense configuration not found")

    param_diffs = compute_config_diff(
        parent_rules=base_cfg.rules_config_json,
        new_rules=cand_cfg.rules_config_json,
        parent_threshold=base_cfg.decision_threshold,
        new_threshold=cand_cfg.decision_threshold,
    )

    base_exp = (
        db.query(Experiment)
        .filter(Experiment.defense_config_id == base_cfg.id)
        .order_by(Experiment.created_at.desc(), Experiment.id.desc())
        .first()
    )
    cand_exp = (
        db.query(Experiment)
        .filter(Experiment.defense_config_id == cand_cfg.id)
        .order_by(Experiment.created_at.desc(), Experiment.id.desc())
        .first()
    )

    return {
        "baseline": DefenseConfigResponse.model_validate(base_cfg).model_dump(),
        "candidate": DefenseConfigResponse.model_validate(cand_cfg).model_dump(),
        "param_diffs": param_diffs,
        "latest_baseline_metrics": base_exp.metrics_json if base_exp else None,
        "latest_candidate_metrics": cand_exp.metrics_json if cand_exp else None,
    }
