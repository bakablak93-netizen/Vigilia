import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FileJson,
  FileSpreadsheet,
  GitCompareArrows,
  Layers,
  Loader2,
  Play,
  Printer,
  Scale,
  Search,
  ShieldAlert,
  TrendingUp,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type {
  AntifraudEngineView,
  BenchmarkRun,
  DefenseConfig,
  EngineComparison,
  EvolutionRun,
  ExperimentSummary,
  ExternalEvolutionRun,
  SecurityIntelligenceReport,
} from "../../types/api";
import {
  DefenseComparisonChart,
  ErrorCompositionChart,
  RiskDistributionChart,
  ScenarioDetectionChart,
} from "../charts/SecurityCharts";
import { ConfusionMatrixCard } from "../ConfusionMatrixCard";
import { ImprovementSection } from "./ImprovementSection";
import { StabilitySection } from "./StabilitySection";
import { TransactionInspectorView } from "./TransactionInspectorView";

export type AnalyticsTab =
  | "overview"
  | "scenarios"
  | "errors"
  | "riskdist"
  | "inspector"
  | "evolution"
  | "compare"
  | "stability";

interface AnalyticsDrawerProps {
  open: boolean;
  initialTab: AnalyticsTab;
  initialTxCode?: string | null;
  inspectorExperimentId?: number | null;
  onClose: () => void;
  experiment: ExperimentSummary | null;
  intelligence: SecurityIntelligenceReport | null;
  activeEvolution: EvolutionRun | null;
  activeExternalEvolution: ExternalEvolutionRun | null;
  onEvolutionUpdated: (evo: EvolutionRun) => void;
  defenseConfig: DefenseConfig | undefined;
  engines: AntifraudEngineView[];
  baselineConfigId: number;
  candidateConfigId: number | null;
  activeBenchmark: BenchmarkRun | null;
  onBenchmarkCompleted: (bm: BenchmarkRun) => void;
}

export const AnalyticsDrawer: React.FC<AnalyticsDrawerProps> = ({
  open,
  initialTab,
  initialTxCode = null,
  inspectorExperimentId = null,
  onClose,
  experiment,
  intelligence,
  activeEvolution,
  activeExternalEvolution,
  onEvolutionUpdated,
  defenseConfig,
  engines,
  baselineConfigId,
  candidateConfigId,
  activeBenchmark,
  onBenchmarkCompleted,
}) => {
  const { t, scenarioLabel, ruleLabel } = useLab();
  const [tab, setTab] = useState<AnalyticsTab>(initialTab);
  const [inspectorJumpCode, setInspectorJumpCode] = useState<string | null>(null);

  const comparableEngines = engines.filter((e) => e.adapter_type !== "imported");
  const defaultLeftId =
    comparableEngines.find((e) => e.code === "internal_vigilia")?.id ||
    comparableEngines[0]?.id ||
    1;
  const defaultRightId =
    comparableEngines.find((e) => e.code === "external_b")?.id ||
    comparableEngines[1]?.id ||
    defaultLeftId;

  const [leftEngineId, setLeftEngineId] = useState<number>(defaultLeftId);
  const [rightEngineId, setRightEngineId] = useState<number>(defaultRightId);
  const [comparisonResult, setComparisonResult] = useState<EngineComparison | null>(null);
  const [compareErr, setCompareErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      if (initialTxCode) {
        setInspectorJumpCode(initialTxCode);
      }
    }
  }, [open, initialTab, initialTxCode]);

  useEffect(() => {
    if (comparableEngines.length > 0) {
      if (!comparableEngines.some((e) => e.id === leftEngineId)) {
        setLeftEngineId(defaultLeftId);
      }
      if (!comparableEngines.some((e) => e.id === rightEngineId)) {
        setRightEngineId(defaultRightId);
      }
    }
  }, [comparableEngines, defaultLeftId, defaultRightId, leftEngineId, rightEngineId]);

  const compareMutation = useMutation({
    mutationFn: () => {
      if (!experiment) {
        throw new Error("No active dataset to compare");
      }
      setCompareErr(null);
      return api.compareEngines({
        dataset_id: experiment.dataset_id,
        split_name:
          (experiment.split_name as
            | "all"
            | "evaluation"
            | "validation"
            | "calibration") || "evaluation",
        left_engine_id: leftEngineId,
        right_engine_id: rightEngineId,
      });
    },
    onSuccess: (res) => setComparisonResult(res),
    onError: (err: Error) => setCompareErr(err.message),
  });

  if (!open) return null;

  const isExternalExp = experiment && experiment.adapter_type !== "internal";
  const meta = intelligence?.experiment_metadata;
  const comp = experiment?.completeness_json || meta?.completeness || {};
  const m = experiment?.metrics_json;
  const completedDecisions = Number(
    comp.evaluated_count ?? m?.total_transactions ?? 0
  );
  const missingResponses = Number(comp.missing_count ?? 0);
  const totalLegit = m ? m.true_negatives + m.false_positives : 0;

  const engineStatusObj = engines.find((e) => e.id === experiment?.engine_id);

  const tabs: Array<{ key: AnalyticsTab; label: string; icon: React.ReactNode }> = [
    { key: "overview", label: t.v33.tabOverview, icon: <Activity className="h-3.5 w-3.5" /> },
    { key: "scenarios", label: t.v33.tabScenarios, icon: <Layers className="h-3.5 w-3.5" /> },
    { key: "errors", label: t.v33.tabErrors, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    { key: "riskdist", label: t.v33.tabRiskDist, icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { key: "inspector", label: t.v33.tabInspector, icon: <Search className="h-3.5 w-3.5" /> },
    { key: "evolution", label: t.v33.tabEvolution, icon: <GitCompareArrows className="h-3.5 w-3.5" /> },
    { key: "compare", label: t.v33.tabCompare, icon: <Scale className="h-3.5 w-3.5" /> },
    { key: "stability", label: t.v33.tabStability, icon: <BarChart3 className="h-3.5 w-3.5" /> },
  ];

  const activeEvoEvalSlice =
    activeExternalEvolution?.comparison_json?.evaluation_split ||
    activeEvolution?.comparison_json?.evaluation_split;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-5xl bg-[#080A09] h-full shadow-[-24px_0_64px_rgba(0,0,0,0.75)] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-[#0D110F]/90 flex items-center justify-between gap-3 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          <div>
            <h2 className="text-base font-bold text-[#F4F6F4]">
              {t.focus.analyticsTitle}
            </h2>
            <p className="text-xs text-[#A1ABA4] mt-0.5">
              {experiment
                ? `#${experiment.id} · ${experiment.engine_name || ""} (${experiment.defense_version || ""}) · ${experiment.metrics_json.total_transactions} ${t.result.txChecked}`
                : t.focus.analyticsSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.settings.close}
            className="p-2 rounded-xl bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-6 py-2.5 bg-[#171A18]/75 flex flex-wrap gap-1.5">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846] ${
                tab === item.key
                  ? "bg-[#008F36] text-[#F4F6F4]"
                  : "bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4]"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 8.1 OVERVIEW + 11 TRANSPARENCY METADATA */}
          {tab === "overview" && experiment && m && (
            <div className="space-y-5">
              {/* Compact Grouped Summary Table (no 15 huge cards) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-7 rounded-2xl bg-[#171A18] p-5 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                    <div>
                      <div className="text-[#77837C]">Recall</div>
                      <div className="text-xl font-bold text-[#43D17A] mt-0.5">
                        {m.actual_risk_events > 0
                          ? `${(m.recall * 100).toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#77837C]">Precision</div>
                      <div className="text-xl font-bold text-[#F4F6F4] mt-0.5">
                        {m.predicted_risk_events > 0
                          ? `${(m.precision * 100).toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#77837C]">F1 Score</div>
                      <div className="text-xl font-bold text-[#F4F6F4] mt-0.5">
                        {(m.f1_score * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[#77837C]">FPR / FNR</div>
                      <div className="text-sm font-bold text-[#F4F6F4] mt-1.5">
                        {(m.false_positive_rate * 100).toFixed(2)}% /{" "}
                        {(m.false_negative_rate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-[#77837C]">Total Tx</span>
                      <strong className="text-[#F4F6F4]">{m.total_transactions}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77837C]">{t.v33.overviewCompleted}</span>
                      <strong className="text-[#F4F6F4]">{completedDecisions}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77837C]">{t.v33.overviewMissing}</span>
                      <strong
                        className={
                          missingResponses > 0 ? "text-[#E3AD56]" : "text-[#F4F6F4]"
                        }
                      >
                        {missingResponses}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77837C]">{t.result.colRisks}</span>
                      <strong className="text-[#F4F6F4]">{m.actual_risk_events}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77837C]">{t.v33.overviewLegit}</span>
                      <strong className="text-[#F4F6F4]">{totalLegit}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#77837C]">{t.result.timeLabel}</span>
                      <strong className="text-[#F4F6F4]">
                        {experiment.processing_time_ms.toFixed(1)} ms
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <ConfusionMatrixCard matrix={experiment.confusion_matrix_json} />
                </div>
              </div>

              {/* 11. Run Transparency & Metadata */}
              <div className="rounded-2xl bg-[#171A18] p-5 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#77837C]">
                  {t.v33.runMetaTitle}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaEngine}</div>
                    <div className="font-semibold text-[#F4F6F4] mt-0.5">
                      {experiment.engine_name}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaVersion}</div>
                    <div className="font-mono font-semibold text-[#43D17A] mt-0.5">
                      {experiment.defense_version || "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaDatasetId}</div>
                    <div className="font-mono text-[#F4F6F4] mt-0.5">
                      #{experiment.dataset_id} · {meta?.dataset_name || experiment.dataset_name || "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaSeed}</div>
                    <div className="font-mono text-[#F4F6F4] mt-0.5">
                      {meta?.seed ?? "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaCustomers}</div>
                    <div className="tabular-nums text-[#F4F6F4] mt-0.5">
                      {meta?.customer_count ?? "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaRiskRatio}</div>
                    <div className="tabular-nums text-[#F4F6F4] mt-0.5">
                      {meta?.risk_ratio != null
                        ? `${(meta.risk_ratio * 100).toFixed(1)}%`
                        : "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaSplit}</div>
                    <div className="font-mono text-[#F4F6F4] mt-0.5">
                      {experiment.split_name}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaDate}</div>
                    <div className="text-[#F4F6F4] mt-0.5">
                      {new Date(experiment.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaConnType}</div>
                    <div className="font-mono text-[#F4F6F4] mt-0.5">
                      {experiment.adapter_type || "internal"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#202522]">
                    <div className="text-[#77837C]">{t.v33.metaMode}</div>
                    <div className="font-mono text-[#F4F6F4] mt-0.5">
                      {experiment.diagnostic_mode || "white_box"}
                      {meta?.supports_config ? " · Configurable" : " · Non-configurable"}
                    </div>
                  </div>
                  {isExternalExp && (
                    <>
                      <div className="p-2.5 rounded-xl bg-[#202522]">
                        <div className="text-[#77837C]">{t.v33.metaBatches}</div>
                        <div className="font-mono text-[#F4F6F4] mt-0.5">
                          {Number(comp.batch_count ?? 1)} / {Number(comp.failed_requests ?? 0)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#202522]">
                        <div className="text-[#77837C]">{t.v33.metaCompleteness}</div>
                        <div className="font-mono text-[#F4F6F4] mt-0.5">
                          {comp.completeness_ratio != null
                            ? `${(Number(comp.completeness_ratio) * 100).toFixed(1)}%`
                            : "100.0%"}
                          {engineStatusObj
                            ? ` · ${engineStatusObj.online ? t.ext.connected : t.ext.disconnected}`
                            : ""}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={api.exportUrl(experiment.id, "json")}
                  download
                  className="lab-btn-secondary"
                >
                  <FileJson className="h-3.5 w-3.5 text-[#43D17A]" />
                  <span>{t.history.exportJson}</span>
                </a>
                <a
                  href={api.exportUrl(experiment.id, "csv")}
                  download
                  className="lab-btn-secondary"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-[#43D17A]" />
                  <span>{t.history.exportCsv}</span>
                </a>
                <a
                  href={api.exportUrl(experiment.id, "html")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lab-btn-secondary"
                >
                  <Printer className="h-3.5 w-3.5 text-[#43D17A]" />
                  <span>{t.history.exportHtml}</span>
                </a>
              </div>
            </div>
          )}

          {/* 8.2 SCENARIO ANALYSIS */}
          {tab === "scenarios" && experiment && (
            <div className="space-y-5">
              <ScenarioDetectionChart scenarios={experiment.scenario_metrics_json} />

              <div className="rounded-2xl bg-[#171A18] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="bg-[#202522] text-[#77837C]">
                      <tr>
                        <th className="px-4 py-3 text-left">{t.result.colScenario}</th>
                        <th className="px-3 py-3 text-right">{t.result.colTotal}</th>
                        <th className="px-3 py-3 text-right">{t.result.colRisks}</th>
                        <th className="px-3 py-3 text-right">{t.result.colCaught}</th>
                        <th className="px-3 py-3 text-right">{t.result.colMissed}</th>
                        <th className="px-3 py-3 text-right">{t.result.colFalseBlocks}</th>
                        <th className="px-4 py-3 text-right">{t.result.colDetection}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {experiment.scenario_metrics_json.map((s) => (
                        <tr key={s.scenario_type} className="hover:bg-[#202522]/60">
                          <td className="px-4 py-2.5 font-medium text-[#F4F6F4]">
                            {scenarioLabel(s.scenario_type)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#A1ABA4]">
                            {s.total_transactions}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#A1ABA4]">
                            {s.actual_risk_events}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#43D17A] font-semibold">
                            {s.true_positives}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#E3AD56] font-semibold">
                            {s.false_negatives}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#F16B6B] font-semibold">
                            {s.false_positives}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-[#F4F6F4]">
                            {s.actual_risk_events > 0
                              ? `${(s.recall * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 8.3 ERROR ANALYSIS */}
          {tab === "errors" && experiment && intelligence && (
            <div className="space-y-5">
              <ErrorCompositionChart scenarios={experiment.scenario_metrics_json} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-[#171A18] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#F4F6F4]">
                      <ShieldAlert className="h-4 w-4 text-[#E3AD56]" />
                      <span>{t.detect.fnTitle}</span>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#E3AD56]">
                      {intelligence.false_negative_analysis.total_false_negatives}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between p-2.5 rounded-xl bg-[#202522]">
                      <span className="text-[#A1ABA4]">{t.detect.nearThreshold}</span>
                      <strong className="tabular-nums text-[#F4F6F4]">
                        {
                          intelligence.false_negative_analysis.miss_categories
                            .near_threshold_misses.count
                        }
                      </strong>
                    </div>
                    <div className="flex justify-between p-2.5 rounded-xl bg-[#202522]">
                      <span className="text-[#A1ABA4]">{t.detect.singleRule}</span>
                      <strong className="tabular-nums text-[#F4F6F4]">
                        {
                          intelligence.false_negative_analysis.miss_categories
                            .partial_single_rule_misses.count
                        }
                      </strong>
                    </div>
                    <div className="flex justify-between p-2.5 rounded-xl bg-[#202522]">
                      <span className="text-[#A1ABA4]">{t.detect.zeroScore}</span>
                      <strong className="tabular-nums text-[#F4F6F4]">
                        {
                          intelligence.false_negative_analysis.miss_categories
                            .untriggered_blind_spots.count
                        }
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-[#171A18] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#F4F6F4]">
                      {t.detect.fpTitle}
                    </span>
                    <span className="font-mono text-xs font-semibold text-[#F16B6B]">
                      {intelligence.false_positive_analysis.total_false_positives} (
                      {(
                        intelligence.false_positive_analysis.false_positive_rate * 100
                      ).toFixed(2)}
                      %)
                    </span>
                  </div>
                  {intelligence.false_positive_analysis.participating_rules.length === 0 ? (
                    <div className="p-3 rounded-xl bg-[#202522] text-xs text-[#43D17A]">
                      {t.detect.noFalseBlocks}
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {intelligence.false_positive_analysis.participating_rules.map((pr) => (
                        <div
                          key={pr.rule}
                          className="flex justify-between items-center p-2.5 rounded-xl bg-[#202522]"
                        >
                          <span className="text-[#F4F6F4]">{ruleLabel(pr.rule)}</span>
                          <span className="font-mono font-semibold text-[#F16B6B]">
                            {pr.fp_count}
                            {pr.avg_contribution > 0 ? ` (+${pr.avg_contribution})` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick clickable error sample chips jumping to Inspector */}
              {intelligence.transaction_inspector_samples.some(
                (s) => s.outcome === "FN" || s.outcome === "FP"
              ) && (
                <div className="rounded-2xl bg-[#171A18] p-5 space-y-3">
                  <div className="text-xs font-semibold text-[#A1ABA4]">
                    {t.ext.failedCasesTitle}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {intelligence.transaction_inspector_samples
                      .filter((s) => s.outcome === "FN" || s.outcome === "FP")
                      .slice(0, 12)
                      .map((smp) => (
                        <button
                          key={smp.transaction_code}
                          type="button"
                          onClick={() => {
                            setInspectorJumpCode(smp.transaction_code);
                            setTab("inspector");
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-mono transition-colors ${
                            smp.outcome === "FN"
                              ? "bg-[#E3AD56]/15 text-[#E3AD56] hover:bg-[#E3AD56]/25"
                              : "bg-[#F16B6B]/15 text-[#F16B6B] hover:bg-[#F16B6B]/25"
                          }`}
                        >
                          {smp.outcome} · {smp.transaction_code}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 8.4 RISK SCORE DISTRIBUTION */}
          {tab === "riskdist" && (
            <RiskDistributionChart
              available={Boolean(intelligence?.risk_score_distribution?.available)}
              buckets={intelligence?.risk_score_distribution?.buckets || []}
            />
          )}

          {/* 8.5 TRANSACTION INSPECTOR */}
          {tab === "inspector" && experiment && (
            <TransactionInspectorView
              experimentId={inspectorExperimentId || experiment.id}
              scenarios={experiment.scenarios_json}
              engineName={experiment.engine_name}
              defenseVersion={experiment.defense_version || undefined}
              initialTxCode={inspectorJumpCode}
            />
          )}

          {/* EVOLUTION & CONFIG */}
          {tab === "evolution" && (
            <div className="space-y-6">
              {activeEvoEvalSlice && (
                <DefenseComparisonChart
                  baseline={activeEvoEvalSlice.baseline}
                  candidate={activeEvoEvalSlice.candidate}
                  baselineLabel={
                    activeExternalEvolution?.baseline_label ||
                    activeEvolution?.comparison_json.baseline_version ||
                    t.improve.baselineCol
                  }
                  candidateLabel={
                    activeExternalEvolution?.candidate_label ||
                    activeEvolution?.comparison_json.candidate_version ||
                    t.improve.proposedCol
                  }
                />
              )}

              {isExternalExp && activeExternalEvolution ? (
                <div className="rounded-2xl bg-[#171A18] p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#F4F6F4]">
                      {activeExternalEvolution.baseline_label} →{" "}
                      {activeExternalEvolution.candidate_label || "—"}
                    </h3>
                    <p className="text-xs text-[#A1ABA4] mt-1">
                      {activeExternalEvolution.tradeoff_assessment}
                    </p>
                  </div>

                  {activeExternalEvolution.candidates_json.length > 0 && (
                    <div className="overflow-x-auto rounded-xl bg-[#202522]">
                      <table className="w-full text-xs tabular-nums">
                        <thead className="bg-[#101211]/50 text-[#77837C]">
                          <tr>
                            <th className="px-3 py-2.5 text-left">#</th>
                            <th className="px-3 py-2.5 text-left">{t.result.colScenario}</th>
                            <th className="px-3 py-2.5 text-right">{t.result.colDetection}</th>
                            <th className="px-3 py-2.5 text-right">{t.result.colFpr}</th>
                            <th className="px-3 py-2.5 text-right">F1</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {activeExternalEvolution.candidates_json.map((cand) => (
                            <tr key={cand.key}>
                              <td className="px-3 py-2 font-mono font-bold text-[#F4F6F4]">
                                {cand.key}
                              </td>
                              <td className="px-3 py-2 text-[#A1ABA4]">{cand.name}</td>
                              <td className="px-3 py-2 text-right font-semibold text-[#43D17A]">
                                {(cand.validation_metrics.recall * 100).toFixed(1)}%
                              </td>
                              <td className="px-3 py-2 text-right text-[#F4F6F4]">
                                {(cand.validation_metrics.false_positive_rate * 100).toFixed(2)}%
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-[#F4F6F4]">
                                {(cand.validation_metrics.f1_score * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {Object.keys(activeExternalEvolution.proposed_config_json || {}).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-[#F4F6F4]">
                        {t.improve.changedParamsTitle}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {Object.entries(activeExternalEvolution.proposed_config_json).map(
                          ([k, v]) => (
                            <div
                              key={k}
                              className="rounded-xl bg-[#202522] px-3 py-2 flex justify-between font-mono text-[#A1ABA4]"
                            >
                              <span>{k}</span>
                              <span>
                                {String(
                                  activeExternalEvolution.baseline_config_snapshot_json?.[k] ?? "—"
                                )}{" "}
                                → <strong className="text-[#43D17A]">{String(v)}</strong>
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                experiment &&
                !isExternalExp && (
                  <ImprovementSection
                    experimentId={experiment.id}
                    activeEvolution={activeEvolution}
                    onEvolutionCompleted={onEvolutionUpdated}
                    defaultShowDetails={true}
                  />
                )
              )}

              {!isExternalExp && defenseConfig && (
                <div className="rounded-2xl bg-[#171A18] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#F4F6F4]">
                      {t.focus.activeRulesTitle} ({defenseConfig.version})
                    </h3>
                    <span className="text-xs font-mono text-[#A1ABA4]">
                      {t.focus.decisionThresholdLabel}: {defenseConfig.decision_threshold}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {Object.entries(defenseConfig.rules_config_json).map(([key, cfg]) => (
                      <div key={key} className="rounded-xl bg-[#202522] p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#F4F6F4]">
                            {ruleLabel(key)}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              cfg.enabled
                                ? "bg-[#43D17A]/15 text-[#43D17A]"
                                : "bg-[#171A18] text-[#77837C]"
                            }`}
                          >
                            {cfg.enabled ? t.advanced.enabled : t.advanced.disabled}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[#A1ABA4] flex flex-wrap gap-3">
                          <span>
                            {t.advanced.thresholdHint}: {cfg.threshold}
                          </span>
                          <span>
                            {t.advanced.weightHint}: {cfg.weight}
                          </span>
                          {cfg.window_minutes != null && (
                            <span>
                              {t.advanced.windowHint}: {cfg.window_minutes}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ENGINE COMPARISON */}
          {tab === "compare" && (
            <div className="rounded-2xl bg-[#171A18] p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#F4F6F4]">{t.ext.compareTitle}</h3>
                <p className="text-xs text-[#A1ABA4] mt-0.5">
                  {t.ext.compareTradeoffNote}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#77837C] mb-1">
                    {t.ext.compareLeftLabel}
                  </label>
                  <select
                    className="lab-input text-xs"
                    value={leftEngineId}
                    onChange={(e) => setLeftEngineId(Number(e.target.value))}
                  >
                    {comparableEngines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#77837C] mb-1">
                    {t.ext.compareRightLabel}
                  </label>
                  <select
                    className="lab-input text-xs"
                    value={rightEngineId}
                    onChange={(e) => setRightEngineId(Number(e.target.value))}
                  >
                    {comparableEngines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => compareMutation.mutate()}
                disabled={!experiment || compareMutation.isPending}
                className="lab-btn-accent text-xs py-2 px-4"
              >
                {compareMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                <span>
                  {compareMutation.isPending
                    ? t.ext.compareRunning
                    : t.ext.compareRunBtn}
                </span>
              </button>

              {compareErr && (
                <div className="rounded-xl bg-[#F16B6B]/10 p-3 text-xs text-[#F16B6B]">
                  {compareErr}
                </div>
              )}

              {comparisonResult && (
                <div className="space-y-4 pt-3 border-t border-white/[0.06]">
                  <DefenseComparisonChart
                    baseline={comparisonResult.comparison_json.left.metrics}
                    candidate={comparisonResult.comparison_json.right.metrics}
                    baselineLabel={comparisonResult.comparison_json.left.engine_name}
                    candidateLabel={comparisonResult.comparison_json.right.engine_name}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {[
                      comparisonResult.comparison_json.left,
                      comparisonResult.comparison_json.right,
                    ].map((side, idx) => (
                      <div key={idx} className="rounded-xl bg-[#202522] p-4 space-y-2">
                        <div className="font-bold text-sm text-[#F4F6F4]">
                          {side.engine_name} ({side.version})
                        </div>
                        <div className="grid grid-cols-2 gap-2 tabular-nums text-[#A1ABA4]">
                          <div>
                            Recall:{" "}
                            <strong className="text-[#43D17A]">
                              {(side.metrics.recall * 100).toFixed(1)}%
                            </strong>
                          </div>
                          <div>
                            Precision:{" "}
                            <strong className="text-[#F4F6F4]">
                              {(side.metrics.precision * 100).toFixed(1)}%
                            </strong>
                          </div>
                          <div>
                            F1:{" "}
                            <strong className="text-[#F4F6F4]">
                              {(side.metrics.f1_score * 100).toFixed(1)}%
                            </strong>
                          </div>
                          <div>
                            FPR:{" "}
                            <strong className="text-[#F4F6F4]">
                              {(side.metrics.false_positive_rate * 100).toFixed(2)}%
                            </strong>
                          </div>
                          <div>
                            TP: <strong className="text-[#F4F6F4]">{side.metrics.true_positives}</strong> · FN:{" "}
                            <strong className="text-[#E3AD56]">
                              {side.metrics.false_negatives}
                            </strong>
                          </div>
                          <div>
                            FP:{" "}
                            <strong className="text-[#F16B6B]">
                              {side.metrics.false_positives}
                            </strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-[#A1ABA4]">{comparisonResult.summary_text}</p>
                </div>
              )}
            </div>
          )}

          {/* STABILITY */}
          {tab === "stability" && (
            <StabilitySection
              baselineConfigId={baselineConfigId}
              candidateConfigId={candidateConfigId}
              activeBenchmark={activeBenchmark}
              onBenchmarkCompleted={onBenchmarkCompleted}
              defaultOpenTable={true}
            />
          )}
        </div>
      </aside>
    </div>
  );
};
