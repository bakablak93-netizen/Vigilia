import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AnalyticsTab } from "../components/unified/AnalyticsDrawer";
import type { ImprovementLifecyclePhase } from "../components/unified/VigiliaConclusionCard";
import type { RankedWeaknessItem } from "../components/unified/WorkspaceResultsBlock";
import type { WorkspaceNavSectionId } from "../components/v4/WorkspaceSidebar";
import { useLab } from "../context/LabContext";
import type {
  BenchmarkRun,
  EvolutionRun,
  ExperimentSummary,
  ExternalEvolutionRun,
  SecurityIntelligenceReport,
} from "../types/api";

export type WorkspaceStage = "idle" | "testing" | "results" | "comparison";
export type TestingPhase = "preparing" | "running" | "analyzing";
export type ValidatingPhase = "eval_base" | "eval_cand" | "diffing" | null;

export interface PersistedWorkspaceSession {
  stage: "results" | "comparison";
  experimentId: number;
  evolutionRunId: number | null;
  externalEvolutionRunId: number | null;
  candidateKey?: string | null;
  phase?: ImprovementLifecyclePhase | null;
}

export interface WorkspaceErrorState {
  message: string;
  returnStage: "idle" | "results";
}

export const FOCUS_SESSION_KEY = "vigilia_focus_session_v1";
const WORKSPACE_URL_KEYS = ["exp", "evo", "ext_evo", "phase", "cand"] as const;

export const ALL_SCENARIOS = [
  "normal_activity",
  "unusual_amount",
  "new_recipient_risk",
  "duplicate_payment",
  "suspicious_sequence",
  "structuring_smurfing",
  "account_takeover_ato",
];

function readPersistedSession(): PersistedWorkspaceSession | null {
  try {
    const raw = sessionStorage.getItem(FOCUS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceSession>;
    if (
      (parsed.stage === "results" || parsed.stage === "comparison") &&
      typeof parsed.experimentId === "number" &&
      parsed.experimentId > 0
    ) {
      return {
        stage: parsed.stage,
        experimentId: parsed.experimentId,
        evolutionRunId:
          typeof parsed.evolutionRunId === "number" ? parsed.evolutionRunId : null,
        externalEvolutionRunId:
          typeof parsed.externalEvolutionRunId === "number"
            ? parsed.externalEvolutionRunId
            : null,
        candidateKey:
          typeof parsed.candidateKey === "string" ? parsed.candidateKey : null,
        phase: parsed.phase ?? null,
      };
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writePersistedSession(session: PersistedWorkspaceSession | null): void {
  try {
    if (!session) {
      sessionStorage.removeItem(FOCUS_SESSION_KEY);
    } else {
      sessionStorage.setItem(FOCUS_SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore storage errors
  }
}

function readInitialWorkspaceSession(
  params: URLSearchParams
): PersistedWorkspaceSession | null {
  const expParam = Number(params.get("exp"));
  if (Number.isFinite(expParam) && expParam > 0) {
    const evoParam = Number(params.get("evo"));
    const extEvoParam = Number(params.get("ext_evo"));
    const rawPhase = params.get("phase") as ImprovementLifecyclePhase | null;
    const candParam = params.get("cand");
    const isComparison = rawPhase === "COMPARISON_AVAILABLE";
    return {
      stage: isComparison ? "comparison" : "results",
      experimentId: expParam,
      evolutionRunId: Number.isFinite(evoParam) && evoParam > 0 ? evoParam : null,
      externalEvolutionRunId:
        Number.isFinite(extEvoParam) && extEvoParam > 0 ? extEvoParam : null,
      candidateKey: candParam || null,
      phase: rawPhase || null,
    };
  }
  return readPersistedSession();
}

function buildTopWeaknesses(
  intelligence: SecurityIntelligenceReport | null,
  isBlackBox: boolean,
  lang: string,
  problemTitles: Record<string, string>,
  scenarioLabel: (key: string) => string
): RankedWeaknessItem[] {
  if (!intelligence) return [];
  const items: RankedWeaknessItem[] = [];

  for (const row of intelligence.weakness_explorer) {
    if (row.actual_risk_events > 0 && row.missed_risks > 0) {
      const reliability = Math.min(1, row.actual_risk_events / 8);
      const importanceScore =
        (row.missed_risks * 3.0 + (1 - row.recall) * 12.0) * reliability;
      const severity: RankedWeaknessItem["severity"] =
        row.recall < 0.45 ? "critical" : row.recall < 0.72 ? "high" : "medium";
      const title = problemTitles[row.scenario_type] || scenarioLabel(row.scenario_type);

      let explanation: string;
      if (isBlackBox) {
        explanation =
          lang === "en"
            ? `Missed ${row.missed_risks} of ${row.actual_risk_events} threats (detected ${(row.recall * 100).toFixed(1)}%). Hypothesis: external rules or thresholds did not flag this pattern.`
            : lang === "kk"
              ? `${row.actual_risk_events} қауіптің ${row.missed_risks} өткізіп алынды (анықтау ${(row.recall * 100).toFixed(1)}%). Болжам: сыртқы жүйе бұл үлгіні бұғаттамады.`
              : `Пропущено ${row.missed_risks} из ${row.actual_risk_events} угроз (выявлено ${(row.recall * 100).toFixed(1)}%). Гипотеза: внешняя система не распознала данный паттерн.`;
      } else {
        explanation =
          lang === "en"
            ? `Missed ${row.missed_risks} of ${row.actual_risk_events} threats (detected ${(row.recall * 100).toFixed(1)}%), as risk scores remained below the block threshold.`
            : lang === "kk"
              ? `${row.actual_risk_events} қауіптің ${row.missed_risks} өткізіп алынды (анықтау ${(row.recall * 100).toFixed(1)}%), себебі тәуекел балы бұғаттау шегінен төмен болды.`
              : `Пропущено ${row.missed_risks} из ${row.actual_risk_events} угроз (выявлено ${(row.recall * 100).toFixed(1)}%), так как балл риска не достиг порога блокировки.`;
      }

      items.push({
        id: `fn-${row.scenario_type}`,
        scenarioType: row.scenario_type,
        title,
        explanation,
        severity,
        missedCount: row.missed_risks,
        importanceScore,
      });
    }

    if (row.false_positives >= 2 || row.false_positive_rate > 0.015) {
      const importanceScore =
        row.false_positives * 2.5 + row.false_positive_rate * 100;
      const severity: RankedWeaknessItem["severity"] =
        row.false_positive_rate > 0.03 ? "high" : "medium";
      const title = problemTitles.false_positives || scenarioLabel(row.scenario_type);
      const explanation =
        lang === "en"
          ? `Falsely blocked ${row.false_positives} legitimate operations in «${scenarioLabel(row.scenario_type)}» (${(row.false_positive_rate * 100).toFixed(2)}%).`
          : lang === "kk"
            ? `«${scenarioLabel(row.scenario_type)}» сценарийінде ${row.false_positives} заңды операция қате бұғатталды (${(row.false_positive_rate * 100).toFixed(2)}%).`
            : `В сценарии «${scenarioLabel(row.scenario_type)}» ошибочно остановлено ${row.false_positives} законных операций (${(row.false_positive_rate * 100).toFixed(2)}%).`;

      items.push({
        id: `fp-${row.scenario_type}`,
        scenarioType: row.scenario_type,
        title,
        explanation,
        severity,
        missedCount: row.false_positives,
        importanceScore,
      });
    }
  }

  return items.sort((a, b) => b.importanceScore - a.importanceScore);
}

/**
 * Custom hook owning the VIGILIA Improvement-First state machine, React Query
 * orchestration, F5 hydration guards, and URL / sessionStorage sync.
 */
export function useDefenseWorkflow() {
  const {
    t,
    lang,
    setLang,
    bgAnimationEnabled,
    scenarioLabel,
    defaultSimParams,
    selectedExperimentId,
    setSelectedExperimentId,
    selectedDatasetId,
    setSelectedDatasetId,
  } = useLab();

  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSessionRef = useRef<PersistedWorkspaceSession | null>(
    readInitialWorkspaceSession(searchParams)
  );
  const initialExpHydratedRef = useRef<boolean>(
    !initialSessionRef.current?.experimentId
  );
  const [isRestoringEvolution, setIsRestoringEvolution] = useState<boolean>(
    Boolean(
      initialSessionRef.current?.evolutionRunId ||
        initialSessionRef.current?.externalEvolutionRunId
    )
  );

  const [stage, setStage] = useState<WorkspaceStage>(
    initialSessionRef.current?.stage ?? "idle"
  );
  const [testingPhase, setTestingPhase] = useState<TestingPhase>("preparing");
  const [testingDatasetLabel, setTestingDatasetLabel] = useState<string>("");
  const [testingElapsedMs, setTestingElapsedMs] = useState<number>(0);
  const testingStartRef = useRef<number | null>(null);

  const [errorState, setErrorState] = useState<WorkspaceErrorState | null>(null);
  const [sec1Expanded, setSec1Expanded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeNavSection, setActiveNavSection] =
    useState<WorkspaceNavSectionId>("sec-overview");

  const [selectedEngineCode, setSelectedEngineCode] =
    useState<string>("internal_vigilia");
  const [externalProfile, setExternalProfile] = useState<
    "baseline" | "candidate" | "updated"
  >("baseline");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importContent, setImportContent] = useState<string>("");
  const [importVersionLabel, setImportVersionLabel] =
    useState<string>("Imported v1");

  const [retestFormat, setRetestFormat] = useState<"csv" | "json">("csv");
  const [retestContent, setRetestContent] = useState<string>("");
  const [retestVersionLabel, setRetestVersionLabel] =
    useState<string>("Updated v2");

  const [selectedDefenseId, setSelectedDefenseId] = useState<number | "">("");
  const [txCount, setTxCount] = useState<number>(
    defaultSimParams.transaction_count
  );
  const [seed, setSeed] = useState<number>(defaultSimParams.seed);
  const [splitName, setSplitName] = useState<
    "all" | "calibration" | "validation" | "evaluation"
  >("all");

  const [paramsOpen, setParamsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>("overview");
  const [analyticsTxCode, setAnalyticsTxCode] = useState<string | null>(null);
  const [analyticsInspectorExpId, setAnalyticsInspectorExpId] = useState<
    number | null
  >(null);

  const [activeEvolution, setActiveEvolution] = useState<EvolutionRun | null>(
    null
  );
  const [activeExternalEvolution, setActiveExternalEvolution] =
    useState<ExternalEvolutionRun | null>(null);
  const [improvementRequested, setImprovementRequested] = useState(false);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<
    string | null
  >(initialSessionRef.current?.candidateKey ?? null);
  const [validatingPhase, setValidatingPhase] =
    useState<ValidatingPhase>(null);
  const [activeBenchmark, setActiveBenchmark] = useState<BenchmarkRun | null>(
    null
  );

  // Sync saved experimentId once on F5 restore
  useEffect(() => {
    const saved = initialSessionRef.current;
    if (saved && selectedExperimentId === null) {
      setSelectedExperimentId(saved.experimentId);
    }
  }, [selectedExperimentId, setSelectedExperimentId]);

  // Testing stopwatch
  useEffect(() => {
    if (stage !== "testing") {
      testingStartRef.current = null;
      return;
    }
    testingStartRef.current = performance.now();
    setTestingElapsedMs(0);
    const id = window.setInterval(() => {
      if (testingStartRef.current !== null) {
        setTestingElapsedMs(performance.now() - testingStartRef.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [stage]);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30000,
    retry: 1,
  });
  const enginesQuery = useQuery({
    queryKey: ["externalEngines"],
    queryFn: api.listExternalEngines,
    refetchInterval: 30000,
    retry: 1,
  });
  const configsQuery = useQuery({
    queryKey: ["defenseConfigs"],
    queryFn: api.listDefenseConfigs,
  });
  const datasetsQuery = useQuery({
    queryKey: ["datasets"],
    queryFn: api.listDatasets,
  });
  const experimentsQuery = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.listExperiments(false),
  });
  const evoRunsQuery = useQuery({
    queryKey: ["evolutionRuns"],
    queryFn: api.listEvolutionRuns,
  });
  const extEvoRunsQuery = useQuery({
    queryKey: ["externalEvolutions"],
    queryFn: api.listExternalEvolutions,
  });
  const benchmarksQuery = useQuery({
    queryKey: ["benchmarks"],
    queryFn: api.listBenchmarks,
  });

  // Panel query param opener without overwriting workspace params
  useEffect(() => {
    const panel = searchParams.get("panel");
    if (!panel) return;
    if (panel === "history") {
      setHistoryOpen(true);
    } else if (panel === "settings") {
      setSettingsOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("panel");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Select baseline config once loaded
  useEffect(() => {
    const cfgs = configsQuery.data || [];
    if (selectedDefenseId === "" && cfgs.length > 0) {
      const base = cfgs.find((c) => c.is_baseline) || cfgs[0];
      setSelectedDefenseId(base.id);
    }
  }, [configsQuery.data, selectedDefenseId]);

  const activeExpQuery = useQuery({
    queryKey: ["experimentDetailUnified", selectedExperimentId],
    queryFn: () =>
      api.getExperimentDetail(selectedExperimentId!, { page: 1, page_size: 10 }),
    enabled:
      selectedExperimentId !== null && stage !== "idle" && stage !== "testing",
    retry: 1,
  });

  const intelligenceQuery = useQuery({
    queryKey: ["securityIntelligenceUnified", selectedExperimentId],
    queryFn: () => api.getSecurityIntelligence(selectedExperimentId!),
    enabled:
      selectedExperimentId !== null && stage !== "idle" && stage !== "testing",
    retry: 1,
  });

  useEffect(() => {
    if (activeExpQuery.data?.experiment) {
      initialExpHydratedRef.current = true;
    }
  }, [activeExpQuery.data]);

  // F5 hydration effect: strictly waits while evolution / externalEvolution queries are fetching
  useEffect(() => {
    if (!isRestoringEvolution || !selectedExperimentId) return;
    const saved = initialSessionRef.current;
    if (!saved) {
      setIsRestoringEvolution(false);
      return;
    }

    if (saved.evolutionRunId && evoRunsQuery.data) {
      const foundInt = evoRunsQuery.data.find(
        (e) => e.id === saved.evolutionRunId
      );
      if (foundInt) {
        setActiveEvolution(foundInt);
        setSelectedCandidateKey(
          saved.candidateKey || foundInt.selected_candidate_key || null
        );
        setImprovementRequested(true);
        if (foundInt.status === "completed") setStage("comparison");
        setIsRestoringEvolution(false);
        return;
      }
    }

    if (saved.externalEvolutionRunId && extEvoRunsQuery.data) {
      const foundExt = extEvoRunsQuery.data.find(
        (e) => e.id === saved.externalEvolutionRunId
      );
      if (foundExt) {
        setActiveExternalEvolution(foundExt);
        setSelectedCandidateKey(
          saved.candidateKey ||
            foundExt.comparison_json?.selected_candidate_key ||
            null
        );
        setImprovementRequested(true);
        if (foundExt.status === "completed") setStage("comparison");
        setIsRestoringEvolution(false);
        return;
      }
    }

    const queriesStillLoading =
      evoRunsQuery.isLoading ||
      evoRunsQuery.isFetching ||
      extEvoRunsQuery.isLoading ||
      extEvoRunsQuery.isFetching;

    if (
      !queriesStillLoading &&
      evoRunsQuery.isFetched &&
      extEvoRunsQuery.isFetched
    ) {
      setIsRestoringEvolution(false);
      if (stage === "comparison" && !activeEvolution && !activeExternalEvolution) {
        setStage("results");
      }
    }
  }, [
    isRestoringEvolution,
    selectedExperimentId,
    evoRunsQuery.data,
    evoRunsQuery.isLoading,
    evoRunsQuery.isFetching,
    evoRunsQuery.isFetched,
    extEvoRunsQuery.data,
    extEvoRunsQuery.isLoading,
    extEvoRunsQuery.isFetching,
    extEvoRunsQuery.isFetched,
    activeEvolution,
    activeExternalEvolution,
    stage,
  ]);

  const isInternalDiffReady = Boolean(
    activeEvolution &&
      activeEvolution.status === "completed" &&
      activeEvolution.final_baseline_experiment_id &&
      activeEvolution.final_candidate_experiment_id
  );
  const isExternalDiffReady = Boolean(
    activeExternalEvolution &&
      activeExternalEvolution.status === "completed" &&
      (activeExternalEvolution.comparison_json?.final_baseline_experiment_id ||
        activeExternalEvolution.candidate_experiment_id)
  );

  const internalDiffQuery = useQuery({
    queryKey: ["evolutionDiff", activeEvolution?.id],
    queryFn: () => api.getEvolutionDiff(activeEvolution!.id),
    enabled: isInternalDiffReady,
    retry: 1,
  });

  const externalDiffQuery = useQuery({
    queryKey: ["externalEvolutionDiff", activeExternalEvolution?.id],
    queryFn: () => api.getExternalEvolutionDiff(activeExternalEvolution!.id),
    enabled: isExternalDiffReady,
    retry: 1,
  });

  // Reset gracefully ONLY if experiment permanently errored (not during loading/fetching)
  useEffect(() => {
    if (
      (stage === "results" || stage === "comparison") &&
      selectedExperimentId !== null &&
      !activeExpQuery.isLoading &&
      !activeExpQuery.isFetching &&
      activeExpQuery.isError
    ) {
      initialSessionRef.current = null;
      initialExpHydratedRef.current = true;
      setIsRestoringEvolution(false);
      writePersistedSession(null);
      setSelectedExperimentId(null);
      setActiveEvolution(null);
      setActiveExternalEvolution(null);
      setStage("idle");
    }
  }, [
    stage,
    selectedExperimentId,
    activeExpQuery.isLoading,
    activeExpQuery.isFetching,
    activeExpQuery.isError,
    setSelectedExperimentId,
  ]);

  const engines = enginesQuery.data || [];
  const selectedEngine = engines.find((e) => e.code === selectedEngineCode);
  const externalBEngine = engines.find((e) => e.code === "external_b");

  const analyzeMutation = useMutation({
    mutationFn: async (exp: ExperimentSummary) => {
      if (exp.adapter_type && exp.adapter_type !== "internal") {
        const extEvo = await api.analyzeExternalEvolution(exp.id);
        return { kind: "external" as const, extEvo, expId: exp.id };
      }
      const intEvo = await api.analyzeEvolution(exp.id);
      return { kind: "internal" as const, intEvo, expId: exp.id };
    },
    onSuccess: (res) => {
      initialSessionRef.current = null;
      setIsRestoringEvolution(false);
      if (res.kind === "external") {
        setActiveEvolution(null);
        setActiveExternalEvolution(res.extEvo);
        const key = res.extEvo.comparison_json?.selected_candidate_key || null;
        setSelectedCandidateKey(key);
        writePersistedSession({
          stage: "results",
          experimentId: res.expId,
          evolutionRunId: null,
          externalEvolutionRunId: res.extEvo.id,
          candidateKey: key,
          phase: "CANDIDATE_READY",
        });
        queryClient.invalidateQueries({ queryKey: ["externalEvolutions"] });
      } else {
        setActiveExternalEvolution(null);
        setActiveEvolution(res.intEvo);
        const key = res.intEvo.selected_candidate_key || "D";
        setSelectedCandidateKey(key);
        writePersistedSession({
          stage: "results",
          experimentId: res.expId,
          evolutionRunId: res.intEvo.id,
          externalEvolutionRunId: null,
          candidateKey: key,
          phase: "CANDIDATE_READY",
        });
        queryClient.invalidateQueries({ queryKey: ["evolutionRuns"] });
      }
    },
    onError: (err: Error) => {
      setErrorState({
        message: err.message,
        returnStage: "results",
      });
    },
  });

  const runCheckMutation = useMutation({
    mutationFn: async () => {
      setErrorState(null);
      setSec1Expanded(false);
      setActiveEvolution(null);
      setActiveExternalEvolution(null);
      setSelectedCandidateKey(null);
      setImprovementRequested(false);
      setStage("testing");

      const currentDatasets = datasetsQuery.data || [];
      let targetDatasetId = selectedDatasetId;
      let targetDatasetName = `Synthetic (${txCount} tx · seed=${seed})`;

      if (targetDatasetId !== null) {
        const chosenDs = currentDatasets.find((d) => d.id === targetDatasetId);
        if (
          !chosenDs ||
          chosenDs.transaction_count !== txCount ||
          chosenDs.seed !== seed
        ) {
          targetDatasetId = null;
        } else {
          targetDatasetName = chosenDs.name;
        }
      }

      if (targetDatasetId === null) {
        const matchingDs = currentDatasets.find(
          (d) => d.transaction_count === txCount && d.seed === seed
        );
        if (matchingDs) {
          targetDatasetId = matchingDs.id;
          targetDatasetName = matchingDs.name;
        } else {
          setTestingPhase("preparing");
          setTestingDatasetLabel(targetDatasetName);
          const created = await api.generateDataset({
            name: `Синтетический набор (${txCount} tx · seed=${seed})`,
            transaction_count: txCount,
            customer_count: Math.max(20, Math.min(2000, Math.round(txCount / 10))),
            risk_ratio: defaultSimParams.risk_ratio,
            scenarios: ALL_SCENARIOS,
            seed,
          });
          targetDatasetId = created.id;
          targetDatasetName = created.name;
          setSelectedDatasetId(created.id);
        }
      }

      setTestingDatasetLabel(targetDatasetName);
      setTestingPhase("running");
      let exp: ExperimentSummary;

      if (selectedEngine && selectedEngine.adapter_type === "external_api") {
        exp = await api.runExternalExperiment({
          engine_id: selectedEngine.id,
          dataset_id: targetDatasetId,
          split_name: splitName,
          profile: externalProfile,
        });
      } else if (selectedEngine && selectedEngine.adapter_type === "imported") {
        if (!importContent.trim()) {
          throw new Error(t.ext.importMissingAlert);
        }
        exp = await api.importExternalPredictions({
          engine_id: selectedEngine.id,
          dataset_id: targetDatasetId,
          version_label: importVersionLabel || "Imported v1",
          file_format: importFormat,
          content: importContent,
          split_name: splitName,
        });
      } else {
        const cfgs = configsQuery.data || [];
        const baseCfg = cfgs.find((c) => c.is_baseline) || cfgs[0];
        const defId =
          selectedDefenseId !== "" ? Number(selectedDefenseId) : baseCfg?.id;
        if (!defId) {
          throw new Error("Defense configuration not found");
        }
        const chosenCfg = cfgs.find((c) => c.id === defId);
        exp = await api.runExperiment({
          name: `Проверка защиты (${chosenCfg?.version || `#${defId}`})`,
          dataset_id: targetDatasetId,
          defense_config_id: defId,
          split_name: splitName,
        });
      }

      setTestingPhase("analyzing");
      const intel = await api.getSecurityIntelligence(exp.id);
      queryClient.setQueryData(["securityIntelligenceUnified", exp.id], intel);

      return exp;
    },
    onSuccess: (exp: ExperimentSummary) => {
      initialSessionRef.current = null;
      initialExpHydratedRef.current = true;
      setIsRestoringEvolution(false);
      setActiveEvolution(null);
      setActiveExternalEvolution(null);
      setSelectedCandidateKey(null);
      setImprovementRequested(false);
      setActiveBenchmark(null);
      setSelectedExperimentId(exp.id);
      setStage("results");
      writePersistedSession({
        stage: "results",
        experimentId: exp.id,
        evolutionRunId: null,
        externalEvolutionRunId: null,
        candidateKey: null,
        phase: "BASELINE_RESULT",
      });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => {
      setStage("idle");
      setErrorState({
        message: err.message,
        returnStage: "idle",
      });
    },
  });

  const activeExp = activeExpQuery.data?.experiment || null;

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!activeExp) throw new Error("Experiment not found");
      setErrorState(null);
      setValidatingPhase("eval_base");

      if (activeExp.adapter_type && activeExp.adapter_type !== "internal") {
        let evo = activeExternalEvolution;
        if (!evo) {
          evo = await api.analyzeExternalEvolution(activeExp.id);
        }
        setValidatingPhase("eval_cand");
        const validated = await api.validateExternalEvolution({
          evolution_run_id: evo.id,
          candidate_key:
            selectedCandidateKey ||
            evo.comparison_json?.selected_candidate_key ||
            undefined,
        });
        setValidatingPhase("diffing");
        await api.getExternalEvolutionDiff(validated.id).catch(() => null);
        return { kind: "external" as const, extEvo: validated };
      }

      let evo = activeEvolution;
      if (!evo) {
        evo = await api.analyzeEvolution(activeExp.id);
      }
      setValidatingPhase("eval_cand");
      const validated = await api.validateEvolution({
        evolution_run_id: evo.id,
        candidate_key: selectedCandidateKey || evo.selected_candidate_key || "D",
      });
      setValidatingPhase("diffing");
      await api.getEvolutionDiff(validated.id).catch(() => null);
      return { kind: "internal" as const, intEvo: validated };
    },
    onSuccess: (res) => {
      initialSessionRef.current = null;
      setIsRestoringEvolution(false);
      setValidatingPhase(null);
      if (res.kind === "external") {
        setActiveEvolution(null);
        setActiveExternalEvolution(res.extEvo);
        setStage("comparison");
        if (selectedExperimentId !== null) {
          writePersistedSession({
            stage: "comparison",
            experimentId: selectedExperimentId,
            evolutionRunId: null,
            externalEvolutionRunId: res.extEvo.id,
            candidateKey: selectedCandidateKey,
            phase: "COMPARISON_AVAILABLE",
          });
        }
        queryClient.invalidateQueries({ queryKey: ["externalEvolutions"] });
        queryClient.invalidateQueries({
          queryKey: ["externalEvolutionDiff", res.extEvo.id],
        });
      } else {
        setActiveExternalEvolution(null);
        setActiveEvolution(res.intEvo);
        setStage("comparison");
        if (selectedExperimentId !== null) {
          writePersistedSession({
            stage: "comparison",
            experimentId: selectedExperimentId,
            evolutionRunId: res.intEvo.id,
            externalEvolutionRunId: null,
            candidateKey: selectedCandidateKey,
            phase: "COMPARISON_AVAILABLE",
          });
        }
        queryClient.invalidateQueries({ queryKey: ["evolutionRuns"] });
        queryClient.invalidateQueries({ queryKey: ["evolutionHistory"] });
        queryClient.invalidateQueries({ queryKey: ["defenseConfigs"] });
        queryClient.invalidateQueries({
          queryKey: ["evolutionDiff", res.intEvo.id],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => {
      setValidatingPhase(null);
      setErrorState({
        message: err.message,
        returnStage: "results",
      });
    },
  });

  const retestMutation = useMutation({
    mutationFn: async (opts: { evoId: number; useUpdatedProfile?: boolean }) => {
      setErrorState(null);
      if (opts.useUpdatedProfile) {
        return api.retestExternalBlackBox({
          evolution_run_id: opts.evoId,
          profile: "updated",
          version_label: "B-1.2-updated",
        });
      }
      if (!retestContent.trim()) {
        throw new Error(t.ext.importMissingAlert);
      }
      return api.retestExternalBlackBox({
        evolution_run_id: opts.evoId,
        file_format: retestFormat,
        content: retestContent,
        version_label: retestVersionLabel || "Updated v2",
      });
    },
    onSuccess: (updatedEvo) => {
      initialSessionRef.current = null;
      setIsRestoringEvolution(false);
      setActiveExternalEvolution(updatedEvo);
      setStage("comparison");
      if (selectedExperimentId !== null) {
        writePersistedSession({
          stage: "comparison",
          experimentId: selectedExperimentId,
          evolutionRunId: null,
          externalEvolutionRunId: updatedEvo.id,
          candidateKey: selectedCandidateKey,
          phase: "COMPARISON_AVAILABLE",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["externalEvolutions"] });
      queryClient.invalidateQueries({
        queryKey: ["externalEvolutionDiff", updatedEvo.id],
      });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => {
      setErrorState({
        message: err.message,
        returnStage: "results",
      });
    },
  });

  const handleStartCheck = () => {
    if (runCheckMutation.isPending || stage === "testing") return;
    if (selectedEngine?.adapter_type === "imported" && !importContent.trim()) {
      setParamsOpen(true);
      setErrorState({
        message: t.ext.importMissingAlert,
        returnStage: stage === "idle" ? "idle" : "results",
      });
      return;
    }
    runCheckMutation.mutate();
  };

  const handleResetToIdle = () => {
    if (runCheckMutation.isPending || validateMutation.isPending) return;
    initialSessionRef.current = null;
    initialExpHydratedRef.current = true;
    setIsRestoringEvolution(false);
    setErrorState(null);
    setSec1Expanded(false);
    setActiveEvolution(null);
    setActiveExternalEvolution(null);
    setSelectedCandidateKey(null);
    setImprovementRequested(false);
    setActiveBenchmark(null);
    setSelectedExperimentId(null);
    setStage("idle");
    writePersistedSession(null);
    const base = (configsQuery.data || []).find((c) => c.is_baseline);
    if (base) {
      setSelectedDefenseId(base.id);
    }
  };

  const handleCancelImprovement = () => {
    if (validateMutation.isPending) return;
    initialSessionRef.current = null;
    setIsRestoringEvolution(false);
    setImprovementRequested(false);
    setActiveEvolution(null);
    setActiveExternalEvolution(null);
    setSelectedCandidateKey(null);
    setErrorState(null);
    if (selectedExperimentId !== null) {
      setStage("results");
      writePersistedSession({
        stage: "results",
        experimentId: selectedExperimentId,
        evolutionRunId: null,
        externalEvolutionRunId: null,
        candidateKey: null,
        phase: "BASELINE_RESULT",
      });
    }
  };

  const handleSelectHistoryExperiment = (expId: number) => {
    initialSessionRef.current = null;
    initialExpHydratedRef.current = true;
    setIsRestoringEvolution(false);
    setErrorState(null);
    setSec1Expanded(false);
    setActiveBenchmark(null);
    setImprovementRequested(false);
    setSelectedExperimentId(expId);

    const matchingIntEvo =
      (evoRunsQuery.data || []).find(
        (e) =>
          e.baseline_experiment_id === expId ||
          e.final_baseline_experiment_id === expId ||
          e.final_candidate_experiment_id === expId ||
          e.comparison_json?.full_candidate_experiment_id === expId
      ) || null;

    const matchingExtEvo =
      (extEvoRunsQuery.data || []).find(
        (e) =>
          e.baseline_experiment_id === expId || e.candidate_experiment_id === expId
      ) || null;

    setActiveEvolution(matchingIntEvo);
    setActiveExternalEvolution(matchingExtEvo);
    const candKey =
      matchingIntEvo?.selected_candidate_key ||
      matchingExtEvo?.comparison_json?.selected_candidate_key ||
      null;
    setSelectedCandidateKey(candKey);

    const isDone =
      matchingIntEvo?.status === "completed" ||
      matchingExtEvo?.status === "completed";
    const nextStage: WorkspaceStage = isDone ? "comparison" : "results";
    const nextPhase: ImprovementLifecyclePhase = isDone
      ? "COMPARISON_AVAILABLE"
      : matchingIntEvo || matchingExtEvo
        ? "CANDIDATE_READY"
        : "BASELINE_RESULT";
    setStage(nextStage);
    writePersistedSession({
      stage: nextStage,
      experimentId: expId,
      evolutionRunId: matchingIntEvo?.id ?? null,
      externalEvolutionRunId: matchingExtEvo?.id ?? null,
      candidateKey: candKey,
      phase: nextPhase,
    });
  };

  const handleOpenInspector = (txCode: string, expIdOverride?: number) => {
    setAnalyticsTxCode(txCode);
    setAnalyticsInspectorExpId(expIdOverride || selectedExperimentId || null);
    setAnalyticsTab("inspector");
    setAnalyticsOpen(true);
  };

  const handleOpenAnalytics = (tab: AnalyticsTab) => {
    setAnalyticsTxCode(null);
    setAnalyticsInspectorExpId(null);
    setAnalyticsTab(tab);
    setAnalyticsOpen(true);
  };

  const apiOnline = healthQuery.isSuccess && healthQuery.data?.status === "ok";
  const configs = configsQuery.data || [];
  const datasets = datasetsQuery.data || [];
  const experiments = experimentsQuery.data || [];
  const benchmarks = benchmarksQuery.data || [];
  const intelligence = intelligenceQuery.data || null;

  const selectedDefenseObj = configs.find(
    (c) => c.id === Number(selectedDefenseId)
  );
  const activeExpDefenseObj = activeExp
    ? configs.find((c) => c.id === activeExp.defense_config_id)
    : selectedDefenseObj;

  const effectiveTxCount = useMemo(() => {
    if (selectedDatasetId !== null) {
      const ds = datasets.find((d) => d.id === selectedDatasetId);
      if (ds && ds.transaction_count === txCount && ds.seed === seed) {
        return ds.transaction_count;
      }
    }
    return txCount;
  }, [selectedDatasetId, datasets, txCount, seed]);

  const isActiveExpBlackBox = activeExp?.diagnostic_mode === "black_box";

  const topProblems = useMemo(
    () =>
      buildTopWeaknesses(
        intelligence,
        Boolean(isActiveExpBlackBox),
        lang,
        t.focus.problemTitles as Record<string, string>,
        scenarioLabel
      ),
    [intelligence, isActiveExpBlackBox, lang, t.focus.problemTitles, scenarioLabel]
  );

  const baselineCfgForStability =
    activeEvolution?.baseline_config_id ||
    configs.find((c) => c.is_baseline)?.id ||
    configs[0]?.id ||
    1;
  const candidateCfgForStability =
    activeEvolution?.candidate_config_id ||
    (activeExp && activeExp.defense_config_id !== baselineCfgForStability
      ? activeExp.defense_config_id
      : null);

  const matchingBenchmark = useMemo(() => {
    if (activeBenchmark) return activeBenchmark;
    return (
      benchmarks.find(
        (b) =>
          b.baseline_config_id === baselineCfgForStability &&
          b.candidate_config_id === candidateCfgForStability
      ) || null
    );
  }, [
    activeBenchmark,
    benchmarks,
    baselineCfgForStability,
    candidateCfgForStability,
  ]);

  const activeDiffData =
    activeExternalEvolution !== null
      ? externalDiffQuery.data || null
      : internalDiffQuery.data || null;
  const activeDiffLoading =
    activeExternalEvolution !== null
      ? externalDiffQuery.isLoading
      : internalDiffQuery.isLoading;

  const hasComparisonBlock = Boolean(
    (activeEvolution &&
      activeEvolution.status === "completed" &&
      activeEvolution.comparison_json?.evaluation_split) ||
      (activeExternalEvolution &&
        activeExternalEvolution.status === "completed" &&
        activeExternalEvolution.comparison_json?.evaluation_split)
  );

  // Pin restored phase while React Query completes initial F5 hydration (zero flash/reset)
  const optimisticHydrationPhase: ImprovementLifecyclePhase | null =
    isRestoringEvolution &&
    (initialSessionRef.current?.phase === "CANDIDATE_READY" ||
      initialSessionRef.current?.phase === "COMPARISON_AVAILABLE")
      ? initialSessionRef.current.phase
      : null;

  const improvementPhase: ImprovementLifecyclePhase = hasComparisonBlock
    ? "COMPARISON_AVAILABLE"
    : validateMutation.isPending || retestMutation.isPending
      ? "VERIFICATION"
      : activeEvolution || activeExternalEvolution
        ? "CANDIDATE_READY"
        : analyzeMutation.isPending || improvementRequested
          ? "IMPROVEMENT_REQUESTED"
          : optimisticHydrationPhase || "BASELINE_RESULT";

  const stablePersistedPhase: ImprovementLifecyclePhase = hasComparisonBlock
    ? "COMPARISON_AVAILABLE"
    : activeEvolution || activeExternalEvolution
      ? "CANDIDATE_READY"
      : "BASELINE_RESULT";

  const canVerifyBlackBoxPolicy = Boolean(
    activeExternalEvolution &&
      activeExternalEvolution.mode === "black_box_manual" &&
      activeExternalEvolution.comparison_json?.black_box_policy?.has_risk_scores &&
      (activeExternalEvolution.candidates_json?.length ?? 0) > 0 &&
      activeExp?.adapter_type === "external_api"
  );

  // Guarded bidirectional URL + sessionStorage synchronization
  useEffect(() => {
    const expStillHydrating =
      !initialExpHydratedRef.current &&
      selectedExperimentId !== null &&
      (activeExpQuery.isLoading || activeExpQuery.isFetching);
    const evoQueriesHydrating =
      isRestoringEvolution ||
      (Boolean(initialSessionRef.current?.evolutionRunId || initialSessionRef.current?.externalEvolutionRunId) &&
        (evoRunsQuery.isLoading ||
          evoRunsQuery.isFetching ||
          extEvoRunsQuery.isLoading ||
          extEvoRunsQuery.isFetching));

    if (expStillHydrating || evoQueriesHydrating) {
      return;
    }

    if (stage === "idle") {
      let dirty = false;
      const next = new URLSearchParams(searchParams);
      for (const k of WORKSPACE_URL_KEYS) {
        if (next.has(k)) {
          next.delete(k);
          dirty = true;
        }
      }
      if (dirty) {
        setSearchParams(next, { replace: true });
      }
      return;
    }

    if (
      (stage === "results" || stage === "comparison") &&
      selectedExperimentId !== null
    ) {
      const targetStage: "results" | "comparison" = hasComparisonBlock
        ? "comparison"
        : "results";
      writePersistedSession({
        stage: targetStage,
        experimentId: selectedExperimentId,
        evolutionRunId: activeEvolution?.id ?? null,
        externalEvolutionRunId: activeExternalEvolution?.id ?? null,
        candidateKey: selectedCandidateKey,
        phase: stablePersistedPhase,
      });

      const next = new URLSearchParams(searchParams);
      next.set("exp", String(selectedExperimentId));
      next.set("phase", stablePersistedPhase);
      if (activeEvolution?.id) {
        next.set("evo", String(activeEvolution.id));
      } else {
        next.delete("evo");
      }
      if (activeExternalEvolution?.id) {
        next.set("ext_evo", String(activeExternalEvolution.id));
      } else {
        next.delete("ext_evo");
      }
      if (selectedCandidateKey) {
        next.set("cand", selectedCandidateKey);
      } else {
        next.delete("cand");
      }
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    }
  }, [
    stage,
    selectedExperimentId,
    activeEvolution?.id,
    activeExternalEvolution?.id,
    selectedCandidateKey,
    hasComparisonBlock,
    stablePersistedPhase,
    isRestoringEvolution,
    activeExpQuery.isLoading,
    activeExpQuery.isFetching,
    evoRunsQuery.isLoading,
    evoRunsQuery.isFetching,
    extEvoRunsQuery.isLoading,
    extEvoRunsQuery.isFetching,
    searchParams,
    setSearchParams,
  ]);

  const handleStartImprovement = () => {
    if (!activeExp || analyzeMutation.isPending) return;
    setErrorState(null);
    setImprovementRequested(true);
    analyzeMutation.mutate(activeExp);
    window.setTimeout(() => {
      document
        .getElementById("sec-proposals")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  const handleSidebarNavigate = (sectionId: WorkspaceNavSectionId) => {
    setActiveNavSection(sectionId);
    if (sectionId === "sec-comparison" && !hasComparisonBlock) {
      document
        .getElementById("sec-verify")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (sectionId === "sec-analytics") {
      handleOpenAnalytics("overview");
    } else if (sectionId === "sec-history") {
      setHistoryOpen(true);
    }
  };

  const handleEvolutionUpdated = (evo: EvolutionRun) => {
    initialSessionRef.current = null;
    setIsRestoringEvolution(false);
    setActiveEvolution(evo);
    if (selectedExperimentId !== null) {
      writePersistedSession({
        stage: "comparison",
        experimentId: selectedExperimentId,
        evolutionRunId: evo.id,
        externalEvolutionRunId: null,
        candidateKey: evo.selected_candidate_key || selectedCandidateKey,
        phase: "COMPARISON_AVAILABLE",
      });
    }
    setStage("comparison");
  };

  const handleDemoReset = () => {
    initialSessionRef.current = null;
    initialExpHydratedRef.current = true;
    setIsRestoringEvolution(false);
    writePersistedSession(null);
    setActiveEvolution(null);
    setActiveExternalEvolution(null);
    setSelectedCandidateKey(null);
    setActiveBenchmark(null);
    setSelectedExperimentId(null);
    setSelectedDatasetId(null);
    setStage("idle");
  };

  const isHydratingSavedWorkspace = Boolean(
    stage !== "idle" &&
      stage !== "testing" &&
      (!activeExp ||
        (isRestoringEvolution && !activeEvolution && !activeExternalEvolution))
  );

  return {
    t,
    lang,
    setLang,
    bgAnimationEnabled,
    scenarioLabel,
    stage,
    testingPhase,
    testingDatasetLabel,
    testingElapsedMs,
    errorState,
    setErrorState,
    sec1Expanded,
    setSec1Expanded,
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileNavOpen,
    setMobileNavOpen,
    activeNavSection,
    selectedEngineCode,
    setSelectedEngineCode,
    externalProfile,
    setExternalProfile,
    importFormat,
    setImportFormat,
    importContent,
    setImportContent,
    importVersionLabel,
    setImportVersionLabel,
    retestFormat,
    setRetestFormat,
    retestContent,
    setRetestContent,
    retestVersionLabel,
    setRetestVersionLabel,
    selectedDefenseId,
    setSelectedDefenseId,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedExperimentId,
    txCount,
    setTxCount,
    seed,
    setSeed,
    splitName,
    setSplitName,
    paramsOpen,
    setParamsOpen,
    historyOpen,
    setHistoryOpen,
    settingsOpen,
    setSettingsOpen,
    analyticsOpen,
    setAnalyticsOpen,
    analyticsTab,
    analyticsTxCode,
    analyticsInspectorExpId,
    activeEvolution,
    activeExternalEvolution,
    selectedCandidateKey,
    setSelectedCandidateKey,
    validatingPhase,
    apiOnline,
    engines,
    selectedEngine,
    externalBEngine,
    configs,
    configsLoading: configsQuery.isLoading,
    datasets,
    experiments,
    benchmarks,
    activeExp,
    activeExpDefenseObj,
    intelligence,
    intelligenceLoading: intelligenceQuery.isLoading,
    effectiveTxCount,
    isActiveExpBlackBox,
    topProblems,
    baselineCfgForStability,
    candidateCfgForStability,
    matchingBenchmark,
    activeDiffData,
    activeDiffLoading,
    hasComparisonBlock,
    improvementPhase,
    canVerifyBlackBoxPolicy,
    isHydratingSavedWorkspace,
    analyzePending: analyzeMutation.isPending,
    validatePending: validateMutation.isPending,
    retestPending: retestMutation.isPending,
    handleStartCheck,
    handleResetToIdle,
    handleCancelImprovement,
    handleSelectHistoryExperiment,
    handleOpenInspector,
    handleOpenAnalytics,
    handleStartImprovement,
    triggerValidate: () => validateMutation.mutate(),
    triggerRetest: (useUpdatedProfile?: boolean) => {
      if (!activeExternalEvolution) return;
      retestMutation.mutate({
        evoId: activeExternalEvolution.id,
        useUpdatedProfile,
      });
    },
    handleSidebarNavigate,
    handleEvolutionUpdated,
    handleDemoReset,
    setActiveBenchmark,
  };
}
