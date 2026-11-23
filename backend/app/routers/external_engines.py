"""External Antifraud Testing, CSV/JSON Import, External Evolution, and Engine Comparison endpoints."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AntifraudEngine, EngineComparison, Experiment, ExternalEvolutionRun
from ..schemas import (
    AntifraudEngineView,
    EngineComparisonCreateRequest,
    EngineComparisonResponse,
    ExperimentSummary,
    ExternalBlackBoxRetestRequest,
    ExternalEvolutionRunResponse,
    ExternalEvolutionStartRequest,
    ExternalEvolutionValidateRequest,
    ExternalExperimentRunRequest,
    ExternalImportRequest,
)
from ..services.antifraud_connector import (
    ConnectorSecurityError,
    ConnectorUnavailableError,
)
from ..services.defense_evolution import compute_experiment_transaction_diff
from ..services.external_testing import (
    analyze_external_evolution,
    check_engine_status,
    compare_two_engines,
    retest_external_blackbox,
    run_external_api_experiment,
    run_external_evolution,
    run_imported_experiment,
    seed_default_engines,
    validate_external_evolution,
)
from .overview import _serialize_experiment_summary

router = APIRouter(prefix="/api/external", tags=["external-antifraud"])


def _ensure_engines(db: Session) -> List[AntifraudEngine]:
    seed_default_engines(db)
    return db.query(AntifraudEngine).order_by(AntifraudEngine.id.asc()).all()


@router.get("/engines", response_model=List[AntifraudEngineView])
def list_engines(db: Session = Depends(get_db)):
    engines = _ensure_engines(db)
    views: List[AntifraudEngineView] = []
    for eng in engines:
        st = check_engine_status(eng)
        views.append(
            AntifraudEngineView(
                id=eng.id,
                code=eng.code,
                name=eng.name,
                adapter_type=eng.adapter_type,
                diagnostic_mode=eng.diagnostic_mode,
                supports_config=eng.supports_config,
                base_url=eng.base_url,
                protocol_version=eng.protocol_version,
                active_profile=st.get("active_profile") or eng.active_profile,
                description=eng.description,
                is_builtin=eng.is_builtin,
                online=bool(st["online"]),
                engine_version=st.get("engine_version"),
                status_error=st.get("error"),
            )
        )
    return views


@router.get("/engines/{engine_id}/status")
def get_engine_status(engine_id: int, db: Session = Depends(get_db)):
    _ensure_engines(db)
    eng = db.query(AntifraudEngine).filter(AntifraudEngine.id == engine_id).first()
    if not eng:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antifraud engine not found")
    return check_engine_status(eng)


@router.post("/experiments", response_model=ExperimentSummary, status_code=status.HTTP_201_CREATED)
def run_external_experiment(
    payload: ExternalExperimentRunRequest,
    db: Session = Depends(get_db),
):
    _ensure_engines(db)
    eng = db.query(AntifraudEngine).filter(AntifraudEngine.id == payload.engine_id).first()
    if not eng:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antifraud engine not found")
    if eng.adapter_type != "external_api":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected engine is not an external HTTP API engine.",
        )

    exp_name = payload.name or f"Проверка {eng.name}"
    try:
        exp = run_external_api_experiment(
            db=db,
            engine=eng,
            dataset_id=payload.dataset_id,
            name=exp_name,
            split_name=payload.split_name,
            scenarios=payload.scenarios,
            profile=payload.profile,
        )
    except ConnectorSecurityError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ConnectorUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _serialize_experiment_summary(exp, db)


@router.post("/import", response_model=ExperimentSummary, status_code=status.HTTP_201_CREATED)
def import_external_predictions(
    payload: ExternalImportRequest,
    db: Session = Depends(get_db),
):
    _ensure_engines(db)
    eng = None
    if payload.engine_id is not None:
        eng = db.query(AntifraudEngine).filter(AntifraudEngine.id == payload.engine_id).first()
    if eng is None:
        eng = (
            db.query(AntifraudEngine)
            .filter(AntifraudEngine.code == "imported_predictions")
            .first()
        )
    if eng is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import engine not registered")

    exp_name = payload.name or f"Импорт ({payload.version_label})"
    try:
        exp = run_imported_experiment(
            db=db,
            engine=eng,
            dataset_id=payload.dataset_id,
            name=exp_name,
            file_format=payload.file_format,
            content=payload.content,
            version_label=payload.version_label,
            split_name=payload.split_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return _serialize_experiment_summary(exp, db)


def _resolve_experiment_and_engine(db: Session, experiment_id: int) -> tuple[Experiment, AntifraudEngine]:
    _ensure_engines(db)
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    eng = None
    if exp.engine_id is not None:
        eng = db.query(AntifraudEngine).filter(AntifraudEngine.id == exp.engine_id).first()
    if eng is None:
        eng = (
            db.query(AntifraudEngine)
            .filter(AntifraudEngine.adapter_type == exp.adapter_type)
            .first()
        )
    if eng is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antifraud engine not found for experiment")
    return exp, eng


@router.post("/evolution/analyze", response_model=ExternalEvolutionRunResponse, status_code=status.HTTP_201_CREATED)
def analyze_external_evolution_route(
    payload: ExternalEvolutionStartRequest,
    db: Session = Depends(get_db),
):
    exp, eng = _resolve_experiment_and_engine(db, payload.experiment_id)
    try:
        return analyze_external_evolution(db=db, baseline_experiment=exp, engine=eng)
    except ConnectorSecurityError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ConnectorUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/evolution/validate", response_model=ExternalEvolutionRunResponse)
def validate_external_evolution_route(
    payload: ExternalEvolutionValidateRequest,
    db: Session = Depends(get_db),
):
    _ensure_engines(db)
    evo = (
        db.query(ExternalEvolutionRun)
        .filter(ExternalEvolutionRun.id == payload.evolution_run_id)
        .first()
    )
    if not evo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External evolution run not found")
    try:
        return validate_external_evolution(db=db, evo_run=evo, candidate_key=payload.candidate_key)
    except ConnectorSecurityError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ConnectorUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/evolution/{run_id}/diff")
def get_external_evolution_diff(
    run_id: int,
    db: Session = Depends(get_db),
):
    run = db.query(ExternalEvolutionRun).filter(ExternalEvolutionRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External evolution run not found")
    cmp = run.comparison_json or {}
    base_id = cmp.get("final_baseline_experiment_id") or run.baseline_experiment_id
    cand_id = cmp.get("final_candidate_experiment_id") or run.candidate_experiment_id
    if not base_id or not cand_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="External evolution run has not completed evaluation yet",
        )
    try:
        return compute_experiment_transaction_diff(db, int(base_id), int(cand_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/evolution", response_model=ExternalEvolutionRunResponse, status_code=status.HTTP_201_CREATED)
def start_external_evolution(
    payload: ExternalEvolutionStartRequest,
    db: Session = Depends(get_db),
):
    exp, eng = _resolve_experiment_and_engine(db, payload.experiment_id)
    try:
        return run_external_evolution(db=db, baseline_experiment=exp, engine=eng)
    except ConnectorSecurityError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ConnectorUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/evolution/retest", response_model=ExternalEvolutionRunResponse)
def retest_blackbox_version(
    payload: ExternalBlackBoxRetestRequest,
    db: Session = Depends(get_db),
):
    _ensure_engines(db)
    evo = (
        db.query(ExternalEvolutionRun)
        .filter(ExternalEvolutionRun.id == payload.evolution_run_id)
        .first()
    )
    if not evo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External evolution run not found")
    eng = db.query(AntifraudEngine).filter(AntifraudEngine.id == evo.engine_id).first()
    if not eng:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Engine not found")

    try:
        return retest_external_blackbox(
            db=db,
            evo_run=evo,
            engine=eng,
            file_format=payload.file_format,
            content=payload.content,
            version_label=payload.version_label,
            profile=payload.profile,
        )
    except ConnectorUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/evolution", response_model=List[ExternalEvolutionRunResponse])
def list_external_evolutions(db: Session = Depends(get_db)):
    return (
        db.query(ExternalEvolutionRun)
        .order_by(ExternalEvolutionRun.created_at.desc(), ExternalEvolutionRun.id.desc())
        .all()
    )


@router.post("/compare", response_model=EngineComparisonResponse, status_code=status.HTTP_201_CREATED)
def compare_engines(
    payload: EngineComparisonCreateRequest,
    db: Session = Depends(get_db),
):
    _ensure_engines(db)
    left_eng = (
        db.query(AntifraudEngine).filter(AntifraudEngine.id == payload.left_engine_id).first()
        if payload.left_engine_id is not None
        else None
    )
    right_eng = (
        db.query(AntifraudEngine).filter(AntifraudEngine.id == payload.right_engine_id).first()
        if payload.right_engine_id is not None
        else None
    )
    try:
        return compare_two_engines(
            db=db,
            dataset_id=payload.dataset_id,
            split_name=payload.split_name,
            left_engine=left_eng,
            right_engine=right_eng,
            left_experiment_id=payload.left_experiment_id,
            right_experiment_id=payload.right_experiment_id,
        )
    except ConnectorUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/compare", response_model=List[EngineComparisonResponse])
def list_engine_comparisons(db: Session = Depends(get_db)):
    return (
        db.query(EngineComparison)
        .order_by(EngineComparison.created_at.desc(), EngineComparison.id.desc())
        .all()
    )
