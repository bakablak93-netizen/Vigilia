"""Competition Demo Mode router: one-click reproducible seed=42 pipeline and non-destructive reset."""

from typing import Any, Dict

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.demo_mode import launch_competition_demo, reset_competition_demo

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/launch", status_code=status.HTTP_201_CREATED)
def launch_demo_endpoint(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return launch_competition_demo(db=db, seed=42)


@router.post("/reset")
def reset_demo_endpoint(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return reset_competition_demo(db=db)
