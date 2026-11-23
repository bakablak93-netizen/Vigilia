"""Experiment reports and JSON, CSV, and printable HTML export endpoints."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Experiment
from ..services.reports import (
    build_experiment_csv,
    build_experiment_report,
    build_printable_html_report,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/{experiment_id}")
def get_report(experiment_id: int, db: Session = Depends(get_db)):
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    return build_experiment_report(db, exp)


@router.get("/{experiment_id}/export")
def export_report(
    experiment_id: int,
    format: str = Query(default="json", pattern="^(json|csv|html)$"),
    db: Session = Depends(get_db),
):
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")

    if format == "csv":
        csv_data = build_experiment_csv(db, exp)
        return Response(
            content=csv_data,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="vigilia_experiment_{experiment_id}.csv"'
            },
        )

    if format == "html":
        html_doc = build_printable_html_report(db, exp)
        return Response(
            content=html_doc,
            media_type="text/html; charset=utf-8",
        )

    report = build_experiment_report(db, exp)
    return Response(
        content=json.dumps(report, indent=2, ensure_ascii=False),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="vigilia_report_{experiment_id}.json"'
        },
    )
