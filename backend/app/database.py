"""SQLAlchemy database engine, session management, and non-destructive schema migration."""

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _sqlite_on_connect(dbapi_connection, _connection_record, busy_timeout_ms: int = 5000) -> None:
    """Apply WAL journal mode, busy timeout, and foreign keys on SQLite connections."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def configure_sqlite_engine(target_engine: Engine, busy_timeout_ms: int = 5000) -> None:
    """Idempotently attach SQLite WAL & busy_timeout listener to an SQLAlchemy Engine."""
    if not str(target_engine.url).startswith("sqlite"):
        return
    if getattr(target_engine, "_vigilia_sqlite_configured", False):
        return

    @event.listens_for(target_engine, "connect")
    def _on_connect(dbapi_connection, connection_record):
        _sqlite_on_connect(dbapi_connection, connection_record, busy_timeout_ms=busy_timeout_ms)

    setattr(target_engine, "_vigilia_sqlite_configured", True)


settings = get_settings()

connect_args = (
    {"check_same_thread": False, "timeout": 5.0}
    if settings.database_url.startswith("sqlite")
    else {}
)
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
configure_sqlite_engine(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def get_db():
    """FastAPI dependency yielding a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def apply_safe_migrations(target_engine: Engine) -> None:
    """Safely add VIGILIA 2.0 columns to existing SQLite tables without losing user data."""
    if not str(target_engine.url).startswith("sqlite"):
        return
    with target_engine.begin() as conn:
        tables = {
            row[0]
            for row in conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            ).fetchall()
        }
        if "evolution_runs" in tables:
            cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(evolution_runs)")).fetchall()
            }
            if "candidates_json" not in cols:
                conn.execute(
                    text("ALTER TABLE evolution_runs ADD COLUMN candidates_json JSON DEFAULT '[]' NOT NULL")
                )
            if "guardrails_json" not in cols:
                conn.execute(
                    text("ALTER TABLE evolution_runs ADD COLUMN guardrails_json JSON DEFAULT '{}' NOT NULL")
                )
            if "selected_candidate_key" not in cols:
                conn.execute(
                    text("ALTER TABLE evolution_runs ADD COLUMN selected_candidate_key VARCHAR(32) DEFAULT 'D' NOT NULL")
                )

        if "experiments" in tables:
            exp_cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(experiments)")).fetchall()
            }
            if "engine_id" not in exp_cols:
                conn.execute(text("ALTER TABLE experiments ADD COLUMN engine_id INTEGER"))
            if "engine_name" not in exp_cols:
                conn.execute(
                    text("ALTER TABLE experiments ADD COLUMN engine_name VARCHAR(120) DEFAULT 'VIGILIA Internal Defense' NOT NULL")
                )
            if "adapter_type" not in exp_cols:
                conn.execute(
                    text("ALTER TABLE experiments ADD COLUMN adapter_type VARCHAR(32) DEFAULT 'internal' NOT NULL")
                )
            if "diagnostic_mode" not in exp_cols:
                conn.execute(
                    text("ALTER TABLE experiments ADD COLUMN diagnostic_mode VARCHAR(24) DEFAULT 'white_box' NOT NULL")
                )
            if "engine_version_label" not in exp_cols:
                conn.execute(
                    text("ALTER TABLE experiments ADD COLUMN engine_version_label VARCHAR(80) DEFAULT '' NOT NULL")
                )
            if "completeness_json" not in exp_cols:
                conn.execute(
                    text("ALTER TABLE experiments ADD COLUMN completeness_json JSON DEFAULT '{}' NOT NULL")
                )
            if "external_config_json" not in exp_cols:
                conn.execute(
                    text("ALTER TABLE experiments ADD COLUMN external_config_json JSON DEFAULT '{}' NOT NULL")
                )

        if "experiment_results" in tables:
            res_cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(experiment_results)")).fetchall()
            }
            if "decision_trace_json" not in res_cols:
                conn.execute(
                    text("ALTER TABLE experiment_results ADD COLUMN decision_trace_json JSON DEFAULT '{}' NOT NULL")
                )


def init_db(target_engine: Engine | None = None) -> None:
    """Create all tables if they do not exist and run safe column migrations."""
    from . import models  # noqa: F401

    active_engine = target_engine or engine
    configure_sqlite_engine(active_engine)
    Base.metadata.create_all(bind=active_engine)
    apply_safe_migrations(active_engine)
