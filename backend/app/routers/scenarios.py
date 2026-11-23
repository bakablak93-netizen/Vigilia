"""Scenarios catalog endpoint."""

from typing import List

from fastapi import APIRouter

from ..schemas import ScenarioInfo
from ..services.simulator import SCENARIO_CATALOG

router = APIRouter(prefix="/api", tags=["scenarios"])


@router.get("/scenarios", response_model=List[ScenarioInfo])
def list_scenarios():
    return SCENARIO_CATALOG
