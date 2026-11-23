"""Multi-Seed Benchmark Lab endpoints."""

import json
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import BenchmarkRun, DefenseConfiguration
from ..schemas import BenchmarkCreateRequest, BenchmarkRunResponse
from ..services.benchmark_engine import run_multi_seed_benchmark
from ..services.reports import build_benchmark_csv

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])


def _serialize_benchmark(bm: BenchmarkRun, db: Session) -> BenchmarkRunResponse:
    base_cfg = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == bm.baseline_config_id)
        .first()
    )
    cand_cfg = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == bm.candidate_config_id)
        .first()
        if bm.candidate_config_id
        else None
    )
    return BenchmarkRunResponse(
        id=bm.id,
        name=bm.name,
        transaction_count=bm.transaction_count,
        customer_count=bm.customer_count,
        risk_ratio=bm.risk_ratio,
        seeds_json=bm.seeds_json,
        scenarios_json=bm.scenarios_json,
        split_name=bm.split_name,
        baseline_config_id=bm.baseline_config_id,
        candidate_config_id=bm.candidate_config_id,
        baseline_version=base_cfg.version if base_cfg else None,
        candidate_version=cand_cfg.version if cand_cfg else None,
        status=bm.status,
        completed_runs=bm.completed_runs,
        total_runs=bm.total_runs,
        per_seed_results_json=bm.per_seed_results_json,
        aggregated_metrics_json=bm.aggregated_metrics_json,
        scenario_stability_json=bm.scenario_stability_json,
        comparison_summary_json=bm.comparison_summary_json,
        created_at=bm.created_at,
    )


@router.post("/run", response_model=BenchmarkRunResponse, status_code=status.HTTP_201_CREATED)
def run_benchmark(payload: BenchmarkCreateRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if payload.transaction_count > settings.max_transactions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"transaction_count cannot exceed {settings.max_transactions}",
        )
    if len(payload.seeds) > settings.max_benchmark_seeds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"seeds count cannot exceed {settings.max_benchmark_seeds}",
        )

    base_cfg = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == payload.baseline_config_id)
        .first()
    )
    if not base_cfg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Baseline defense configuration not found",
        )

    cand_cfg = None
    if payload.candidate_config_id is not None:
        cand_cfg = (
            db.query(DefenseConfiguration)
            .filter(DefenseConfiguration.id == payload.candidate_config_id)
            .first()
        )
        if not cand_cfg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate defense configuration not found",
            )

    bm = run_multi_seed_benchmark(
        db=db,
        name=payload.name,
        baseline_config=base_cfg,
        candidate_config=cand_cfg,
        transaction_count=payload.transaction_count,
        customer_count=payload.customer_count,
        risk_ratio=payload.risk_ratio,
        seeds=payload.seeds,
        scenarios=payload.scenarios,
        split_name=payload.split_name,
    )
    return _serialize_benchmark(bm, db)


@router.get("", response_model=List[BenchmarkRunResponse])
def list_benchmarks(db: Session = Depends(get_db)):
    rows = db.query(BenchmarkRun).order_by(BenchmarkRun.created_at.desc(), BenchmarkRun.id.desc()).all()
    return [_serialize_benchmark(r, db) for r in rows]


@router.get("/{benchmark_id}", response_model=BenchmarkRunResponse)
def get_benchmark(benchmark_id: int, db: Session = Depends(get_db)):
    bm = db.query(BenchmarkRun).filter(BenchmarkRun.id == benchmark_id).first()
    if not bm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benchmark run not found")
    return _serialize_benchmark(bm, db)


@router.get("/{benchmark_id}/export")
def export_benchmark(
    benchmark_id: int,
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
):
    bm = db.query(BenchmarkRun).filter(BenchmarkRun.id == benchmark_id).first()
    if not bm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benchmark run not found")

    if format == "csv":
        return Response(
            content=build_benchmark_csv(bm),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="vigilia_benchmark_{benchmark_id}.csv"'
            },
        )

    payload = _serialize_benchmark(bm, db).model_dump(mode="json")
    return Response(
        content=json.dumps(payload, indent=2, ensure_ascii=False),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="vigilia_benchmark_{benchmark_id}.json"'
        },
    )
