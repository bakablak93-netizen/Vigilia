"""VIGILIA 2.0 — Intelligent Bank Defense Laboratory FastAPI application entrypoint."""

from copy import deepcopy
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import SessionLocal, init_db
from .models import DefenseConfiguration
from .routers import (
    benchmarks,
    datasets,
    defense,
    demo,
    evolution,
    experiments,
    external_engines,
    health,
    intelligence,
    overview,
    reports,
    scenarios,
)
from .services.defense_engine import DEFAULT_RULES_CONFIG, get_default_config_payload
from .services.external_testing import seed_default_engines


def seed_default_defense_config() -> None:
    """Ensure Defense v1.0 baseline and built-in antifraud engines exist on startup."""
    db = SessionLocal()
    try:
        exists = db.query(DefenseConfiguration).filter(DefenseConfiguration.is_baseline.is_(True)).first()
        if not exists:
            any_cfg = db.query(DefenseConfiguration).first()
            if not any_cfg:
                payload = get_default_config_payload()
                db.add(DefenseConfiguration(**payload))
                db.commit()
        else:
            rules = deepcopy(exists.rules_config_json or {})
            updated = False
            for r_key in ("structuring_smurfing", "account_takeover_ato"):
                if r_key not in rules and r_key in DEFAULT_RULES_CONFIG:
                    rules[r_key] = deepcopy(DEFAULT_RULES_CONFIG[r_key])
                    updated = True
            if updated:
                exists.rules_config_json = rules
                db.commit()
        seed_default_engines(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    seed_default_defense_config()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Isolated synthetic testing laboratory for banking anti-fraud rule evaluation, "
            "Multi-Seed Benchmarking, Security Intelligence, and Defense Evolution 2.0."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(overview.router)
    app.include_router(scenarios.router)
    app.include_router(datasets.router)
    app.include_router(defense.router)
    app.include_router(experiments.router)
    app.include_router(evolution.router)
    app.include_router(benchmarks.router)
    app.include_router(intelligence.router)
    app.include_router(reports.router)
    app.include_router(demo.router)
    app.include_router(external_engines.router)

    return app


app = create_app()
