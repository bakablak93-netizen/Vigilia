"""VIGILIA 2.0 — Intelligent Bank Defense Laboratory FastAPI application entrypoint."""

from copy import deepcopy
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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

    dist_candidates = [
        Path(__file__).resolve().parents[2] / "frontend" / "dist",
        Path.cwd() / "frontend" / "dist",
    ]
    frontend_dist = next((p for p in dist_candidates if (p / "index.html").is_file()), None)
    if frontend_dist is not None:
        assets_dir = frontend_dist / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

        dist_root = frontend_dist.resolve()
        index_html = dist_root / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_spa(full_path: str):
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not Found")
            if full_path:
                candidate = (dist_root / full_path).resolve()
                if candidate.is_relative_to(dist_root) and candidate.is_file():
                    return FileResponse(str(candidate))
            return FileResponse(str(index_html))

    return app


app = create_app()
