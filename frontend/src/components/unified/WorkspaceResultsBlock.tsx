import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
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
import { AnimatedNumber, getRecallColorClass } from "../v4/AnimatedNumber";
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
  onOpenAnalytics?: (tab: AnalyticsTab) => void;
}

export const WorkspaceResultsBlock: React.FC<WorkspaceResultsBlockProps> = ({
  experiment,
  intelligence,
  intelligenceLoading,
  weaknesses,
  onInspectTransaction,
}) => {
  const { t, lang, scenarioLabel, ruleLabel, formatKzt } = useLab();
  const [expandedWeaknessIds, setExpandedWeaknessIds] = useState<string[]>([]);
  const [expandedTraceCodes, setExpandedTraceCodes] = useState<string[]>([]);
  const [showAllWeaknesses, setShowAllWeaknesses] = useState(false);
  const [showFormulaHelp, setShowFormulaHelp] = useState(false);

  const toggleTrace = (txCode: string) => {
    setExpandedTraceCodes((prev) =>
      prev.includes(txCode) ? prev.filter((x) => x !== txCode) : [...prev, txCode]
    );
  };

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
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#B8C0BC]">
              <span className="font-mono font-bold text-[#43D17A]">01</span>
              <span className="font-semibold text-[#F1F5F9]">
                {experiment.engine_name || t.ext.internalLabel}
              </span>
              {experiment.defense_version && (
                <span className="font-mono text-[#B8C0BC]">
                  {experiment.defense_version}
                </span>
              )}
              {isBlackBox && (
                <span className="px-2.5 py-0.5 rounded-full bg-[#E3AD56]/15 text-[#E3AD56] text-[13px] font-semibold">
                  {t.ext.modeBlackBox}
                </span>
              )}
            </div>
            <h2 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-[#F1F5F9]">
              {hasMissed ? t.focus.state2SubtitleMissed : t.focus.state2SubtitleClean}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[13px] tabular-nums text-[#B8C0BC]">
              {formatNum(m.total_transactions)} {t.v34.sec1OpsUnit} ·{" "}
              {experiment.processing_time_ms.toFixed(0)} ms
            </span>
          </div>
        </div>

        {missingCount > 0 && (
          <div className="rounded-2xl bg-[#E3AD56]/12 px-4 py-3 text-sm text-[#E3AD56] flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {t.ext.incompleteWarning} ({missingCount} / {totalSent})
            </span>
          </div>
        )}

        {/* Primary Metrics Grid (Elevated Volumetric Surfaces + Stagger) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 v4-stagger">
          <div className="dp-elevated p-4 space-y-1.5">
            <div className="text-[13px] text-[#CBD5E1] flex items-center justify-between gap-2">
              <span className="font-medium">Recall · TP</span>
              <span
                title={`${t.v34.recallFormula} — ${t.v34.recallExplain}`}
                aria-label={t.v34.recallFormula}
                className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/[0.06] text-[#B8C0BC] hover:text-[#43D17A] cursor-help shrink-0 transition-colors"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
            <div
              className={`text-2xl sm:text-[26px] font-bold tabular-nums ${getRecallColorClass(detectionPct)}`}
            >
              <AnimatedNumber
                value={detectionPct}
                formatter={(v) => `${formatDec(v, 1)}%`}
              />
            </div>
            <div className="text-[13px] text-[#B8C0BC] tabular-nums">
              {m.true_positives} / {m.actual_risk_events} {t.v33.distRisky.toLowerCase()} ·{" "}
              {t.v33.missedThreatsShort}:{" "}
              <span className="text-[#E3AD56] font-semibold">{m.false_negatives}</span>
            </div>
          </div>

          <div className="dp-elevated p-4 space-y-1.5">
            <div className="text-[13px] text-[#CBD5E1] flex items-center justify-between gap-2">
              <span className="font-medium">{t.focus.fprRateLabel}</span>
              <span
                title={`${t.v34.fprFormula} — ${t.v34.fprExplain}`}
                aria-label={t.v34.fprFormula}
                className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/[0.06] text-[#B8C0BC] hover:text-[#43D17A] cursor-help shrink-0 transition-colors"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
            <div
              className={`text-2xl sm:text-[26px] font-bold tabular-nums ${
                fprPct > 3 ? "text-rose-400" : fprPct > 1 ? "text-amber-400" : "text-[#F1F5F9]"
              }`}
            >
              <AnimatedNumber
                value={fprPct}
                formatter={(v) => `${formatDec(v, 2)}%`}
              />
            </div>
            <div className="text-[13px] text-[#B8C0BC] tabular-nums">
              {m.false_positives} / {m.false_positives + m.true_negatives}{" "}
              {t.v33.distLegit.toLowerCase()}
            </div>
          </div>

          <div className="dp-elevated p-4 space-y-1.5">
            <div className="text-[13px] text-[#CBD5E1] flex items-center justify-between gap-2">
              <span className="font-medium">Precision / F1</span>
              <span
                title={`Precision = TP / (TP + FP) · F1 = 2 · (Precision · Recall) / (Precision + Recall) · Split: ${experiment.split_name}`}
                aria-label="Precision / F1 formula"
                className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/[0.06] text-[#B8C0BC] hover:text-[#43D17A] cursor-help shrink-0 transition-colors"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="text-2xl sm:text-[26px] font-bold tabular-nums text-[#F1F5F9]">
              <AnimatedNumber
                value={m.precision * 100}
                formatter={(v) => `${formatDec(v, 1)}%`}
              />{" "}
              <span className="text-base font-medium text-[#CBD5E1]">
                /{" "}
                <AnimatedNumber
                  value={m.f1_score * 100}
                  formatter={(v) => `${v.toFixed(1)}%`}
                />
              </span>
            </div>
            <div className="text-[13px] text-[#B8C0BC]">
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

        {/* Clear Recall & FPR Meaning Strip (Smooth Accordion) */}
        <div className="v4-surface-inset px-4 py-3.5">
          <button
            type="button"
            onClick={() => setShowFormulaHelp((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9]"
          >
            <span className="inline-flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-[#43D17A]" />
              <span>
                {t.v34.recallFormula} &amp; {t.v34.fprFormula}
              </span>
            </span>
            {showFormulaHelp ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <div className={`v4-accordion-grid ${showFormulaHelp ? "is-open" : ""}`}>
            <div className="v4-accordion-inner">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 text-sm text-[#CBD5E1] leading-relaxed">
                <div className="dp-elevated p-3.5 space-y-1">
                  <div className="font-semibold text-[#F1F5F9]">{t.v34.recallFormula}</div>
                  <p>{t.v34.recallExplain}</p>
                </div>
                <div className="dp-elevated p-3.5 space-y-1">
                  <div className="font-semibold text-[#F1F5F9]">{t.v34.fprFormula}</div>
                  <p>{t.v34.fprExplain}</p>
                  <p className="text-[#E3AD56] text-[13px] pt-0.5">{t.v34.fprWhyBad}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 02. WEAKNESSES & SAMPLE TRANSACTIONS */}
      <section
        id="sec-weaknesses"
        className="v4-surface p-5 sm:p-7 space-y-4 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="inline-flex items-center font-mono font-bold text-[#E3AD56] bg-[#A8843D]/20 px-2.5 py-0.5 rounded-full">
                02
              </span>
              <span className="font-semibold uppercase tracking-wider text-[#B8C0BC]">
                {t.v4.navWeaknesses}
              </span>
            </div>
            <h3 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-[#F1F5F9]">
              {t.v34.weaknessesTitle} ({weaknesses.length})
            </h3>
          </div>
          {weaknesses.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllWeaknesses((v) => !v)}
              className="btn-subtle rounded-xl px-4 py-2 text-sm font-medium"
            >
              {showAllWeaknesses
                ? t.v34.hideExtraWeaknesses
                : `${t.v34.showAllWeaknesses} (${weaknesses.length})`}
            </button>
          )}
        </div>

        {intelligenceLoading && !intelligence ? (
          <div className="rounded-2xl bg-[#202522] p-5 flex items-center gap-3 text-sm text-[#CBD5E1]">
            <Loader2 className="h-4 w-4 animate-spin text-[#43D17A]" />
            <span>{t.result.loadingState}</span>
          </div>
        ) : visibleWeaknesses.length === 0 ? (
          <div className="rounded-2xl bg-[#202522] p-5 flex items-center gap-3 text-[15px] text-[#43D17A]">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span>{t.focus.noProblemsNote}</span>
          </div>
        ) : (
          <div className="space-y-3 v4-stagger">
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
                  className="rounded-2xl bg-[#202522] overflow-hidden border border-white/[0.05] hover:border-white/[0.15] transition-colors duration-200"
                >
                  <button
                    type="button"
                    onClick={() => toggleWeakness(w.id)}
                    className="w-full px-4 py-4 text-left flex items-start justify-between gap-3 hover:bg-[#262C28] transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <AlertTriangle
                        className={`h-4 w-4 shrink-0 mt-1 ${
                          w.severity === "critical"
                            ? "text-[#F16B6B]"
                            : w.severity === "high"
                              ? "text-[#E3AD56]"
                              : "text-[#43D17A]"
                        }`}
                      />
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="text-[15px] font-semibold text-[#F1F5F9]">
                            {w.title}
                          </span>
                          <span
                            className={`text-[13px] font-semibold px-2.5 py-0.5 rounded-full ${
                              severityBadge[w.severity]
                            }`}
                          >
                            {scenarioLabel(w.scenarioType)}
                          </span>
                          {measuredText && (
                            <span className="text-[13px] font-mono text-[#CBD5E1] tabular-nums">
                              {measuredText}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[#CBD5E1] leading-relaxed">
                          {w.explanation}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-[#B8C0BC] mt-1">
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </span>
                  </button>

                  <div className={`v4-accordion-grid ${isOpen ? "is-open" : ""}`}>
                    <div className="v4-accordion-inner">
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
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                              <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
                                <div className="text-[#B8C0BC] text-[13px] font-semibold">
                                  {t.v4h.weakWhatHappened}
                                </div>
                                <p className="text-[#F1F5F9] leading-relaxed">
                                  {story.whatHappened}
                                </p>
                                {scenRow && (
                                  <div className="text-[13px] font-mono text-[#CBD5E1] pt-0.5 tabular-nums">
                                    TP: {scenRow.detected_risks} · FN: {scenRow.missed_risks} · FP:{" "}
                                    {scenRow.false_positives}
                                  </div>
                                )}
                              </div>

                              <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[#B8C0BC] text-[13px] font-semibold">
                                    {t.v4h.weakWhyProblem}
                                  </span>
                                  <span
                                    className={`text-[13px] font-semibold px-2 py-0.5 rounded-full ${
                                      isBlackBox
                                        ? "bg-[#E3AD56]/15 text-[#E3AD56]"
                                        : "bg-[#43D17A]/15 text-[#43D17A]"
                                    }`}
                                  >
                                    {isBlackBox ? "Black-Box" : "White-Box"}
                                  </span>
                                </div>
                                <p className="text-[#F1F5F9] leading-relaxed">
                                  {story.whyProblem}
                                </p>
                                {!isBlackBox && realReasons.length > 0 && (
                                  <p className="text-[13px] text-[#CBD5E1] pt-0.5">
                                    {realReasons.join(" · ")}
                                    {scenRow
                                      ? ` · Avg score: ${scenRow.avg_risk_score.toFixed(1)}`
                                      : ""}
                                  </p>
                                )}
                              </div>

                              <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
                                <div className="text-[#43D17A] text-[13px] font-semibold">
                                  {t.v4h.weakWhatToCheck}
                                </div>
                                <p className="text-[#F1F5F9] leading-relaxed">
                                  {story.whatToCheck}
                                </p>
                              </div>
                            </div>
                          );
                        })()}

                        {samples.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-[13px] font-semibold text-[#B8C0BC]">
                              {t.v34.sampleOpsTitle}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              {samples.slice(0, 4).map((s) => {
                                const trace = s.decision_trace;
                                const isTraceOpen = expandedTraceCodes.includes(s.transaction_code);
                                const rulesList = trace?.rules || [];
                                const triggeredList = rulesList.filter((r) => r.triggered);
                                const belowList = rulesList.filter((r) => !r.triggered);
                                return (
                                  <div
                                    key={s.transaction_code}
                                    className="rounded-xl bg-[#202522] overflow-hidden border border-white/[0.05] hover:border-white/[0.15] transition-colors"
                                  >
                                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          trace && rulesList.length > 0
                                            ? toggleTrace(s.transaction_code)
                                            : onInspectTransaction(s.transaction_code)
                                        }
                                        className="min-w-0 flex-1 text-left space-y-0.5"
                                      >
                                        <div className="flex items-center gap-2 text-sm">
                                          <span className="font-mono font-semibold text-[#F1F5F9]">
                                            {s.transaction_code}
                                          </span>
                                          <span
                                            className={`text-[13px] font-semibold px-2 py-0.5 rounded ${
                                              s.outcome === "FN"
                                                ? "bg-[#E3AD56]/15 text-[#E3AD56]"
                                                : s.outcome === "FP"
                                                  ? "bg-[#F16B6B]/15 text-[#F16B6B]"
                                                  : "bg-[#43D17A]/15 text-[#43D17A]"
                                            }`}
                                          >
                                            {s.outcome}
                                          </span>
                                          {trace && rulesList.length > 0 && (
                                            <span className="text-[13px] px-2 py-0.5 rounded bg-[#1A1E1C] text-[#43D17A] font-medium">
                                              {t.v4h.traceTitle} {isTraceOpen ? "▲" : "▼"}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[13px] text-[#CBD5E1] tabular-nums truncate">
                                          {formatKzt(s.amount_kzt)} ·{" "}
                                          {hasRiskScores && s.risk_score !== null
                                            ? `Score ${s.risk_score.toFixed(1)}`
                                            : t.v33.inspectorScoreUnavailable}
                                        </div>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onInspectTransaction(s.transaction_code)}
                                        title={t.v34.openInInspector}
                                        className="p-2 rounded-lg hover:bg-[#272D29] text-[#B8C0BC] hover:text-[#F1F5F9] shrink-0"
                                      >
                                        <Eye className="h-4 w-4" />
                                      </button>
                                    </div>

                                    {trace && (
                                      <div className={`v4-accordion-grid ${isTraceOpen ? "is-open" : ""}`}>
                                        <div className="v4-accordion-inner">
                                          <div className="px-3.5 pb-3.5 pt-2.5 border-t border-white/[0.06] bg-[#161917] space-y-2 text-[13px]">
                                            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#CBD5E1] font-mono">
                                              <span>
                                                {t.v4h.traceScoreVsThreshold}:{" "}
                                                <strong className="text-[#F1F5F9]">
                                                  {trace.risk_score !== null ? trace.risk_score.toFixed(1) : "—"}
                                                </strong>
                                                {trace.decision_threshold !== null
                                                  ? ` / ${trace.decision_threshold}`
                                                  : ""}
                                              </span>
                                              <span className="uppercase px-2 py-0.5 rounded bg-[#202522] text-[#F1F5F9]">
                                                {t.v4h.traceDecisionLabel}: {trace.decision}
                                              </span>
                                            </div>

                                            {triggeredList.length > 0 && (
                                              <div className="space-y-1">
                                                <div className="text-[13px] font-semibold text-[#43D17A]">
                                                  {t.v4h.traceTriggered}
                                                </div>
                                                {triggeredList.map((r) => (
                                                  <div
                                                    key={r.rule_name}
                                                    className="flex items-center justify-between gap-2 rounded-lg bg-[#202522] px-2.5 py-1.5"
                                                  >
                                                    <span className="text-[#F1F5F9] truncate">
                                                      {ruleLabel(r.rule_name)}
                                                    </span>
                                                    <span className="font-mono text-[#43D17A] shrink-0 tabular-nums">
                                                      {r.actual_value !== null && r.threshold_value !== null
                                                        ? `${r.actual_value}/${r.threshold_value}${r.metric_unit ? ` ${r.metric_unit}` : ""} · `
                                                        : ""}
                                                      +{r.score_contribution !== null ? r.score_contribution.toFixed(1) : 0}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {belowList.length > 0 && (
                                              <div className="space-y-1">
                                                <div className="text-[13px] font-semibold text-[#B8C0BC]">
                                                  {t.v4h.traceBelowThreshold}
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                  {belowList.slice(0, 4).map((r) => (
                                                    <span
                                                      key={r.rule_name}
                                                      className="inline-flex items-center gap-1 rounded-md bg-[#1E2220] px-2 py-1 text-[13px] text-[#CBD5E1] font-mono"
                                                    >
                                                      <span className="font-sans text-[#B8C0BC]">
                                                        {ruleLabel(r.rule_name)}:
                                                      </span>
                                                      {r.actual_value ?? 0}/{r.threshold_value ?? "—"}
                                                      {r.metric_unit ? ` ${r.metric_unit}` : ""}
                                                    </span>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
