"""Pydantic v2 request and response schemas for VIGILIA 2.0 REST API."""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SCENARIO_KEYS = (
    "normal_activity",
    "unusual_amount",
    "new_recipient_risk",
    "duplicate_payment",
    "suspicious_sequence",
    "structuring_smurfing",
    "account_takeover_ato",
)


class ScenarioInfo(BaseModel):
    key: str
    code: str
    name: str
    name_ru: str
    description: str
    description_ru: str
    target_rule: str


class DatasetGenerateRequest(BaseModel):
    name: str = Field(default="Synthetic Bank Dataset", min_length=2, max_length=160)
    description: str = Field(default="", max_length=500)
    transaction_count: int = Field(default=1000, ge=10, le=10000)
    customer_count: int = Field(default=100, ge=5, le=2000)
    risk_ratio: float = Field(default=0.05, ge=0.01, le=0.45)
    scenarios: List[str] = Field(default_factory=lambda: list(SCENARIO_KEYS))
    seed: int = Field(default=42, ge=0, le=2_147_483_647)

    @field_validator("scenarios")
    @classmethod
    def validate_scenarios(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("At least one scenario must be selected")
        invalid = [s for s in value if s not in SCENARIO_KEYS]
        if invalid:
            raise ValueError(f"Unsupported scenarios: {invalid}")
        seen = []
        for s in value:
            if s not in seen:
                seen.append(s)
        return seen


class DatasetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    seed: int
    transaction_count: int
    customer_count: int
    risk_ratio: float
    actual_risk_count: int
    scenarios_json: List[str]
    split_counts_json: Dict[str, int]
    created_at: datetime


class TransactionView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_code: str
    customer_code: str
    recipient_code: str
    amount_kzt: float
    timestamp: datetime
    transaction_type: str
    channel: str
    is_new_recipient: bool
    customer_segment: str
    transaction_frequency: float
    scenario_type: str
    split_name: str
    ground_truth_label: int
    metadata_json: Dict[str, Any]


class DatasetDetailResponse(BaseModel):
    dataset: DatasetSummary
    transactions: List[TransactionView]
    total_transactions: int
    page: int
    page_size: int


class RuleConfigSchema(BaseModel):
    enabled: bool = True
    threshold: float = Field(gt=0)
    weight: float = Field(ge=0, le=100)
    window_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    min_amount_kzt: Optional[float] = Field(default=None, ge=0)
    context_amount_ratio: Optional[float] = Field(default=None, ge=0.5, le=20.0)
    amount_tolerance_pct: Optional[float] = Field(default=None, ge=0.0, le=0.5)
    night_bonus: Optional[float] = Field(default=None, ge=0, le=50)
    description: str = ""


class RiskLevelsSchema(BaseModel):
    low_max: float = Field(default=30.0, ge=5, le=50)
    medium_max: float = Field(default=55.0, ge=20, le=80)
    high_max: float = Field(default=80.0, ge=40, le=99)


class DefenseConfigCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    version: Optional[str] = Field(default=None, max_length=40)
    description: str = Field(default="", max_length=500)
    parent_version_id: Optional[int] = None
    decision_threshold: float = Field(default=55.0, ge=10.0, le=95.0)
    risk_levels: RiskLevelsSchema = Field(default_factory=RiskLevelsSchema)
    rules_config: Dict[str, RuleConfigSchema]


class DefenseConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    version: str
    description: str
    parent_version_id: Optional[int]
    is_baseline: bool
    decision_threshold: float
    risk_levels_json: Dict[str, float]
    rules_config_json: Dict[str, Dict[str, Any]]
    changed_params_json: List[Dict[str, Any]]
    created_at: datetime


class ExperimentCreateRequest(BaseModel):
    name: str = Field(default="Stress Test Experiment", min_length=2, max_length=160)
    dataset_id: int
    defense_config_id: int
    split_name: Literal["all", "calibration", "validation", "evaluation"] = "all"
    scenarios: Optional[List[str]] = None

    @field_validator("scenarios")
    @classmethod
    def validate_scenarios(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        if not value:
            raise ValueError("If scenarios filter is provided, it must not be empty")
        invalid = [s for s in value if s not in SCENARIO_KEYS]
        if invalid:
            raise ValueError(f"Unsupported scenarios: {invalid}")
        return value


class ExperimentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    dataset_id: int
    defense_config_id: int
    defense_version: Optional[str] = None
    defense_name: Optional[str] = None
    dataset_name: Optional[str] = None
    split_name: str
    scenarios_json: List[str]
    status: str
    processing_time_ms: float
    engine_id: Optional[int] = None
    engine_name: str = "VIGILIA Internal Defense"
    adapter_type: str = "internal"
    diagnostic_mode: str = "white_box"
    engine_version_label: str = ""
    completeness_json: Dict[str, Any] = Field(default_factory=dict)
    external_config_json: Dict[str, Any] = Field(default_factory=dict)
    metrics_json: Dict[str, Any]
    confusion_matrix_json: Dict[str, int]
    scenario_metrics_json: List[Dict[str, Any]]
    rule_impact_json: List[Dict[str, Any]]
    summary_text: str
    created_at: datetime


class DecisionTraceRuleSchema(BaseModel):
    rule_name: str
    triggered: bool
    score_contribution: Optional[float] = 0.0
    actual_value: Optional[Any] = None
    threshold_value: Optional[Any] = None
    metric_unit: Optional[str] = None
    detail: Optional[str] = None


class DecisionTraceSchema(BaseModel):
    risk_score: Optional[float] = None
    decision_threshold: Optional[float] = None
    review_threshold: Optional[float] = None
    decision: str = "allow"
    predicted_label: Optional[int] = None
    rules: List[DecisionTraceRuleSchema] = Field(default_factory=list)


class ExperimentResultView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    transaction_code: str
    customer_code: str
    recipient_code: str
    amount_kzt: float
    timestamp: datetime
    scenario_type: str
    split_name: str
    risk_score: float
    risk_level: str
    predicted_label: int
    ground_truth_label: int
    triggered_rules_json: List[Dict[str, Any]]
    decision_trace_json: Dict[str, Any] = Field(default_factory=dict)
    decision_trace: Optional[Dict[str, Any]] = None
    explanation: str

    @model_validator(mode="after")
    def _populate_decision_trace_alias(self) -> "ExperimentResultView":
        if not self.decision_trace:
            self.decision_trace = self.decision_trace_json or {}
        return self


class RecommendationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_rule: str
    issue_category: str
    severity: str
    title: str
    explanation: str
    proposed_changes_json: Dict[str, Any]
    expected_impact: str


class ExperimentDetailResponse(BaseModel):
    experiment: ExperimentSummary
    results: List[ExperimentResultView]
    total_results: int
    page: int
    page_size: int
    recommendations: List[RecommendationView]
    analysis: Dict[str, Any]


class GuardrailsSchema(BaseModel):
    min_precision: float = Field(default=0.65, ge=0.0, le=1.0)
    max_fpr: float = Field(default=0.025, ge=0.0, le=1.0)
    max_fp_increase: int = Field(default=8, ge=0, le=500)
    min_recall_gain: float = Field(default=0.02, ge=0.0, le=1.0)
    max_changed_params: int = Field(default=20, ge=1, le=50)
    min_eval_risk_events: int = Field(default=4, ge=1, le=100)
    min_eval_transactions: int = Field(default=30, ge=1, le=5000)


class EvolutionAnalyzeRequest(BaseModel):
    experiment_id: int
    guardrails: Optional[GuardrailsSchema] = None


class EvolutionValidateRequest(BaseModel):
    evolution_run_id: int
    candidate_key: Optional[str] = Field(default=None, max_length=16)
    candidate_name: Optional[str] = None
    custom_rules_config: Optional[Dict[str, Dict[str, Any]]] = None
    custom_decision_threshold: Optional[float] = Field(default=None, ge=10.0, le=95.0)
    guardrails: Optional[GuardrailsSchema] = None


class EvolutionRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    baseline_experiment_id: int
    baseline_config_id: int
    candidate_config_id: Optional[int]
    validation_baseline_experiment_id: Optional[int]
    validation_candidate_experiment_id: Optional[int]
    final_baseline_experiment_id: Optional[int]
    final_candidate_experiment_id: Optional[int]
    weaknesses_json: List[Dict[str, Any]]
    recommendations_json: List[Dict[str, Any]]
    candidates_json: List[Dict[str, Any]] = Field(default_factory=list)
    guardrails_json: Dict[str, Any] = Field(default_factory=dict)
    selected_candidate_key: str = "D"
    proposed_rules_config_json: Dict[str, Any]
    proposed_decision_threshold: float
    changed_params_json: List[Dict[str, Any]]
    comparison_json: Dict[str, Any]
    tradeoff_assessment: str
    verdict: str
    status: str
    created_at: datetime


class BenchmarkCreateRequest(BaseModel):
    name: str = Field(default="Multi-Seed Robustness Benchmark", min_length=2, max_length=160)
    transaction_count: int = Field(default=1000, ge=50, le=10000)
    customer_count: int = Field(default=100, ge=10, le=2000)
    risk_ratio: float = Field(default=0.05, ge=0.01, le=0.45)
    seeds: List[int] = Field(default_factory=lambda: [42, 101, 202, 303, 404])
    scenarios: List[str] = Field(default_factory=lambda: list(SCENARIO_KEYS))
    split_name: Literal["evaluation", "validation", "all"] = "evaluation"
    baseline_config_id: int
    candidate_config_id: Optional[int] = None

    @field_validator("seeds")
    @classmethod
    def validate_seeds(cls, value: List[int]) -> List[int]:
        if not value:
            raise ValueError("At least one seed must be provided")
        if len(value) > 15:
            raise ValueError("Maximum 15 seeds per benchmark run")
        seen: List[int] = []
        for s in value:
            if s < 0 or s > 2_147_483_647:
                raise ValueError(f"Invalid seed: {s}")
            if s not in seen:
                seen.append(s)
        return seen

    @field_validator("scenarios")
    @classmethod
    def validate_scenarios(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("At least one scenario must be selected")
        invalid = [s for s in value if s not in SCENARIO_KEYS]
        if invalid:
            raise ValueError(f"Unsupported scenarios: {invalid}")
        return value


class BenchmarkRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    transaction_count: int
    customer_count: int
    risk_ratio: float
    seeds_json: List[int]
    scenarios_json: List[str]
    split_name: str
    baseline_config_id: int
    candidate_config_id: Optional[int]
    baseline_version: Optional[str] = None
    candidate_version: Optional[str] = None
    status: str
    completed_runs: int
    total_runs: int
    per_seed_results_json: List[Dict[str, Any]]
    aggregated_metrics_json: Dict[str, Any]
    scenario_stability_json: List[Dict[str, Any]]
    comparison_summary_json: Dict[str, Any]
    created_at: datetime


class OverviewResponse(BaseModel):
    total_experiments: int
    total_datasets: int
    total_defense_configs: int
    total_evolutions: int
    total_benchmarks: int = 0
    confirmed_improvements_count: int = 0
    active_defense_version: Optional[str] = None
    last_experiment: Optional[ExperimentSummary]
    total_transactions_tested: int
    total_risk_detected: int
    total_risk_missed: int
    total_false_positives: int
    current_metrics: Dict[str, Any]
    weakest_scenarios: List[Dict[str, Any]] = Field(default_factory=list)
    recent_experiments: List[ExperimentSummary]
    llm_enabled: bool


class AntifraudEngineView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    adapter_type: str
    diagnostic_mode: str
    supports_config: bool
    base_url: Optional[str]
    protocol_version: str
    active_profile: str
    description: str
    is_builtin: bool
    online: bool = True
    engine_version: Optional[str] = None
    status_error: Optional[str] = None


class ExternalExperimentRunRequest(BaseModel):
    engine_id: int
    dataset_id: int
    name: Optional[str] = Field(default=None, max_length=160)
    split_name: Literal["all", "calibration", "validation", "evaluation"] = "all"
    scenarios: Optional[List[str]] = None
    profile: Optional[Literal["baseline", "candidate", "updated"]] = None


class ExternalImportRequest(BaseModel):
    engine_id: Optional[int] = None
    dataset_id: int
    name: Optional[str] = Field(default=None, max_length=160)
    version_label: str = Field(default="Imported v1", min_length=1, max_length=80)
    file_format: Literal["csv", "json"]
    content: str = Field(min_length=2)
    split_name: Literal["all", "calibration", "validation", "evaluation"] = "all"


class ExternalEvolutionStartRequest(BaseModel):
    experiment_id: int


class ExternalEvolutionValidateRequest(BaseModel):
    evolution_run_id: int
    candidate_key: Optional[str] = None


class ExternalBlackBoxRetestRequest(BaseModel):
    evolution_run_id: int
    file_format: Optional[Literal["csv", "json"]] = None
    content: Optional[str] = None
    version_label: str = Field(default="Updated v2", min_length=1, max_length=80)
    profile: Optional[Literal["baseline", "candidate", "updated"]] = None


class ExternalEvolutionRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    engine_id: int
    baseline_experiment_id: int
    candidate_experiment_id: Optional[int]
    mode: str
    baseline_label: str
    candidate_label: str
    baseline_config_snapshot_json: Dict[str, Any]
    proposed_config_json: Dict[str, Any]
    candidates_json: List[Dict[str, Any]]
    weaknesses_json: List[Dict[str, Any]]
    recommendations_json: List[Dict[str, Any]]
    comparison_json: Dict[str, Any]
    verdict: str
    tradeoff_assessment: str
    status: str
    created_at: datetime


class EngineComparisonCreateRequest(BaseModel):
    dataset_id: int
    split_name: Literal["all", "calibration", "validation", "evaluation"] = "evaluation"
    left_engine_id: Optional[int] = None
    right_engine_id: Optional[int] = None
    left_experiment_id: Optional[int] = None
    right_experiment_id: Optional[int] = None


class EngineComparisonResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    dataset_id: int
    split_name: str
    left_experiment_id: int
    right_experiment_id: int
    comparison_json: Dict[str, Any]
    summary_text: str
    created_at: datetime
