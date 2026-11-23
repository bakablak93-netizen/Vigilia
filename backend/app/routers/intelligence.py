"""Security Intelligence endpoints: Weakness Explorer, FP/FN Root-Cause Diagnostics, Transaction Inspector, Reliability Report."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import DefenseConfiguration, Experiment, ExperimentResult, SyntheticTransaction
from ..services.security_intelligence import build_security_intelligence_report, resolve_decision_trace

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


@router.get("/{experiment_id}")
def get_security_intelligence(
    experiment_id: int,
    compare_experiment_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    return build_security_intelligence_report(
        db=db,
        experiment=exp,
        compare_experiment_id=compare_experiment_id,
    )


@router.get("/{experiment_id}/transactions")
def list_inspector_transactions(
    experiment_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    outcome: Optional[str] = Query(default=None),  # all | tp | fp | fn | tn | legit
    scenario_type: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")

    is_internal = exp.adapter_type == "internal"
    defense = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == exp.defense_config_id)
        .first()
        if is_internal
        else None
    )
    ext_cfg = exp.external_config_json or {}
    decision_threshold = float(
        defense.decision_threshold if defense else ext_cfg.get("decision_threshold", 55.0)
    )
    has_risk_scores = True if is_internal else bool((exp.completeness_json or {}).get("has_risk_scores", True))

    q = db.query(ExperimentResult).filter(ExperimentResult.experiment_id == experiment_id)
    if scenario_type and scenario_type != "all":
        q = q.filter(ExperimentResult.scenario_type == scenario_type)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            (ExperimentResult.transaction_code.ilike(term))
            | (ExperimentResult.customer_code.ilike(term))
            | (ExperimentResult.recipient_code.ilike(term))
        )

    norm_outcome = (outcome or "all").strip().lower()
    if norm_outcome == "tp":
        q = q.filter(ExperimentResult.predicted_label == 1, ExperimentResult.ground_truth_label == 1)
    elif norm_outcome == "fp":
        q = q.filter(ExperimentResult.predicted_label == 1, ExperimentResult.ground_truth_label == 0)
    elif norm_outcome == "fn":
        q = q.filter(ExperimentResult.predicted_label == 0, ExperimentResult.ground_truth_label == 1)
    elif norm_outcome == "tn":
        q = q.filter(ExperimentResult.predicted_label == 0, ExperimentResult.ground_truth_label == 0)
    elif norm_outcome == "legit":
        q = q.filter(ExperimentResult.ground_truth_label == 0)

    total = q.count()
    rows = (
        q.order_by(ExperimentResult.risk_score.desc(), ExperimentResult.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    tx_ids = [r.transaction_id for r in rows]
    tx_map = {
        t.id: t
        for t in db.query(SyntheticTransaction).filter(SyntheticTransaction.id.in_(tx_ids)).all()
    } if tx_ids else {}

    defense_label = exp.engine_version_label or (defense.version if defense else "")
    items = []
    for r in rows:
        tx = tx_map.get(r.transaction_id)
        out_lbl = (
            "TP"
            if (r.predicted_label == 1 and r.ground_truth_label == 1)
            else (
                "FP"
                if (r.predicted_label == 1 and r.ground_truth_label == 0)
                else ("FN" if (r.predicted_label == 0 and r.ground_truth_label == 1) else "TN")
            )
        )
        items.append(
            {
                "id": r.id,
                "transaction_id": r.transaction_id,
                "transaction_code": r.transaction_code,
                "customer_code": r.customer_code,
                "recipient_code": r.recipient_code,
                "amount_kzt": r.amount_kzt,
                "timestamp": r.timestamp.isoformat(),
                "transaction_type": tx.transaction_type if tx else "p2p_transfer",
                "channel": tx.channel if tx else "mobile_app",
                "is_new_recipient": tx.is_new_recipient if tx else False,
                "customer_segment": tx.customer_segment if tx else "retail_standard",
                "transaction_frequency": tx.transaction_frequency if tx else 1.0,
                "scenario_type": r.scenario_type,
                "split_name": r.split_name,
                "risk_score": r.risk_score if has_risk_scores else None,
                "score_available": has_risk_scores,
                "risk_level": r.risk_level,
                "decision_threshold": decision_threshold,
                "gap_to_threshold": round(r.risk_score - decision_threshold, 2) if has_risk_scores else 0.0,
                "triggered_rules": r.triggered_rules_json,
                "decision_trace": resolve_decision_trace(
                    res=r,
                    decision_threshold=decision_threshold,
                    is_internal=is_internal,
                    has_risk_scores=has_risk_scores,
                ),
                "reason_codes": [tr.get("rule") for tr in (r.triggered_rules_json or []) if tr.get("rule")],
                "explanation": r.explanation,
                "ground_truth_label": r.ground_truth_label,
                "predicted_label": r.predicted_label,
                "outcome": out_lbl,
                "engine_name": exp.engine_name,
                "defense_version": defense_label,
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_risk_scores": has_risk_scores,
    }


@router.get("/{experiment_id}/transactions/{transaction_code}")
def inspect_single_transaction(
    experiment_id: int,
    transaction_code: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")

    res = (
        db.query(ExperimentResult)
        .filter(
            ExperimentResult.experiment_id == experiment_id,
            ExperimentResult.transaction_code == transaction_code,
        )
        .first()
    )
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction result not found")

    tx = db.query(SyntheticTransaction).filter(SyntheticTransaction.id == res.transaction_id).first()
    is_internal = exp.adapter_type == "internal"
    defense = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == exp.defense_config_id)
        .first()
        if is_internal
        else None
    )
    ext_cfg = exp.external_config_json or {}
    decision_threshold = float(
        defense.decision_threshold if defense else ext_cfg.get("decision_threshold", 55.0)
    )
    has_risk_scores = True if is_internal else bool((exp.completeness_json or {}).get("has_risk_scores", True))
    defense_label = exp.engine_version_label or (defense.version if defense else "")
    outcome = (
        "TP"
        if (res.predicted_label == 1 and res.ground_truth_label == 1)
        else (
            "FP"
            if (res.predicted_label == 1 and res.ground_truth_label == 0)
            else ("FN" if (res.predicted_label == 0 and res.ground_truth_label == 1) else "TN")
        )
    )

    return {
        "transaction_code": res.transaction_code,
        "customer_code": res.customer_code,
        "recipient_code": res.recipient_code,
        "amount_kzt": res.amount_kzt,
        "timestamp": res.timestamp.isoformat(),
        "transaction_type": tx.transaction_type if tx else "p2p_transfer",
        "channel": tx.channel if tx else "mobile_app",
        "is_new_recipient": tx.is_new_recipient if tx else False,
        "customer_segment": tx.customer_segment if tx else "retail_standard",
        "transaction_frequency": tx.transaction_frequency if tx else 1.0,
        "scenario_type": res.scenario_type,
        "split_name": res.split_name,
        "risk_score": res.risk_score if has_risk_scores else None,
        "score_available": has_risk_scores,
        "risk_level": res.risk_level,
        "decision_threshold": decision_threshold,
        "gap_to_threshold": round(res.risk_score - decision_threshold, 2) if has_risk_scores else 0.0,
        "triggered_rules": res.triggered_rules_json,
        "decision_trace": resolve_decision_trace(
            res=res,
            decision_threshold=decision_threshold,
            is_internal=is_internal,
            has_risk_scores=has_risk_scores,
        ),
        "reason_codes": [tr.get("rule") for tr in (res.triggered_rules_json or []) if tr.get("rule")],
        "explanation": res.explanation,
        "ground_truth_label": res.ground_truth_label,
        "predicted_label": res.predicted_label,
        "outcome": outcome,
        "engine_name": exp.engine_name,
        "defense_version": defense_label,
    }
