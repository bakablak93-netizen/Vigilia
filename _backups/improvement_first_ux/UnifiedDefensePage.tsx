import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  FileJson,
  FileSpreadsheet,
  History,
  Layers,
  Loader2,
  Menu,
  Play,
  Plug,
  Printer,
  Scale,
  Search,
  Settings,
  SlidersHorizontal,
  TrendingUp,
  Upload,
} from "lucide-react";
import { api } from "../api/client";
import { AnalyticsDrawer, type AnalyticsTab } from "../components/unified/AnalyticsDrawer";
import { HistoryDrawer } from "../components/unified/HistoryDrawer";
import { SettingsModal } from "../components/unified/SettingsModal";
import { TestParamsModal } from "../components/unified/TestParamsModal";
import { VigiliaConclusionCard } from "../components/unified/VigiliaConclusionCard";
import { WorkspaceChangesBlock } from "../components/unified/WorkspaceChangesBlock";
import { WorkspaceComparisonBlock } from "../components/unified/WorkspaceComparisonBlock";
import {
  type RankedWeaknessItem,
  WorkspaceResultsBlock,
} from "../components/unified/WorkspaceResultsBlock";
import { AnimatedFlowBackground } from "../components/v4/AnimatedFlowBackground";
import { VigiliaPixelLogo } from "../components/v4/VigiliaPixelLogo";
import {
  WorkspaceSidebar,
  type WorkspaceNavSectionId,
} from "../components/v4/WorkspaceSidebar";
import { useLab } from "../context/LabContext";
import type { Language } from "../i18n/translations";
import type {
  BenchmarkRun,
  EvolutionRun,
  ExperimentSummary,
  ExternalEvolutionRun,
  SecurityIntelligenceReport,
} from "../types/api";

type WorkspaceStage = "idle" | "testing" | "results" | "comparison";
type TestingPhase = "preparing" | "running" | "analyzing";
type ValidatingPhase = "eval_base" | "eval_cand" | "diffing" | null;

interface PersistedWorkspaceSession {
  stage: "results" | "comparison";
  experimentId: number;
  evolutionRunId: number | null;
  externalEvolutionRunId: number | null;
}

interface WorkspaceErrorState {
  message: string;
  returnStage: "idle" | "results";
}

const FOCUS_SESSION_KEY = "vigilia_focus_session_v1";
const ALL_SCENARIOS = [
  "normal_activity",
  "unusual_amount",
  "new_recipient_risk",
  "duplicate_payment",
  "suspicious_sequence",
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

export const UnifiedDefensePage: React.FC = () => {
  const {
    t,
    lang,
    setLang,
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
    readPersistedSession()
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

  // Engine selection & External / Import params
  const [selectedEngineCode, setSelectedEngineCode] =
    useState<string>("internal_vigilia");
  const [externalProfile, setExternalProfile] = useState<
    "baseline" | "candidate" | "updated"
  >("baseline");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importContent, setImportContent] = useState<string>("");
  const [importVersionLabel, setImportVersionLabel] =
    useState<string>("Imported v1");

  // Black-box retest controls
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
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<
    string | null
  >(null);
  const [validatingPhase, setValidatingPhase] =
    useState<ValidatingPhase>(null);
  const [activeBenchmark, setActiveBenchmark] = useState<BenchmarkRun | null>(
    null
  );

  useEffect(() => {
    const saved = initialSessionRef.current;
    if (saved && selectedExperimentId === null) {
      setSelectedExperimentId(saved.experimentId);
    }
  }, [selectedExperimentId, setSelectedExperimentId]);

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

  useEffect(() => {
    const panel = searchParams.get("panel");
    if (panel === "history") {
      setHistoryOpen(true);
      setSearchParams({}, { replace: true });
    } else if (panel === "settings") {
      setSettingsOpen(true);
      setSearchParams({}, { replace: true });
    } else if (searchParams.toString()) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const cfgs = configsQuery.data || [];
    if (selectedDefenseId === "" && cfgs.length > 0) {
      const base = cfgs.find((c) => c.is_baseline) || cfgs[0];
      setSelectedDefenseId(base.id);
    }
  }, [configsQuery.data, selectedDefenseId]);

  useEffect(() => {
    if (!selectedExperimentId) return;
    const saved = initialSessionRef.current;

    if (saved?.evolutionRunId && !activeEvolution && evoRunsQuery.data) {
      const foundInt = evoRunsQuery.data.find(
        (e) => e.id === saved.evolutionRunId
      );
      if (foundInt) {
        setActiveEvolution(foundInt);
        if (foundInt.status === "completed") setStage("comparison");
        return;
      }
    }
    if (
      saved?.externalEvolutionRunId &&
      !activeExternalEvolution &&
      extEvoRunsQuery.data
    ) {
      const foundExt = extEvoRunsQuery.data.find(
        (e) => e.id === saved.externalEvolutionRunId
      );
      if (foundExt) {
        setActiveExternalEvolution(foundExt);
        if (foundExt.status === "completed") setStage("comparison");
        return;
      }
    }
    if (stage === "comparison" && !activeEvolution && !activeExternalEvolution) {
      if (evoRunsQuery.data && extEvoRunsQuery.data) {
        setStage("results");
      }
    }
  }, [
    selectedExperimentId,
    evoRunsQuery.data,
    extEvoRunsQuery.data,
    activeEvolution,
    activeExternalEvolution,
    stage,
  ]);

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

  useEffect(() => {
    if (
      (stage === "results" || stage === "comparison") &&
      selectedExperimentId !== null &&
      activeExpQuery.isError
    ) {
      writePersistedSession(null);
      setSelectedExperimentId(null);
      setActiveEvolution(null);
      setActiveExternalEvolution(null);
      setStage("idle");
    }
  }, [
    stage,
    selectedExperimentId,
    activeExpQuery.isError,
    setSelectedExperimentId,
  ]);

  const engines = enginesQuery.data || [];
  const selectedEngine = engines.find((e) => e.code === selectedEngineCode);
  const externalBEngine = engines.find((e) => e.code === "external_b");

  // Auto-analyze mutation for Block 03 (validation split only — never evaluation)
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
      if (res.kind === "external") {
        setActiveEvolution(null);
        setActiveExternalEvolution(res.extEvo);
        setSelectedCandidateKey(
          res.extEvo.comparison_json?.selected_candidate_key || null
        );
        writePersistedSession({
          stage: "results",
          experimentId: res.expId,
          evolutionRunId: null,
          externalEvolutionRunId: res.extEvo.id,
        });
        queryClient.invalidateQueries({ queryKey: ["externalEvolutions"] });
      } else {
        setActiveExternalEvolution(null);
        setActiveEvolution(res.intEvo);
        setSelectedCandidateKey(res.intEvo.selected_candidate_key || "D");
        writePersistedSession({
          stage: "results",
          experimentId: res.expId,
          evolutionRunId: res.intEvo.id,
          externalEvolutionRunId: null,
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

  // Step 1: Run antifraud baseline check (Blocks 01 -> 02 -> auto-analyze Block 03)
  const runCheckMutation = useMutation({
    mutationFn: async () => {
      setErrorState(null);
      setSec1Expanded(false);
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
      setActiveEvolution(null);
      setActiveExternalEvolution(null);
      setSelectedCandidateKey(null);
      setActiveBenchmark(null);
      setSelectedExperimentId(exp.id);
      setStage("results");
      writePersistedSession({
        stage: "results",
        experimentId: exp.id,
        evolutionRunId: null,
        externalEvolutionRunId: null,
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

  // Step 2: Validate Block 03 proposal on held-out evaluation split -> reveals Block 04 below
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

  // Black-box retest mutation -> reveals Block 04 below
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
      setActiveExternalEvolution(updatedEvo);
      setStage("comparison");
      if (selectedExperimentId !== null) {
        writePersistedSession({
          stage: "comparison",
          experimentId: selectedExperimentId,
          evolutionRunId: null,
          externalEvolutionRunId: updatedEvo.id,
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
    setErrorState(null);
    setSec1Expanded(false);
    setActiveEvolution(null);
    setActiveExternalEvolution(null);
    setSelectedCandidateKey(null);
    setActiveBenchmark(null);
    setSelectedExperimentId(null);
    setStage("idle");
    writePersistedSession(null);
    const base = (configsQuery.data || []).find((c) => c.is_baseline);
    if (base) {
      setSelectedDefenseId(base.id);
    }
  };

  const handleSelectHistoryExperiment = (expId: number) => {
    setErrorState(null);
    setSec1Expanded(false);
    setActiveBenchmark(null);
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
    setSelectedCandidateKey(
      matchingIntEvo?.selected_candidate_key ||
        matchingExtEvo?.comparison_json?.selected_candidate_key ||
        null
    );

    const isDone =
      matchingIntEvo?.status === "completed" ||
      matchingExtEvo?.status === "completed";
    const nextStage: WorkspaceStage = isDone ? "comparison" : "results";
    setStage(nextStage);
    writePersistedSession({
      stage: nextStage,
      experimentId: expId,
      evolutionRunId: matchingIntEvo?.id ?? null,
      externalEvolutionRunId: matchingExtEvo?.id ?? null,
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

  const activeExp = activeExpQuery.data?.experiment || null;
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

  const formatLocaleNumber = (val: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-US" : "ru-RU").format(val);

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

  /* ---------------------------------------------------------------------- */
  /* ENGINE SELECTOR PILLS (reused in Hero & Expanded Block 01)             */
  /* ---------------------------------------------------------------------- */
  const renderEngineSelector = () => {
    const isExtSelected = selectedEngineCode === "external_b";
    const isImpSelected = selectedEngineCode === "imported_predictions";
    const isCustomBlackBox = selectedEngineCode === "external_b_blackbox";

    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedEngineCode("internal_vigilia")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846] ${
            !isExtSelected && !isImpSelected && !isCustomBlackBox
              ? "bg-[#008F36] text-[#F4F6F4] shadow-[0_6px_18px_rgba(0,143,54,0.28)]"
              : "bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4]"
          }`}
        >
          {t.ext.internalLabel}
        </button>

        {externalBEngine && (
          <button
            type="button"
            onClick={() => setSelectedEngineCode("external_b")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846] ${
              isExtSelected
                ? "bg-[#008F36] text-[#F4F6F4] shadow-[0_6px_18px_rgba(0,143,54,0.28)]"
                : "bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                externalBEngine.online ? "bg-[#43D17A]" : "bg-[#E3AD56]"
              }`}
            />
            <span>{externalBEngine.name}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setSelectedEngineCode("imported_predictions");
            setParamsOpen(true);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846] ${
            isImpSelected
              ? "bg-[#008F36] text-[#F4F6F4] shadow-[0_6px_18px_rgba(0,143,54,0.28)]"
              : "bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4]"
          }`}
        >
          {t.ext.adapterImported}
        </button>
      </div>
    );
  };

  /* ---------------------------------------------------------------------- */
  /* FRAME 12 — START SCREEN (MAIN MENU) & LIVE EXECUTION                   */
  /* ---------------------------------------------------------------------- */
  const renderHeroBlock01 = () => {
    const testingSourceTag =
      selectedEngine?.adapter_type === "external_api"
        ? "External API"
        : selectedEngine?.adapter_type === "imported"
          ? "Imported"
          : "Internal";

    const handleOpenImportFlow = () => {
      setErrorState(null);
      setSelectedEngineCode("imported_predictions");
      setParamsOpen(true);
    };

    const handleOpenApiFlow = () => {
      setErrorState(null);
      if (selectedEngineCode === "imported_predictions") {
        setSelectedEngineCode(
          externalBEngine?.online ? "external_b" : "internal_vigilia"
        );
      }
      setParamsOpen(true);
    };

    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 py-10">
        {/* Compact floating top-right utilities (NO top header bar) */}
        <div className="fixed top-5 right-5 z-20 flex items-center gap-2">
          <div className="v4-surface-inset flex items-center gap-0.5 p-1 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            {(["ru", "kk", "en"] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-lg transition-all ${
                  lang === code
                    ? "bg-[#00B846] text-[#F4F6F4] shadow-[0_2px_10px_rgba(0,184,70,0.35)]"
                    : "text-[#77837C] hover:text-[#F4F6F4]"
                }`}
              >
                {code === "kk" ? "KZ" : code.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="btn-subtle py-2 px-3.5 text-xs"
            title={t.topBar.history}
          >
            <History className="h-3.5 w-3.5 text-[#43D17A]" />
            <span className="hidden sm:inline">{t.topBar.history}</span>
            {experiments.length > 0 && (
              <span className="font-mono text-[10px] text-[#43D17A]">
                {experiments.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn-subtle py-2 px-2.5 text-xs"
            aria-label={t.topBar.settings}
            title={t.topBar.settings}
          >
            <Settings className="h-3.5 w-3.5 text-[#A1ABA4]" />
          </button>
        </div>

        <div className="relative z-10 w-full max-w-[600px] text-center space-y-8 focus-enter">
          {/* Official Green Pixel VIGILIA Logo */}
          <div className="flex justify-center">
            <VigiliaPixelLogo variant="hero" />
          </div>

          {/* Concise Tagline */}
          <p className="text-sm sm:text-base font-medium text-[#A1ABA4] max-w-md mx-auto leading-relaxed">
            {t.v4.heroTagline}
          </p>

          {errorState && errorState.returnStage === "idle" && (
            <div className="v4-surface-elevated px-4 py-3 text-xs text-[#F16B6B] text-left flex items-center justify-between gap-3 max-w-lg mx-auto">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorState.message}</span>
              </div>
              <button
                type="button"
                onClick={handleStartCheck}
                className="font-semibold underline shrink-0"
              >
                {t.focus.retryBtn}
              </button>
            </div>
          )}

          {stage === "testing" ? (
            <div className="v4-surface p-6 text-left space-y-4 max-w-lg mx-auto">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-[#43D17A]" />
                  <span className="text-sm font-semibold text-[#F4F6F4]">
                    {t.focus.testingTitle}
                  </span>
                </div>
                <span className="font-mono text-xs text-[#43D17A] tabular-nums">
                  {(testingElapsedMs / 1000).toFixed(1)}s
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-[#77837C]">{t.v33.metaEngine}</div>
                  <div className="font-semibold text-[#F4F6F4] mt-0.5">
                    {selectedEngine?.name || t.ext.internalLabel}
                  </div>
                </div>
                <div>
                  <div className="text-[#77837C]">{t.v33.liveSourceLabel}</div>
                  <div className="font-mono text-[#A1ABA4] mt-0.5">
                    {testingSourceTag}
                  </div>
                </div>
                <div>
                  <div className="text-[#77837C]">{t.v33.liveTotalTxLabel}</div>
                  <div className="tabular-nums font-semibold text-[#F4F6F4] mt-0.5">
                    {formatLocaleNumber(effectiveTxCount)}
                  </div>
                </div>
              </div>

              <div className="v4-surface-inset px-3.5 py-2.5 text-xs text-[#A1ABA4] flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[#F4F6F4]">
                  {testingPhase === "preparing"
                    ? t.v33.stagePreparing
                    : testingPhase === "running"
                      ? t.v33.stageSentWait
                      : t.v33.stageComputing}
                </strong>
                {testingDatasetLabel && (
                  <span className="text-[11px] text-[#77837C] truncate">
                    {testingDatasetLabel}
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* Strictly TWO Bold Confident Modern Buttons */
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-1">
              <button
                type="button"
                onClick={handleOpenImportFlow}
                disabled={configsQuery.isLoading}
                className="btn-subtle w-full sm:w-52 px-8 py-4 text-base font-bold inline-flex items-center justify-center gap-2.5"
              >
                <Upload className="h-4 w-4 text-[#A1ABA4]" />
                <span>{t.v4.btnImport}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenApiFlow}
                disabled={configsQuery.isLoading}
                className="btn-primary w-full sm:w-56 px-9 py-4 text-base font-bold inline-flex items-center justify-center gap-2.5"
              >
                <Plug className="h-4 w-4" />
                <span>{t.v4.btnViaApi}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------------- */
  /* FRAME 13 — SIDEBAR + UNIFIED WORKSPACE                                 */
  /* ---------------------------------------------------------------------- */
  const handleSidebarNavigate = (sectionId: WorkspaceNavSectionId) => {
    setActiveNavSection(sectionId);
    if (sectionId === "sec-comparison" && !hasComparisonBlock) {
      const target = document.getElementById("sec-verify");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const renderUnifiedWorkspace = () => {
    if (!activeExp) {
      return (
        <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4">
          <div className="text-center space-y-3">
            <Loader2 className="h-7 w-7 text-[#43D17A] animate-spin mx-auto" />
            <p className="text-sm text-[#A1ABA4]">{t.result.loadingState}</p>
          </div>
        </div>
      );
    }

    const totalOps = activeExp.metrics_json.total_transactions;
    const engTitle = activeExp.engine_name || t.ext.internalLabel;
    const verLabel =
      activeExp.defense_version || activeExp.engine_version_label || "v1.0";

    const sidebarFlags = {
      checked: true,
      hasProblems: topProblems.length > 0,
      hasProposals: Boolean(activeEvolution || activeExternalEvolution),
      verifiedImprovements: hasComparisonBlock,
      isBlackBox: Boolean(isActiveExpBlackBox),
    };

    return (
      <div className="relative z-10 min-h-screen">
        {/* Mobile floating hamburger button (hidden on md+) */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="md:hidden fixed top-4 left-4 z-30 btn-subtle p-2.5 rounded-2xl"
          aria-label="Menu"
        >
          <Menu className="h-4 w-4 text-[#43D17A]" />
        </button>

        <WorkspaceSidebar
          activeSection={activeNavSection}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavOpen}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onCloseMobile={() => setMobileNavOpen(false)}
          onNavigate={handleSidebarNavigate}
          onNewCheck={handleResetToIdle}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          historyCount={experiments.length}
          apiOnline={apiOnline}
          engineLabel={engTitle}
          versionLabel={verLabel}
          flags={sidebarFlags}
        />

        <div
          className={`min-w-0 px-4 sm:px-7 py-6 sm:py-7 transition-all duration-300 ${
            sidebarCollapsed ? "md:pl-[106px]" : "md:pl-[284px]"
          }`}
        >
          <div className="max-w-[1060px] mx-auto space-y-5">
            {/* Discreet Inline Re-check Parameter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-10 md:pt-0">
              <div className="text-xs text-[#77837C]">
                <span className="font-semibold text-[#F4F6F4]">{engTitle}</span> ·{" "}
                <span className="font-mono">{verLabel}</span> ·{" "}
                <span className="tabular-nums">
                  {formatLocaleNumber(totalOps)} {t.v34.sec1OpsUnit}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSec1Expanded((v) => !v)}
                className="btn-subtle px-3.5 py-2 text-xs inline-flex items-center gap-1.5"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#43D17A]" />
                <span>
                  {sec1Expanded
                    ? t.v34.sec1CollapseParams
                    : t.v34.sec1ExpandParams}
                </span>
                {sec1Expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {sec1Expanded && (
              <div className="v4-surface p-5 space-y-4 focus-enter">
                {renderEngineSelector()}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#A1ABA4]">
                  <span>
                    {formatLocaleNumber(effectiveTxCount)} {t.v34.sec1OpsUnit} · seed{" "}
                    {seed} · split: {splitName}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setParamsOpen(true)}
                      className="btn-subtle px-4 py-2 text-xs"
                    >
                      {t.focus.paramsLink}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartCheck}
                      className="btn-primary px-5 py-2 text-xs inline-flex items-center gap-1.5"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{t.focus.startCheckBtn}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {errorState && errorState.returnStage === "results" && (
              <div className="v4-surface-elevated px-4 py-3 text-xs text-[#F16B6B] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorState.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorState(null)}
                  className="underline font-semibold shrink-0"
                >
                  ×
                </button>
              </div>
            )}

            {/* TOP-OF-WORKSPACE HUMAN-FRIENDLY CONCLUSION (ALWAYS FIRST) */}
            <VigiliaConclusionCard
              experiment={activeExp}
              hasProposal={Boolean(activeEvolution || activeExternalEvolution)}
              hasVerifiedComparison={hasComparisonBlock}
              onActionClick={() => {
                if (hasComparisonBlock) {
                  document
                    .getElementById("sec-comparison")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  return;
                }
                if (activeEvolution || activeExternalEvolution) {
                  const targetId = isActiveExpBlackBox
                    ? "sec-proposals"
                    : "sec-verify";
                  document
                    .getElementById(targetId)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  return;
                }
                document
                  .getElementById("sec-proposals")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
                if (!analyzeMutation.isPending) {
                  analyzeMutation.mutate(activeExp);
                }
              }}
            />

            {/* 01 & 02 — OVERVIEW, DOMINANT CHARTS & WEAKNESSES */}
            <WorkspaceResultsBlock
              experiment={activeExp}
              intelligence={intelligence}
              intelligenceLoading={intelligenceQuery.isLoading}
              weaknesses={topProblems}
              onInspectTransaction={(code) =>
                handleOpenInspector(code, activeExp.id)
              }
              onOpenAnalytics={handleOpenAnalytics}
            />

            {/* 03 & 04 — PROPOSED CHANGES & GUARDRAIL VERIFICATION */}
            <WorkspaceChangesBlock
              experiment={activeExp}
              evolutionRun={activeEvolution}
              externalEvolution={activeExternalEvolution}
              analyzing={analyzeMutation.isPending}
              validating={validateMutation.isPending}
              validatingPhase={validatingPhase}
              selectedCandidateKey={selectedCandidateKey}
              onSelectCandidateKey={setSelectedCandidateKey}
              onValidate={() => validateMutation.mutate()}
              onAnalyzeManual={() => analyzeMutation.mutate(activeExp)}
              onInspectTransaction={(code) =>
                handleOpenInspector(code, activeExp.id)
              }
              retestFormat={retestFormat}
              onChangeRetestFormat={setRetestFormat}
              retestVersionLabel={retestVersionLabel}
              onChangeRetestVersionLabel={setRetestVersionLabel}
              retestContent={retestContent}
              onChangeRetestContent={setRetestContent}
              onRetestBlackBox={(useUpdatedProfile) => {
                if (!activeExternalEvolution) return;
                retestMutation.mutate({
                  evoId: activeExternalEvolution.id,
                  useUpdatedProfile,
                });
              }}
              retesting={retestMutation.isPending}
            />

            {/* 05 — HELD-OUT EVALUATION COMPARISON */}
            {hasComparisonBlock && (
              <WorkspaceComparisonBlock
                evolutionRun={activeEvolution}
                externalEvolution={activeExternalEvolution}
                diffData={activeDiffData}
                diffLoading={activeDiffLoading}
                onInspectTransaction={(code, expIdOverride) =>
                  handleOpenInspector(code, expIdOverride)
                }
                onOpenAnalytics={handleOpenAnalytics}
              />
            )}

            {/* 06 & 07 — DEEP ANALYTICS LAUNCHER & REPORTS EXPORT */}
            <section
              id="sec-analytics"
              className="v4-surface p-5 sm:p-6 space-y-5 scroll-mt-20"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center font-mono font-bold text-[#43D17A] bg-[#00B846]/18 px-2.5 py-0.5 rounded-full">
                    06
                  </span>
                  <span className="font-semibold uppercase tracking-wider text-[#A1ABA4]">
                    {t.v4.navAnalytics}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#F4F6F4]">
                  {t.v4.analyticsHubTitle}
                </h3>
                <p className="text-xs text-[#77837C]">{t.v4.analyticsHubDesc}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {[
                  {
                    tab: "scenarios" as AnalyticsTab,
                    label: t.v33.tabScenarios,
                    icon: <Layers className="h-3.5 w-3.5 text-[#43D17A]" />,
                  },
                  {
                    tab: "errors" as AnalyticsTab,
                    label: t.v33.tabErrors,
                    icon: <AlertTriangle className="h-3.5 w-3.5 text-[#E3AD56]" />,
                  },
                  {
                    tab: "riskdist" as AnalyticsTab,
                    label: t.v33.tabRiskDist,
                    icon: <TrendingUp className="h-3.5 w-3.5 text-[#43D17A]" />,
                  },
                  {
                    tab: "inspector" as AnalyticsTab,
                    label: t.v33.tabInspector,
                    icon: <Search className="h-3.5 w-3.5 text-[#A1ABA4]" />,
                  },
                  {
                    tab: "compare" as AnalyticsTab,
                    label: t.v33.tabCompare,
                    icon: <Scale className="h-3.5 w-3.5 text-[#A8843D]" />,
                  },
                  {
                    tab: "stability" as AnalyticsTab,
                    label: t.v33.tabStability,
                    icon: <BarChart3 className="h-3.5 w-3.5 text-[#43D17A]" />,
                  },
                ].map((tool) => (
                  <button
                    key={tool.tab}
                    type="button"
                    onClick={() => handleOpenAnalytics(tool.tab)}
                    className="btn-subtle px-3 py-2.5 text-xs justify-start text-left"
                  >
                    {tool.icon}
                    <span className="truncate">{tool.label}</span>
                  </button>
                ))}
              </div>

              <div
                id="sec-history"
                className="v4-surface-inset p-4 flex flex-wrap items-center justify-between gap-3 scroll-mt-20"
              >
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[#F4F6F4]">
                    07 · {t.v4.navHistoryReports}
                  </div>
                  <div className="text-[11px] text-[#77837C]">
                    {t.v4.reportsTitle} (#{activeExp.id})
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={api.exportUrl(activeExp.id, "json")}
                    className="btn-subtle px-3 py-1.5 text-xs"
                  >
                    <FileJson className="h-3.5 w-3.5 text-[#43D17A]" />
                    <span>JSON</span>
                  </a>
                  <a
                    href={api.exportUrl(activeExp.id, "csv")}
                    className="btn-subtle px-3 py-1.5 text-xs"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-[#43D17A]" />
                    <span>CSV</span>
                  </a>
                  <a
                    href={api.exportUrl(activeExp.id, "html")}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-subtle px-3 py-1.5 text-xs"
                  >
                    <Printer className="h-3.5 w-3.5 text-[#A1ABA4]" />
                    <span>HTML</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(true)}
                    className="btn-primary px-3.5 py-1.5 text-xs"
                  >
                    <History className="h-3.5 w-3.5" />
                    <span>
                      {t.topBar.history} ({experiments.length})
                    </span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  };

  const inWorkspace = stage === "results" || stage === "comparison";

  return (
    <div className="relative min-h-screen bg-[#080A09] text-[#F4F6F4] overflow-x-hidden">
      <AnimatedFlowBackground compact={inWorkspace} />

      <main className="relative z-10">
        {stage === "idle" || stage === "testing"
          ? renderHeroBlock01()
          : renderUnifiedWorkspace()}
      </main>

      <TestParamsModal
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
        onRunCheck={handleStartCheck}
        engines={engines}
        selectedEngineCode={selectedEngineCode}
        onChangeEngineCode={setSelectedEngineCode}
        externalProfile={externalProfile}
        onChangeExternalProfile={setExternalProfile}
        importFormat={importFormat}
        onChangeImportFormat={setImportFormat}
        importContent={importContent}
        onChangeImportContent={setImportContent}
        importVersionLabel={importVersionLabel}
        onChangeImportVersionLabel={setImportVersionLabel}
        configs={configs}
        datasets={datasets}
        selectedDefenseId={selectedDefenseId}
        onChangeDefenseId={setSelectedDefenseId}
        selectedDatasetId={selectedDatasetId}
        onChangeDatasetId={setSelectedDatasetId}
        txCount={txCount}
        onChangeTxCount={setTxCount}
        seed={seed}
        onChangeSeed={setSeed}
        splitName={splitName}
        onChangeSplitName={setSplitName}
      />

      <AnalyticsDrawer
        open={analyticsOpen}
        initialTab={analyticsTab}
        initialTxCode={analyticsTxCode}
        inspectorExperimentId={analyticsInspectorExpId}
        onClose={() => setAnalyticsOpen(false)}
        experiment={activeExp}
        intelligence={intelligence}
        activeEvolution={activeEvolution}
        activeExternalEvolution={activeExternalEvolution}
        onEvolutionUpdated={(evo) => {
          setActiveEvolution(evo);
          if (selectedExperimentId !== null) {
            writePersistedSession({
              stage: "comparison",
              experimentId: selectedExperimentId,
              evolutionRunId: evo.id,
              externalEvolutionRunId: null,
            });
          }
          setStage("comparison");
        }}
        defenseConfig={activeExpDefenseObj}
        engines={engines}
        baselineConfigId={baselineCfgForStability}
        candidateConfigId={candidateCfgForStability}
        activeBenchmark={matchingBenchmark}
        onBenchmarkCompleted={(bm) => setActiveBenchmark(bm)}
      />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        experiments={experiments}
        benchmarks={benchmarks}
        activeExperimentId={selectedExperimentId}
        onSelectExperiment={handleSelectHistoryExperiment}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDemoReset={() => {
          writePersistedSession(null);
          setActiveEvolution(null);
          setActiveExternalEvolution(null);
          setSelectedCandidateKey(null);
          setActiveBenchmark(null);
          setSelectedExperimentId(null);
          setSelectedDatasetId(null);
          setStage("idle");
        }}
      />
    </div>
  );
};
