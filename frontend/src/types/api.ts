export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  llm_configured: boolean;
}

export interface ScenarioInfo {
  key: string;
  code: string;
  name: string;
  name_ru: string;
  description: string;
  description_ru: string;
  target_rule: string;
}

export interface DatasetSummary {
  id: number;
  name: string;
  description: string;
  seed: number;
  transaction_count: number;
  customer_count: number;
  risk_ratio: number;
  actual_risk_count: number;
  scenarios_json: string[];
  split_counts_json: Record<string, number>;
  created_at: string;
}

export interface TransactionView {
  id: number;
  transaction_code: string;
  customer_code: string;
  recipient_code: string;
  amount_kzt: number;
  timestamp: string;
  transaction_type: string;
  channel: string;
  is_new_recipient: boolean;
  customer_segment: string;
  transaction_frequency: number;
  scenario_type: string;
  split_name: string;
  ground_truth_label: number;
  metadata_json: Record<string, unknown>;
}

export interface DatasetDetailResponse {
  dataset: DatasetSummary;
  transactions: TransactionView[];
  total_transactions: number;
  page: number;
  page_size: number;
}

export interface RuleConfig {
  enabled: boolean;
  threshold: number;
  weight: number;
  window_minutes?: number | null;
  min_amount_kzt?: number | null;
  context_amount_ratio?: number | null;
  amount_tolerance_pct?: number | null;
  night_bonus?: number | null;
  description?: string;
}

export interface RiskLevels {
  low_max: number;
  medium_max: number;
  high_max: number;
}

export interface ParamChange {
  rule: string;
  param: string;
  old_value: unknown;
  new_value: unknown;
  reason?: string;
  mechanism?: string;
  purpose?: string;
  expected_effect?: string;
  linked_weakness?: string | null;
  attribution_mode?: "isolated_single_rule_ablation" | "multi_param_joint" | string;
  before_metrics?: Partial<MetricsSummary> | null;
  after_metrics?: Partial<MetricsSummary> | null;
  side_effects?: string;
}

export interface ExternalParamDetail {
  param: string;
  mechanism: string;
  old_value: unknown;
  new_value: unknown;
  purpose: string;
  expected_effect: string;
  linked_weakness: string | null;
  side_effect: string;
  attribution_mode: "multi_param_joint" | "single_param" | string;
}

export interface RemainingWeaknessItem {
  scenario_type: string;
  actual_risk_events: number;
  false_negatives: number;
  false_positives: number;
  recall?: number;
}

export interface ScenarioAudit {
  categories_disjoint: boolean;
  matched_transactions: number;
  totals_match_overall: boolean;
  overall: {
    actual_risk_events: number;
    baseline_tp: number;
    candidate_tp: number;
    baseline_fn: number;
    candidate_fn: number;
    baseline_fp: number;
    candidate_fp: number;
  };
}

export interface DefenseConfig {
  id: number;
  name: string;
  version: string;
  description: string;
  parent_version_id: number | null;
  is_baseline: boolean;
  decision_threshold: number;
  risk_levels_json: RiskLevels;
  rules_config_json: Record<string, RuleConfig>;
  changed_params_json: ParamChange[];
  created_at: string;
}

export interface MetricsSummary {
  total_transactions: number;
  actual_risk_events: number;
  predicted_risk_events: number;
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  false_positive_rate: number;
  false_negative_rate: number;
  accuracy: number;
  avg_risk_score: number;
  processing_time_ms?: number;
  prevented_fraud_amount?: number;
  missed_fraud_amount?: number;
  false_decline_amount?: number;
  review_queue_count?: number;
  review_queue_rate?: number;
  risk_level_distribution?: Record<string, number>;
}

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface ScenarioMetric {
  scenario_type: string;
  total_transactions: number;
  actual_risk_events: number;
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  false_positive_rate: number;
  false_negative_rate: number;
  avg_risk_score: number;
}

export interface RuleImpact {
  rule: string;
  trigger_count: number;
  tp_triggers: number;
  fp_triggers: number;
  trigger_precision: number;
  avg_contribution: number;
}

export interface ExperimentSummary {
  id: number;
  name: string;
  dataset_id: number;
  defense_config_id: number;
  defense_version?: string | null;
  defense_name?: string | null;
  dataset_name?: string | null;
  split_name: string;
  scenarios_json: string[];
  status: string;
  processing_time_ms: number;
  engine_id?: number | null;
  engine_name?: string;
  adapter_type?: "internal" | "external_api" | "imported" | string;
  diagnostic_mode?: "white_box" | "black_box" | string;
  engine_version_label?: string;
  completeness_json?: {
    total_sent?: number;
    received_count?: number;
    evaluated_count?: number;
    missing_count?: number;
    duplicate_count?: number;
    unexpected_count?: number;
    invalid_count?: number;
    completeness_ratio?: number;
    has_risk_scores?: boolean;
    batch_count?: number;
    failed_requests?: number;
    api_errors?: string[];
  };
  external_config_json?: Record<string, unknown>;
  metrics_json: MetricsSummary;
  confusion_matrix_json: ConfusionMatrix;
  scenario_metrics_json: ScenarioMetric[];
  rule_impact_json: RuleImpact[];
  summary_text: string;
  created_at: string;
}

export interface DecisionTraceRule {
  rule_name: string;
  triggered: boolean;
  score_contribution: number | null;
  actual_value: number | string | null;
  threshold_value: number | string | null;
  metric_unit?: string | null;
  detail?: string | null;
}

export interface DecisionTrace {
  risk_score: number | null;
  decision_threshold: number | null;
  review_threshold?: number | null;
  decision: "allow" | "review" | "block" | string;
  predicted_label?: number;
  rules: DecisionTraceRule[];
}

export interface TriggeredRule {
  rule: string;
  contribution: number;
  [key: string]: unknown;
}

export interface ExperimentResultView {
  id: number;
  transaction_id: number;
  transaction_code: string;
  customer_code: string;
  recipient_code: string;
  amount_kzt: number;
  timestamp: string;
  scenario_type: string;
  split_name: string;
  risk_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  predicted_label: number;
  ground_truth_label: number;
  triggered_rules_json: TriggeredRule[];
  decision_trace_json?: DecisionTrace;
  decision_trace?: DecisionTrace;
  explanation: string;
}

export interface RecommendationItem {
  id?: number;
  target_rule: string;
  issue_category: string;
  severity: string;
  title: string;
  explanation: string;
  proposed_changes_json: Record<string, { old: unknown; new: unknown }>;
  expected_impact: string;
}

export interface AnalystReport {
  analysis_mode: string;
  summary: string;
  llm_narrative: string | null;
  weaknesses: Array<{
    scenario_type: string;
    issue_type: string;
    severity: string;
    recall?: number;
    false_negative_rate?: number;
    missed_count?: number;
    actual_risk_events?: number;
    avg_missed_risk_score?: number;
    false_positive_rate?: number;
    false_positive_count?: number;
    detail: string;
  }>;
  explainability: {
    false_negatives: {
      count: number;
      avg_risk_score: number;
      by_scenario: Record<string, number>;
      sample_codes: string[];
    };
    false_positives: {
      count: number;
      avg_risk_score: number;
      top_triggering_rules: Record<string, number>;
      sample_codes: string[];
    };
  };
  recommendations: RecommendationItem[];
  proposed_rules_config: Record<string, RuleConfig>;
  proposed_decision_threshold: number;
  limitations: string[];
}

export interface ExperimentDetailResponse {
  experiment: ExperimentSummary;
  results: ExperimentResultView[];
  total_results: number;
  page: number;
  page_size: number;
  recommendations: RecommendationItem[];
  analysis: AnalystReport;
}

export interface GuardrailsConfig {
  min_precision: number;
  max_fpr: number;
  max_fp_increase: number;
  min_recall_gain: number;
  max_changed_params: number;
  min_eval_risk_events?: number;
  min_eval_transactions?: number;
  max_shift_recall_drop?: number;
  max_shift_fpr_increase?: number;
}

export interface AdversarialShiftReport {
  status: "evaluated" | "unavailable" | string;
  passed: boolean;
  reason?: string;
  perturbation?: {
    amount_shift_pct?: number;
    time_shift_pct?: number;
    amount_range_pct?: string;
    time_range_pct?: string;
    transactions_count?: number;
    seed?: number;
  };
  baseline_shifted_metrics?: MetricsSummary;
  candidate_clean_metrics?: MetricsSummary;
  candidate_shifted_metrics?: MetricsSummary;
  recall_delta_vs_clean?: number;
  precision_delta_vs_clean?: number;
  f1_delta_vs_clean?: number;
  fpr_delta_vs_clean?: number;
  recall_gain_vs_baseline_shifted?: number;
}

export interface BlackBoxPolicyInfo {
  scope: "external_threshold_and_routing_only" | string;
  internal_rules_modified: boolean;
  has_risk_scores: boolean;
  routing_supported?: boolean;
  baseline_block_threshold?: number;
  recommended_block_threshold?: number;
  recommended_review_threshold?: number;
  routing_zones?: {
    allow?: string;
    review?: string;
    block?: string;
  };
  routing_counts?: {
    allow: number;
    review: number;
    block: number;
    total: number;
  };
  review_queue_share?: number;
  vendor_recommendations_count?: number;
  reason?: string;
}

export interface WhiteBoxPolicyInfo {
  scope: "internal_engine_parameters" | string;
  internal_rules_modified: boolean;
}

export interface EvolutionCandidate {
  key: string;
  name: string;
  strategy: string;
  description: string;
  changed_params: ParamChange[];
  changed_params_count: number;
  validation_metrics: MetricsSummary;
  validation_delta: Record<string, number>;
  validation_verdict: string;
  validation_assessment: string;
  validation_unfixed_weaknesses?: RemainingWeaknessItem[];
  guardrail_checks: Record<string, boolean>;
  rules_config: Record<string, RuleConfig>;
  decision_threshold: number;
}

export interface EvolutionComparisonSlice {
  baseline: MetricsSummary;
  candidate: MetricsSummary;
  delta: Record<string, number>;
}

export interface ScenarioComparisonItem {
  scenario_type: string;
  total_transactions?: number | null;
  actual_risk_events?: number | null;
  actual_legit_events?: number | null;
  baseline_recall: number | null;
  candidate_recall: number | null;
  recall_delta: number | null;
  baseline_precision?: number | null;
  candidate_precision?: number | null;
  baseline_f1?: number | null;
  candidate_f1?: number | null;
  f1_delta?: number | null;
  baseline_fpr: number | null;
  candidate_fpr: number | null;
  fpr_delta?: number | null;
  baseline_tp?: number | null;
  candidate_tp?: number | null;
  baseline_fn?: number | null;
  candidate_fn?: number | null;
  fn_delta?: number | null;
  baseline_fp?: number | null;
  candidate_fp?: number | null;
  fp_delta?: number | null;
}

export interface ExperimentTxDiffItem {
  transaction_code: string;
  scenario_type: string;
  amount_kzt: number;
  timestamp: string;
  ground_truth_label: number;
  old_decision: number;
  new_decision: number;
  old_risk_score: number | null;
  new_risk_score: number | null;
  old_triggered_rules: string[];
  new_triggered_rules: string[];
  explanation: string;
}

export interface ExperimentTxDiffResponse {
  baseline_experiment_id: number;
  candidate_experiment_id: number;
  split_name: string;
  summary: {
    matched_transactions: number;
    fixed_misses_count: number;
    new_false_positives_count: number;
    new_misses_count: number;
    fixed_false_positives_count: number;
  };
  fixed_misses: ExperimentTxDiffItem[];
  new_false_positives: ExperimentTxDiffItem[];
  new_misses: ExperimentTxDiffItem[];
  fixed_false_positives: ExperimentTxDiffItem[];
}

export interface EvolutionRun {
  id: number;
  baseline_experiment_id: number;
  baseline_config_id: number;
  candidate_config_id: number | null;
  validation_baseline_experiment_id: number | null;
  validation_candidate_experiment_id: number | null;
  final_baseline_experiment_id: number | null;
  final_candidate_experiment_id: number | null;
  weaknesses_json: AnalystReport["weaknesses"];
  recommendations_json: RecommendationItem[];
  candidates_json: EvolutionCandidate[];
  guardrails_json: {
    guardrails?: GuardrailsConfig;
    checks?: Record<string, boolean>;
    [key: string]: unknown;
  };
  selected_candidate_key: string;
  proposed_rules_config_json: Record<string, RuleConfig>;
  proposed_decision_threshold: number;
  changed_params_json: ParamChange[];
  comparison_json: {
    validation_split?: EvolutionComparisonSlice;
    evaluation_split?: EvolutionComparisonSlice;
    full_dataset?: EvolutionComparisonSlice;
    full_candidate_experiment_id?: number;
    scenario_comparison?: ScenarioComparisonItem[];
    scenario_audit?: ScenarioAudit;
    validation_unfixed_weaknesses?: RemainingWeaknessItem[];
    evaluation_remaining_weaknesses?: RemainingWeaknessItem[];
    guardrails?: GuardrailsConfig;
    baseline_version?: string;
    candidate_version?: string;
    selected_candidate_key?: string;
    selected_candidate_name?: string;
    guardrail_report?: {
      guardrails: GuardrailsConfig;
      checks: Record<string, boolean>;
    };
    adversarial_shift?: AdversarialShiftReport;
    analysis_mode?: string;
  };
  tradeoff_assessment: string;
  verdict: string;
  status: string;
  created_at: string;
}

export interface EvolutionHistoryItem {
  id: number;
  version: string;
  name: string;
  parent_version_id: number | null;
  parent_version: string | null;
  is_baseline: boolean;
  decision_threshold: number;
  changed_params: ParamChange[];
  validation_metrics: MetricsSummary | null;
  evaluation_metrics: MetricsSummary | null;
  verdict: string;
  recommendation_summary: string;
  evolution_run_id: number | null;
  created_at: string;
}

export interface SeriesStat {
  mean: number;
  median: number;
  min: number;
  max: number;
  std: number;
  ci95_low: number;
  ci95_high: number;
}

export interface BenchmarkAggregatedSlice {
  macro: {
    precision: SeriesStat;
    recall: SeriesStat;
    f1_score: SeriesStat;
    false_positive_rate: SeriesStat;
    false_negative_rate: SeriesStat;
    accuracy: SeriesStat;
    processing_time_ms: SeriesStat;
  };
  micro: MetricsSummary;
}

export interface BenchmarkSeedResult {
  seed: number;
  status: string;
  split_name: string;
  baseline: MetricsSummary;
  baseline_scenarios: ScenarioMetric[];
  candidate?: MetricsSummary | null;
  candidate_scenarios?: ScenarioMetric[] | null;
  delta?: Record<string, number> | null;
}

export interface ScenarioStabilityItem {
  scenario_type: string;
  baseline_recall: SeriesStat;
  baseline_precision: SeriesStat;
  baseline_f1: SeriesStat;
  baseline_fpr: SeriesStat;
  stability_status: "stable" | "moderate_variance" | "unstable";
  performance_tier: "strong" | "moderate" | "weak";
  candidate_recall?: SeriesStat;
  candidate_f1?: SeriesStat;
  candidate_fpr?: SeriesStat;
  candidate_stability_status?: string;
  recall_delta_mean?: number;
  f1_delta_mean?: number;
  fpr_delta_mean?: number;
}

export interface BenchmarkRun {
  id: number;
  name: string;
  transaction_count: number;
  customer_count: number;
  risk_ratio: number;
  seeds_json: number[];
  scenarios_json: string[];
  split_name: string;
  baseline_config_id: number;
  candidate_config_id: number | null;
  baseline_version?: string | null;
  candidate_version?: string | null;
  status: string;
  completed_runs: number;
  total_runs: number;
  per_seed_results_json: BenchmarkSeedResult[];
  aggregated_metrics_json: {
    successful_runs: number;
    failed_runs: number;
    aggregation_note: string;
    small_sample_warning: string;
    baseline: BenchmarkAggregatedSlice;
    candidate?: BenchmarkAggregatedSlice | null;
  };
  scenario_stability_json: ScenarioStabilityItem[];
  comparison_summary_json: {
    baseline_version: string;
    candidate_version?: string | null;
    macro_deltas?: Record<string, number>;
    micro_deltas?: Record<string, number>;
    seed_f1_wins?: number;
    seed_f1_ties?: number;
    seed_f1_losses?: number;
    verdict?: string;
  };
  created_at: string;
}

export interface TransactionInspectorItem {
  id?: number;
  transaction_id?: number;
  transaction_code: string;
  customer_code: string;
  recipient_code: string;
  amount_kzt: number;
  timestamp: string;
  transaction_type: string;
  channel: string;
  is_new_recipient: boolean;
  customer_segment: string;
  transaction_frequency: number;
  scenario_type: string;
  split_name: string;
  risk_score: number | null;
  score_available?: boolean;
  risk_level: string;
  decision_threshold: number;
  gap_to_threshold: number;
  triggered_rules: TriggeredRule[];
  decision_trace?: DecisionTrace;
  reason_codes?: string[];
  explanation: string;
  ground_truth_label: number;
  predicted_label: number;
  outcome: "TP" | "FP" | "FN" | "TN";
  diagnostic_note?: string;
  engine_name?: string;
  defense_version?: string;
}

export interface RiskDistributionBucket {
  range: string;
  min_score: number;
  max_score: number;
  legitimate: number;
  risky: number;
  detected: number;
  missed: number;
}

export interface TransactionInspectorPage {
  items: TransactionInspectorItem[];
  total: number;
  page: number;
  page_size: number;
  has_risk_scores: boolean;
}

export interface SecurityIntelligenceReport {
  experiment_id: number;
  experiment_name: string;
  defense_version: string | null;
  decision_threshold: number;
  compare_experiment_id: number | null;
  weakness_explorer: Array<{
    scenario_type: string;
    total_transactions: number;
    actual_risk_events: number;
    detected_risks: number;
    missed_risks: number;
    false_positives: number;
    recall: number;
    precision: number | null;
    precision_defined: boolean;
    f1_score: number;
    false_positive_rate: number;
    avg_risk_score: number;
    typical_error_causes: string[];
    version_delta?: {
      recall_delta: number;
      precision_delta: number;
      f1_delta: number;
      fpr_delta: number;
      fn_delta: number;
      fp_delta: number;
    } | null;
  }>;
  false_positive_analysis: {
    total_false_positives: number;
    false_positive_rate: number;
    avg_fp_risk_score: number;
    participating_rules: Array<{
      rule: string;
      fp_count: number;
      share_of_fps: number;
      avg_contribution: number;
      modified_in_current_version: boolean;
    }>;
    rule_combinations: Array<{ combination: string; count: number }>;
    by_scenario: Record<string, number>;
    configuration_correlation: string[];
  };
  false_negative_analysis: {
    total_false_negatives: number;
    false_negative_rate: number;
    avg_fn_risk_score: number;
    miss_categories: {
      near_threshold_misses: { count: number; description: string };
      partial_single_rule_misses: { count: number; description: string };
      untriggered_blind_spots: { count: number; description: string };
    };
    hardest_scenarios: Array<{
      scenario_type: string;
      actual_risk_events: number;
      missed_risks: number;
      recall: number;
      typical_error_causes: string[];
    }>;
  };
  transaction_inspector_samples: TransactionInspectorItem[];
  risk_score_distribution?: {
    available: boolean;
    buckets: RiskDistributionBucket[];
  };
  experiment_metadata?: {
    experiment_id: number;
    experiment_name: string;
    engine_name: string;
    defense_version: string;
    adapter_type: string;
    diagnostic_mode: string;
    supports_config: boolean;
    dataset_id: number;
    dataset_name: string | null;
    seed: number | null;
    dataset_transaction_count: number | null;
    customer_count: number | null;
    risk_ratio: number | null;
    split_name: string;
    scenarios: string[];
    created_at: string;
    processing_time_ms: number;
    completeness: ExperimentSummary["completeness_json"];
  };
  analyst: AnalystReport;
  reliability_report: {
    what_was_tested: string;
    covered_scenarios: string[];
    confirmed_weaknesses: string[];
    verified_improvements: string[];
    emerged_tradeoffs: string[];
    residual_risks: string[];
    experiment_limitations: string[];
  };
}

export interface DemoLaunchResponse {
  status: string;
  synthetic_disclaimer: string;
  dataset_id: number;
  baseline_experiment_id: number;
  candidate_experiment_id: number;
  evolution_run_id: number;
  candidate_config_id: number;
  verdict: string;
  tradeoff_assessment: string;
  baseline_metrics: MetricsSummary;
  evaluation_comparison: EvolutionComparisonSlice;
}

export interface OverviewResponse {
  total_experiments: number;
  total_datasets: number;
  total_defense_configs: number;
  total_evolutions: number;
  total_benchmarks: number;
  confirmed_improvements_count: number;
  active_defense_version: string | null;
  last_experiment: ExperimentSummary | null;
  total_transactions_tested: number;
  total_risk_detected: number;
  total_risk_missed: number;
  total_false_positives: number;
  current_metrics: Partial<MetricsSummary>;
  weakest_scenarios: ScenarioMetric[];
  recent_experiments: ExperimentSummary[];
  llm_enabled: boolean;
}

export interface AntifraudEngineView {
  id: number;
  code: string;
  name: string;
  adapter_type: "internal" | "external_api" | "imported" | string;
  diagnostic_mode: "white_box" | "black_box" | string;
  supports_config: boolean;
  base_url: string | null;
  protocol_version: string;
  active_profile: string;
  description: string;
  is_builtin: boolean;
  online: boolean;
  engine_version?: string | null;
  status_error?: string | null;
}

export interface ExternalWeaknessItem {
  scenario_type: string;
  issue_type: string;
  severity: string;
  title: string;
  error_count: number;
  actual_risk_events: number;
  sample_transaction_codes: string[];
  explanation: string;
  recommended_check: string;
}

export interface ExternalEvolutionRun {
  id: number;
  engine_id: number;
  baseline_experiment_id: number;
  candidate_experiment_id: number | null;
  mode: "configurable_white_box" | "black_box_manual" | string;
  baseline_label: string;
  candidate_label: string;
  baseline_config_snapshot_json: Record<string, unknown>;
  proposed_config_json: Record<string, unknown>;
  candidates_json: Array<{
    key: string;
    name: string;
    override: Record<string, unknown>;
    param_details?: ExternalParamDetail[];
    validation_metrics: MetricsSummary;
    validation_delta: Record<string, number>;
    validation_verdict: string;
    validation_assessment?: string;
    validation_unfixed_weaknesses?: RemainingWeaknessItem[];
    guardrail_checks: Record<string, boolean>;
  }>;
  weaknesses_json: ExternalWeaknessItem[];
  recommendations_json: RecommendationItem[];
  comparison_json: {
    baseline_version?: string;
    candidate_version?: string;
    selected_candidate_key?: string;
    selected_candidate_name?: string;
    final_baseline_experiment_id?: number;
    final_candidate_experiment_id?: number;
    validation_split?: EvolutionComparisonSlice;
    evaluation_split?: EvolutionComparisonSlice;
    scenario_comparison?: ScenarioComparisonItem[];
    scenario_audit?: ScenarioAudit;
    param_details?: ExternalParamDetail[];
    validation_unfixed_weaknesses?: RemainingWeaknessItem[];
    evaluation_remaining_weaknesses?: RemainingWeaknessItem[];
    guardrails?: GuardrailsConfig;
    guardrail_report?: {
      guardrails: GuardrailsConfig;
      checks: Record<string, boolean>;
    };
    adversarial_shift?: AdversarialShiftReport;
    black_box_policy?: BlackBoxPolicyInfo;
    white_box_policy?: WhiteBoxPolicyInfo;
    failed_transactions?: Array<{
      transaction_code: string;
      scenario_type: string;
      outcome: string;
      amount_kzt: number;
    }>;
  };
  verdict: string;
  tradeoff_assessment: string;
  status: string;
  created_at: string;
}

export interface EngineComparison {
  id: number;
  name: string;
  dataset_id: number;
  split_name: string;
  left_experiment_id: number;
  right_experiment_id: number;
  comparison_json: {
    left: {
      experiment_id: number;
      engine_name: string;
      version: string;
      metrics: MetricsSummary;
      completeness?: Record<string, unknown>;
    };
    right: {
      experiment_id: number;
      engine_name: string;
      version: string;
      metrics: MetricsSummary;
      completeness?: Record<string, unknown>;
    };
    scenario_comparison: Array<{
      scenario_type: string;
      left_recall: number;
      right_recall: number;
      left_fpr: number;
      right_fpr: number;
    }>;
    recall_diff_pp: number;
    fpr_diff_pp: number;
  };
  summary_text: string;
  created_at: string;
}
