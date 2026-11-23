import type {
  AntifraudEngineView,
  BenchmarkRun,
  DatasetDetailResponse,
  DatasetSummary,
  DefenseConfig,
  DemoLaunchResponse,
  EngineComparison,
  EvolutionHistoryItem,
  EvolutionRun,
  ExperimentDetailResponse,
  ExperimentSummary,
  ExternalEvolutionRun,
  ExperimentTxDiffResponse,
  GuardrailsConfig,
  HealthResponse,
  OverviewResponse,
  RuleConfig,
  ScenarioInfo,
  SecurityIntelligenceReport,
  TransactionInspectorItem,
  TransactionInspectorPage,
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body?.detail)) {
        message = body.detail
          .map((d: { msg?: string }) => d.msg || JSON.stringify(d))
          .join("; ");
      }
    } catch {
      // ignore json parse failure
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  overview: () => request<OverviewResponse>("/api/overview"),
  scenarios: () => request<ScenarioInfo[]>("/api/scenarios"),

  listDatasets: () => request<DatasetSummary[]>("/api/datasets"),
  generateDataset: (payload: {
    name: string;
    description?: string;
    transaction_count: number;
    customer_count: number;
    risk_ratio: number;
    scenarios: string[];
    seed: number;
  }) =>
    request<DatasetSummary>("/api/datasets/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getDataset: (id: number, page = 1, pageSize = 50) =>
    request<DatasetDetailResponse>(`/api/datasets/${id}?page=${page}&page_size=${pageSize}`),

  listDefenseConfigs: () => request<DefenseConfig[]>("/api/defense/configurations"),
  createDefenseConfig: (payload: {
    name: string;
    version?: string;
    description?: string;
    parent_version_id?: number | null;
    decision_threshold: number;
    risk_levels: { low_max: number; medium_max: number; high_max: number };
    rules_config: Record<string, RuleConfig>;
  }) =>
    request<DefenseConfig>("/api/defense/configurations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listExperiments: (includeInternal = false) =>
    request<ExperimentSummary[]>(`/api/experiments?include_internal=${includeInternal}`),
  runExperiment: (payload: {
    name: string;
    dataset_id: number;
    defense_config_id: number;
    split_name: "all" | "calibration" | "validation" | "evaluation";
    scenarios?: string[];
  }) =>
    request<ExperimentSummary>("/api/experiments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getExperimentDetail: (
    id: number,
    params?: {
      page?: number;
      page_size?: number;
      risk_level?: string;
      predicted_label?: string;
      scenario_type?: string;
      outcome?: string;
    }
  ) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.page_size) qs.set("page_size", String(params.page_size));
    if (params?.risk_level) qs.set("risk_level", params.risk_level);
    if (params?.predicted_label !== undefined && params.predicted_label !== "") {
      qs.set("predicted_label", params.predicted_label);
    }
    if (params?.scenario_type) qs.set("scenario_type", params.scenario_type);
    if (params?.outcome) qs.set("outcome", params.outcome);
    return request<ExperimentDetailResponse>(`/api/experiments/${id}?${qs.toString()}`);
  },

  analyzeEvolution: (experiment_id: number, guardrails?: GuardrailsConfig) =>
    request<EvolutionRun>("/api/evolution/analyze", {
      method: "POST",
      body: JSON.stringify({ experiment_id, guardrails }),
    }),
  validateEvolution: (payload: {
    evolution_run_id: number;
    candidate_key?: string;
    candidate_name?: string;
    custom_rules_config?: Record<string, RuleConfig>;
    custom_decision_threshold?: number;
    guardrails?: GuardrailsConfig;
  }) =>
    request<EvolutionRun>("/api/evolution/validate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listEvolutionRuns: () => request<EvolutionRun[]>("/api/evolution/runs"),
  getEvolutionDiff: (runId: number) =>
    request<ExperimentTxDiffResponse>(`/api/evolution/runs/${runId}/diff`),
  getEvolutionHistory: () => request<EvolutionHistoryItem[]>("/api/evolution/history"),

  runBenchmark: (payload: {
    name: string;
    transaction_count: number;
    customer_count: number;
    risk_ratio: number;
    seeds: number[];
    scenarios: string[];
    split_name: "evaluation" | "validation" | "all";
    baseline_config_id: number;
    candidate_config_id?: number | null;
  }) =>
    request<BenchmarkRun>("/api/benchmarks/run", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listBenchmarks: () => request<BenchmarkRun[]>("/api/benchmarks"),
  getBenchmark: (id: number) => request<BenchmarkRun>(`/api/benchmarks/${id}`),
  benchmarkExportUrl: (id: number, format: "json" | "csv") =>
    `${API_BASE}/api/benchmarks/${id}/export?format=${format}`,

  getSecurityIntelligence: (experimentId: number, compareExperimentId?: number | null) => {
    const qs = compareExperimentId ? `?compare_experiment_id=${compareExperimentId}` : "";
    return request<SecurityIntelligenceReport>(`/api/intelligence/${experimentId}${qs}`);
  },
  inspectTransaction: (experimentId: number, transactionCode: string) =>
    request<TransactionInspectorItem>(
      `/api/intelligence/${experimentId}/transactions/${encodeURIComponent(transactionCode)}`
    ),
  listInspectorTransactions: (
    experimentId: number,
    params?: {
      page?: number;
      page_size?: number;
      outcome?: string;
      scenario_type?: string;
      search?: string;
    }
  ) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.page_size) qs.set("page_size", String(params.page_size));
    if (params?.outcome && params.outcome !== "all") qs.set("outcome", params.outcome);
    if (params?.scenario_type && params.scenario_type !== "all") {
      qs.set("scenario_type", params.scenario_type);
    }
    if (params?.search && params.search.trim()) qs.set("search", params.search.trim());
    return request<TransactionInspectorPage>(
      `/api/intelligence/${experimentId}/transactions?${qs.toString()}`
    );
  },

  getReport: (experimentId: number) =>
    request<Record<string, unknown>>(`/api/reports/${experimentId}`),
  exportUrl: (experimentId: number, format: "json" | "csv" | "html") =>
    `${API_BASE}/api/reports/${experimentId}/export?format=${format}`,

  launchDemo: () =>
    request<DemoLaunchResponse>("/api/demo/launch", {
      method: "POST",
    }),
  resetDemo: () =>
    request<Record<string, unknown>>("/api/demo/reset", {
      method: "POST",
    }),

  listExternalEngines: () => request<AntifraudEngineView[]>("/api/external/engines"),
  runExternalExperiment: (payload: {
    engine_id: number;
    dataset_id: number;
    name?: string;
    split_name: "all" | "calibration" | "validation" | "evaluation";
    profile?: "baseline" | "candidate" | "updated";
  }) =>
    request<ExperimentSummary>("/api/external/experiments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importExternalPredictions: (payload: {
    engine_id?: number;
    dataset_id: number;
    name?: string;
    version_label: string;
    file_format: "csv" | "json";
    content: string;
    split_name: "all" | "calibration" | "validation" | "evaluation";
  }) =>
    request<ExperimentSummary>("/api/external/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  analyzeExternalEvolution: (experiment_id: number) =>
    request<ExternalEvolutionRun>("/api/external/evolution/analyze", {
      method: "POST",
      body: JSON.stringify({ experiment_id }),
    }),
  validateExternalEvolution: (payload: {
    evolution_run_id: number;
    candidate_key?: string;
  }) =>
    request<ExternalEvolutionRun>("/api/external/evolution/validate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getExternalEvolutionDiff: (runId: number) =>
    request<ExperimentTxDiffResponse>(`/api/external/evolution/${runId}/diff`),
  startExternalEvolution: (experiment_id: number) =>
    request<ExternalEvolutionRun>("/api/external/evolution", {
      method: "POST",
      body: JSON.stringify({ experiment_id }),
    }),
  retestExternalBlackBox: (payload: {
    evolution_run_id: number;
    file_format?: "csv" | "json";
    content?: string;
    version_label?: string;
    profile?: "baseline" | "candidate" | "updated";
  }) =>
    request<ExternalEvolutionRun>("/api/external/evolution/retest", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listExternalEvolutions: () => request<ExternalEvolutionRun[]>("/api/external/evolution"),
  compareEngines: (payload: {
    dataset_id: number;
    split_name: "all" | "calibration" | "validation" | "evaluation";
    left_engine_id?: number;
    right_engine_id?: number;
    left_experiment_id?: number;
    right_experiment_id?: number;
  }) =>
    request<EngineComparison>("/api/external/compare", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listEngineComparisons: () => request<EngineComparison[]>("/api/external/compare"),
};
