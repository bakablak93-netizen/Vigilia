import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  HelpCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type {
  ExperimentSummary,
  SecurityIntelligenceReport,
  TransactionInspectorItem,
} from "../../types/api";
import {
  DetectionOverviewChart,
  ScenarioDetectionChart,
} from "../charts/SecurityCharts";
import { buildWeaknessPlainStory } from "../../utils/humanExplain";
import type { AnalyticsTab } from "./AnalyticsDrawer";
import type { SelectedWeaknessDetail } from "./WeaknessDetailModal";

export interface RankedWeaknessItem extends SelectedWeaknessDetail {
  missedCount: number;
  importanceScore: number;
  measuredLabel?: string;
}

interface WorkspaceResultsBlockProps {
  experiment: ExperimentSummary;
  intelligence: SecurityIntelligenceReport | null;
  intelligenceLoading: boolean;
  weaknesses: RankedWeaknessItem[];
  onInspectTransaction: (txCode: string) => void;
  onOpenAnalytics: (tab: AnalyticsTab) => void;
}

export const WorkspaceResultsBlock: React.FC<WorkspaceResultsBlockProps> = ({
  experiment,
  intelligence,
  intelligenceLoading,
  weaknesses,
  onInspectTransaction,
  onOpenAnalytics,
}) => {
  const { t, lang, scenarioLabel, ruleLabel, formatKzt } = useLab();
  const [expandedWeaknessIds, setExpandedWeaknessIds] = useState<string[]>([]);
  const [showAllWeaknesses, setShowAllWeaknesses] = useState(false);
  const [showFormulaHelp, setShowFormulaHelp] = useState(false);

  const m = experiment.metrics_json;
  const hasMissed = m.false_negatives > 0;
  const detectionPct =
    m.actual_risk_events > 0 ? (m.true_positives / m.actual_risk_events) * 100 : 0;
  const fprPct = m.false_positive_rate * 100;
  const missingCount = Number(experiment.completeness_json?.missing_count || 0);
  const totalSent = Number(
    experiment.completeness_json?.total_sent || m.total_transactions
  );
  const isBlackBox = experiment.diagnostic_mode === "black_box";
  const hasRiskScores =
    experiment.adapter_type === "internal" ||
    Boolean(experiment.completeness_json?.has_risk_scores ?? true);

  const formatNum = (val: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-US" : "ru-RU").format(val);
  const formatDec = (val: number, d = 1) => {
    const fixed = val.toFixed(d);
    return lang === "en" ? fixed : fixed.replace(".", ",");
  };

  const toggleWeakness = (id: string) => {
    setExpandedWeaknessIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const visibleWeaknesses = showAllWeaknesses
    ? weaknesses
    : weaknesses.slice(0, 3);

  const severityBadge: Record<RankedWeaknessItem["severity"], string> = {
    critical: "bg-[#F16B6B]/15 text-[#F16B6B]",
    high: "bg-[#E3AD56]/15 text-[#E3AD56]",
    medium: "bg-[#43D17A]/15 text-[#43D17A]",
  };

  return (
    <div className="space-y-6 focus-enter">
      {/* 01. OVERVIEW & DOMINANT CHARTS */}
      <section
        id="sec-overview"
        className="v4-surface p-5 sm:p-7 space-y-6 scroll-mt-20"
      >
        {/* Header Row (Clean, zero duplicate prose) */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#77837C]">
              <span className="font-mono font-bold text-[#43D17A]">01</span>
              <span className="font-semibold text-[#F4F6F4]">
                {experiment.engine_name || t.ext.internalLabel}
              </span>
              {experiment.defense_version && (
                <span className="font-mono text-[#77837C]">
                  {experiment.defense_version}
                </span>
              )}
              {isBlackBox && (
                <span className="px-2 py-0.5 rounded-full bg-[#E3AD56]/15 text-[#E3AD56] text-[10px] font-semibold">
                  {t.ext.modeBlackBox}
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F4F6F4]">
              {hasMissed ? t.focus.state2SubtitleMissed : t.focus.state2SubtitleClean}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs tabular-nums text-[#77837C]">
              {formatNum(m.total_transactions)} {t.v34.sec1OpsUnit} ·{" "}
              {experiment.processing_time_ms.toFixed(0)} ms
            </span>
            <button
              type="button"
              onClick={() => onOpenAnalytics("overview")}
              className="btn-subtle px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <BarChart3 className="h-3.5 w-3.5 text-[#43D17A]" />
              <span>{t.v34.sec2OpenDrawer}</span>
            </button>
          </div>
        </div>

        {missingCount > 0 && (
          <div className="rounded-2xl bg-[#E3AD56]/12 px-4 py-3 text-xs text-[#E3AD56] flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {t.ext.incompleteWarning} ({missingCount} / {totalSent})
            </span>
          </div>
        )}

        {/* Primary Metrics Grid (Elevated Volumetric Surfaces) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="dp-elevated p-4 space-y-1">
            <div className="text-xs text-[#A1ABA4] flex items-center justify-between">
              <span>Recall ({t.v33.tpLegend})</span>
              <span className="font-mono text-[11px] text-[#77837C]">
                TP / (TP+FN)
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[#43D17A]">
              {formatDec(detectionPct, 1)}%
            </div>
            <div className="text-xs text-[#A1ABA4] tabular-nums">
              {m.true_positives} / {m.actual_risk_events} {t.v33.distRisky.toLowerCase()} ·{" "}
              {t.v33.missedThreatsShort}:{" "}
              <span className="text-[#E3AD56] font-semibold">{m.false_negatives}</span>
            </div>
          </div>

          <div className="dp-elevated p-4 space-y-1">
            <div className="text-xs text-[#A1ABA4] flex items-center justify-between">
              <span>{t.focus.fprRateLabel}</span>
              <span className="font-mono text-[11px] text-[#77837C]">
                FP / (FP+TN)
              </span>
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                fprPct > 3 ? "text-[#F16B6B]" : fprPct > 1 ? "text-[#E3AD56]" : "text-[#F4F6F4]"
              }`}
            >
              {formatDec(fprPct, 2)}%
            </div>
            <div className="text-xs text-[#A1ABA4] tabular-nums">
              {m.false_positives} / {m.false_positives + m.true_negatives}{" "}
              {t.v33.distLegit.toLowerCase()}
            </div>
          </div>

          <div className="dp-elevated p-4 space-y-1">
            <div className="text-xs text-[#A1ABA4] flex items-center justify-between">
              <span>Precision / F1</span>
              <span className="font-mono text-[11px] text-[#77837C]">
                {experiment.split_name}
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[#F4F6F4]">
              {formatDec(m.precision * 100, 1)}%{" "}
              <span className="text-sm font-medium text-[#A1ABA4]">
                / {(m.f1_score * 100).toFixed(1)}%
              </span>
            </div>
            <div className="text-xs text-[#77837C]">
              TN: {formatNum(m.true_negatives)} · TP: {m.true_positives} · FP:{" "}
              {m.false_positives} · FN: {m.false_negatives}
            </div>
          </div>
        </div>

        {/* Dominant Overview + Scenario Visualization (Frame 13 Focal Analytics) */}
        <div className="space-y-4">
          <div className="v4-surface-inset p-4">
            <DetectionOverviewChart
              tp={m.true_positives}
              fn={m.false_negatives}
              fp={m.false_positives}
              tn={m.true_negatives}
            />
          </div>

          {experiment.scenario_metrics_json?.length > 0 && (
            <ScenarioDetectionChart scenarios={experiment.scenario_metrics_json} />
          )}
        </div>

        {/* Clear Recall & FPR Meaning Strip */}
        <div className="v4-surface-inset px-4 py-3.5 space-y-2">
          <button
            type="button"
            onClick={() => setShowFormulaHelp((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-medium text-[#A1ABA4] hover:text-[#F4F6F4]"
          >
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle className="h-3.5 w-3.5 text-[#43D17A]" />
              <span>
                {t.v34.recallFormula} &amp; {t.v34.fprFormula}
              </span>
            </span>
            {showFormulaHelp ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          {showFormulaHelp && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs text-[#A1ABA4] leading-relaxed">
              <div className="dp-elevated p-3 space-y-1">
                <div className="font-semibold text-[#F4F6F4]">{t.v34.recallFormula}</div>
                <p>{t.v34.recallExplain}</p>
              </div>
              <div className="dp-elevated p-3 space-y-1">
                <div className="font-semibold text-[#F4F6F4]">{t.v34.fprFormula}</div>
                <p>{t.v34.fprExplain}</p>
                <p className="text-[#E3AD56] text-[11px] pt-0.5">{t.v34.fprWhyBad}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 02. WEAKNESSES & SAMPLE TRANSACTIONS */}
      <section
        id="sec-weaknesses"
        className="v4-surface p-5 sm:p-7 space-y-4 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center font-mono font-bold text-[#E3AD56] bg-[#A8843D]/20 px-2.5 py-0.5 rounded-full">
                02
              </span>
              <span className="font-semibold uppercase tracking-wider text-[#A1ABA4]">
                {t.v4.navWeaknesses}
              </span>
            </div>
            <h3 className="text-lg font-bold text-[#F4F6F4]">
              {t.v34.weaknessesTitle} ({weaknesses.length})
            </h3>
            <p className="text-xs text-[#77837C]">{t.v34.weaknessesTopNote}</p>
          </div>
          {weaknesses.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllWeaknesses((v) => !v)}
              className="btn-subtle px-3 py-1.5 text-xs font-medium"
            >
              {showAllWeaknesses
                ? t.v34.hideExtraWeaknesses
                : `${t.v34.showAllWeaknesses} (${weaknesses.length})`}
            </button>
          )}
        </div>

        {intelligenceLoading && !intelligence ? (
          <div className="rounded-2xl bg-[#202522] p-5 flex items-center gap-3 text-xs text-[#A1ABA4]">
            <Loader2 className="h-4 w-4 animate-spin text-[#43D17A]" />
            <span>{t.result.loadingState}</span>
          </div>
        ) : visibleWeaknesses.length === 0 ? (
          <div className="rounded-2xl bg-[#202522] p-5 flex items-center gap-3 text-sm text-[#43D17A]">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span>{t.focus.noProblemsNote}</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibleWeaknesses.map((w) => {
              const isOpen = expandedWeaknessIds.includes(w.id);
              const scenRow = intelligence?.weakness_explorer.find(
                (r) => r.scenario_type === w.scenarioType
              );
              const samples: TransactionInspectorItem[] = (
                intelligence?.transaction_inspector_samples || []
              )
                .filter((s) =>
                  w.id.startsWith("fp-")
                    ? s.scenario_type === w.scenarioType && s.outcome === "FP"
                    : s.scenario_type === w.scenarioType
                )
                .slice(0, 5);

              const realReasons = Array.from(
                new Set(
                  samples.flatMap((s) =>
                    (s.triggered_rules || []).map((r) => ruleLabel(r.rule))
                  )
                )
              ).slice(0, 4);

              const measuredText = scenRow
                ? w.id.startsWith("fp-")
                  ? `${scenRow.false_positives} FP (${(
                      scenRow.false_positive_rate * 100
                    ).toFixed(2)}%)`
                  : `${scenRow.detected_risks} / ${scenRow.actual_risk_events} (${(
                      scenRow.recall * 100
                    ).toFixed(1)}%)`
                : "";

              return (
                <div
                  key={w.id}
                  className="rounded-2xl bg-[#202522] overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => toggleWeakness(w.id)}
                    className="w-full px-4 py-3.5 text-left flex items-start justify-between gap-3 hover:bg-[#262C28] transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <AlertTriangle
                        className={`h-4 w-4 shrink-0 mt-0.5 ${
                          w.severity === "critical"
                            ? "text-[#F16B6B]"
                            : w.severity === "high"
                              ? "text-[#E3AD56]"
                              : "text-[#43D17A]"
                        }`}
                      />
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#F4F6F4]">
                            {w.title}
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              severityBadge[w.severity]
                            }`}
                          >
                            {scenarioLabel(w.scenarioType)}
                          </span>
                          {measuredText && (
                            <span className="text-[11px] font-mono text-[#A1ABA4] tabular-nums">
                              {measuredText}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#A1ABA4] leading-relaxed">
                          {w.explanation}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-[#77837C] mt-1">
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-3 border-t border-white/[0.06] space-y-3 bg-[#1A1E1C]">
                      {(() => {
                        const isFpWeak = w.id.startsWith("fp-");
                        const story = buildWeaknessPlainStory(
                          scenarioLabel(w.scenarioType),
                          scenRow?.missed_risks ?? w.missedCount,
                          scenRow?.actual_risk_events ?? w.missedCount,
                          scenRow?.false_positives ?? (isFpWeak ? w.missedCount : 0),
                          isFpWeak,
                          isBlackBox,
                          lang
                        );
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                            <div className="rounded-xl bg-[#202522] p-3 space-y-1">
                              <div className="text-[#77837C] font-semibold">
                                {t.v4h.weakWhatHappened}
                              </div>
                              <p className="text-[#F4F6F4] leading-relaxed">
                                {story.whatHappened}
                              </p>
                              {scenRow && (
                                <div className="text-[11px] font-mono text-[#A1ABA4] pt-0.5 tabular-nums">
                                  TP: {scenRow.detected_risks} · FN: {scenRow.missed_risks} · FP:{" "}
                                  {scenRow.false_positives}
                                </div>
                              )}
                            </div>

                            <div className="rounded-xl bg-[#202522] p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[#77837C] font-semibold">
                                  {t.v4h.weakWhyProblem}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    isBlackBox
                                      ? "bg-[#E3AD56]/15 text-[#E3AD56]"
                                      : "bg-[#43D17A]/15 text-[#43D17A]"
                                  }`}
                                >
                                  {isBlackBox ? "Black-Box" : "White-Box"}
                                </span>
                              </div>
                              <p className="text-[#D4DDD7] leading-relaxed">
                                {story.whyProblem}
                              </p>
                              {!isBlackBox && realReasons.length > 0 && (
                                <p className="text-[11px] text-[#A1ABA4] pt-0.5">
                                  {realReasons.join(" · ")}
                                  {scenRow
                                    ? ` · Avg score: ${scenRow.avg_risk_score.toFixed(1)}`
                                    : ""}
                                </p>
                              )}
                            </div>

                            <div className="rounded-xl bg-[#202522] p-3 space-y-1">
                              <div className="text-[#43D17A] font-semibold">
                                {t.v4h.weakWhatToCheck}
                              </div>
                              <p className="text-[#D4DDD7] leading-relaxed">
                                {story.whatToCheck}
                              </p>
                            </div>
                          </div>
                        );
                      })()}

                      {samples.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-semibold text-[#77837C]">
                            {t.v34.sampleOpsTitle}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {samples.slice(0, 4).map((s) => (
                              <button
                                key={s.transaction_code}
                                type="button"
                                onClick={() =>
                                  onInspectTransaction(s.transaction_code)
                                }
                                className="rounded-xl bg-[#202522] hover:bg-[#272D29] px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="font-mono font-semibold text-[#F4F6F4]">
                                      {s.transaction_code}
                                    </span>
                                    <span
                                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                        s.outcome === "FN"
                                          ? "bg-[#E3AD56]/15 text-[#E3AD56]"
                                          : s.outcome === "FP"
                                            ? "bg-[#F16B6B]/15 text-[#F16B6B]"
                                            : "bg-[#43D17A]/15 text-[#43D17A]"
                                      }`}
                                    >
                                      {s.outcome}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-[#A1ABA4] tabular-nums truncate">
                                    {formatKzt(s.amount_kzt)} ·{" "}
                                    {hasRiskScores && s.risk_score !== null
                                      ? `Score ${s.risk_score.toFixed(1)}`
                                      : t.v33.inspectorScoreUnavailable}
                                  </div>
                                </div>
                                <Eye className="h-3.5 w-3.5 text-[#77837C] shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
