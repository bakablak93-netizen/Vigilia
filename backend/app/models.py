"""SQLAlchemy ORM models for VIGILIA 2.0 persistence."""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False)
    customer_count: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    actual_risk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    scenarios_json: Mapped[list] = mapped_column(JSON, nullable=False)
    split_counts_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    customers: Mapped[list["VirtualCustomer"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )
    transactions: Mapped[list["SyntheticTransaction"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )
    experiments: Mapped[list["Experiment"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )


class VirtualCustomer(Base):
    __tablename__ = "virtual_customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    customer_code: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    customer_type: Mapped[str] = mapped_column(String(24), nullable=False)  # individual | business
    activity_category: Mapped[str] = mapped_column(String(64), nullable=False)
    customer_segment: Mapped[str] = mapped_column(String(40), nullable=False)
    account_age_days: Mapped[int] = mapped_column(Integer, nullable=False)
    typical_amount_min_kzt: Mapped[float] = mapped_column(Float, nullable=False)
    typical_amount_max_kzt: Mapped[float] = mapped_column(Float, nullable=False)
    avg_amount_kzt: Mapped[float] = mapped_column(Float, nullable=False)
    std_amount_kzt: Mapped[float] = mapped_column(Float, nullable=False)
    avg_tx_frequency_per_day: Mapped[float] = mapped_column(Float, nullable=False)
    known_recipients_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    dataset: Mapped["Dataset"] = relationship(back_populates="customers")


class SyntheticTransaction(Base):
    __tablename__ = "synthetic_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    transaction_code: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    customer_code: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    recipient_code: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    amount_kzt: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(40), nullable=False)
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    is_new_recipient: Mapped[bool] = mapped_column(Boolean, nullable=False)
    customer_segment: Mapped[str] = mapped_column(String(40), nullable=False)
    transaction_frequency: Mapped[float] = mapped_column(Float, nullable=False)
    scenario_type: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    split_name: Mapped[str] = mapped_column(String(24), index=True, nullable=False)  # calibration | validation | evaluation
    ground_truth_label: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 or 1 (never sent to Defense Engine)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    dataset: Mapped["Dataset"] = relationship(back_populates="transactions")


class DefenseConfiguration(Base):
    __tablename__ = "defense_configurations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    parent_version_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("defense_configurations.id", ondelete="SET NULL"), nullable=True
    )
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    decision_threshold: Mapped[float] = mapped_column(Float, default=55.0, nullable=False)
    risk_levels_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    rules_config_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    changed_params_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    experiments: Mapped[list["Experiment"]] = relationship(back_populates="defense_config")


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    defense_config_id: Mapped[int] = mapped_column(
        ForeignKey("defense_configurations.id", ondelete="CASCADE"), index=True
    )
    split_name: Mapped[str] = mapped_column(String(24), default="all", nullable=False)
    scenarios_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="completed", nullable=False)
    processing_time_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    engine_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    engine_name: Mapped[str] = mapped_column(String(120), default="VIGILIA Internal Defense", nullable=False)
    adapter_type: Mapped[str] = mapped_column(String(32), default="internal", nullable=False)
    diagnostic_mode: Mapped[str] = mapped_column(String(24), default="white_box", nullable=False)
    engine_version_label: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    completeness_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    external_config_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    confusion_matrix_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    scenario_metrics_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    rule_impact_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    summary_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    dataset: Mapped["Dataset"] = relationship(back_populates="experiments")
    defense_config: Mapped["DefenseConfiguration"] = relationship(back_populates="experiments")
    results: Mapped[list["ExperimentResult"]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )
    recommendations: Mapped[list["Recommendation"]] = relationship(
        back_populates="experiment", cascade="all, delete-orphan"
    )


class ExperimentResult(Base):
    __tablename__ = "experiment_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("synthetic_transactions.id", ondelete="CASCADE"))
    transaction_code: Mapped[str] = mapped_column(String(48), nullable=False)
    customer_code: Mapped[str] = mapped_column(String(40), nullable=False)
    recipient_code: Mapped[str] = mapped_column(String(48), nullable=False)
    amount_kzt: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scenario_type: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    split_name: Mapped[str] = mapped_column(String(24), nullable=False)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    predicted_label: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    ground_truth_label: Mapped[int] = mapped_column(Integer, nullable=False)
    triggered_rules_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    decision_trace_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, default="", nullable=False)

    experiment: Mapped["Experiment"] = relationship(back_populates="results")


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    target_rule: Mapped[str] = mapped_column(String(64), nullable=False)
    issue_category: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(24), nullable=False)  # low | medium | high | critical
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_changes_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    expected_impact: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    experiment: Mapped["Experiment"] = relationship(back_populates="recommendations")


class EvolutionRun(Base):
    __tablename__ = "evolution_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    baseline_experiment_id: Mapped[int] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), index=True
    )
    baseline_config_id: Mapped[int] = mapped_column(
        ForeignKey("defense_configurations.id", ondelete="CASCADE")
    )
    candidate_config_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("defense_configurations.id", ondelete="SET NULL"), nullable=True
    )
    validation_baseline_experiment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True
    )
    validation_candidate_experiment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True
    )
    final_baseline_experiment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True
    )
    final_candidate_experiment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True
    )
    weaknesses_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    recommendations_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    candidates_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    guardrails_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    selected_candidate_key: Mapped[str] = mapped_column(String(32), default="D", nullable=False)
    proposed_rules_config_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    proposed_decision_threshold: Mapped[float] = mapped_column(Float, default=55.0, nullable=False)
    changed_params_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    comparison_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    tradeoff_assessment: Mapped[str] = mapped_column(Text, default="", nullable=False)
    verdict: Mapped[str] = mapped_column(String(32), default="analyzed", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="analyzed", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class BenchmarkRun(Base):
    __tablename__ = "benchmark_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    transaction_count: Mapped[int] = mapped_column(Integer, default=1000, nullable=False)
    customer_count: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    risk_ratio: Mapped[float] = mapped_column(Float, default=0.05, nullable=False)
    seeds_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    scenarios_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    split_name: Mapped[str] = mapped_column(String(24), default="evaluation", nullable=False)
    baseline_config_id: Mapped[int] = mapped_column(
        ForeignKey("defense_configurations.id", ondelete="CASCADE"), index=True
    )
    candidate_config_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("defense_configurations.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    completed_runs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_runs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    per_seed_results_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    aggregated_metrics_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    scenario_stability_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    comparison_summary_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AntifraudEngine(Base):
    __tablename__ = "antifraud_engines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    adapter_type: Mapped[str] = mapped_column(String(32), nullable=False)  # internal | external_api | imported
    diagnostic_mode: Mapped[str] = mapped_column(String(24), default="white_box", nullable=False)  # white_box | black_box
    supports_config: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    base_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    protocol_version: Mapped[str] = mapped_column(String(16), default="1.0", nullable=False)
    active_profile: Mapped[str] = mapped_column(String(48), default="baseline", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ExternalEvolutionRun(Base):
    __tablename__ = "external_evolution_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    engine_id: Mapped[int] = mapped_column(ForeignKey("antifraud_engines.id", ondelete="CASCADE"), index=True)
    baseline_experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    candidate_experiment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True
    )
    mode: Mapped[str] = mapped_column(String(32), nullable=False)  # configurable_white_box | black_box_manual
    baseline_label: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    candidate_label: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    baseline_config_snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    proposed_config_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    candidates_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    weaknesses_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    recommendations_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    comparison_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    verdict: Mapped[str] = mapped_column(String(32), default="awaiting_retest", nullable=False)
    tradeoff_assessment: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="awaiting_retest", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class EngineComparison(Base):
    __tablename__ = "engine_comparisons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    split_name: Mapped[str] = mapped_column(String(24), default="all", nullable=False)
    left_experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    right_experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    comparison_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    summary_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
