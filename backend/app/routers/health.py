"""Health check endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    settings = get_settings()
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "llm_configured": settings.llm_configured,
    }
