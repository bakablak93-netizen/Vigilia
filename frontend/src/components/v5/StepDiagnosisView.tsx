import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  ShieldCheck,
  ShieldPlus,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type {
  ExperimentSummary,
  SecurityIntelligenceReport,
  TransactionInspectorItem,
} from "../../types/api";
import { buildVigiliaConclusion, buildWeaknessPlainStory } from "../../utils/humanExplain";
import type { AnalyticsTab } from "../unified/AnalyticsDrawer";
import type { RankedWeaknessItem } from "../unified/WorkspaceResultsBlock";
import { AnimatedNumber, getRecallColorClass } from "../v4/AnimatedNumber";
import { StepProgressChecklist } from "./StepProgressChecklist";

interface StepDiagnosisViewProps {
  experiment: ExperimentSummary;
  intelligence: SecurityIntelligenceReport | null;
  weaknesses: RankedWeaknessItem[];
  analyzing: boolean;
  hasCandidateReady: boolean;
  onStartImprovement: () => void;
  onCancelImprovement: () => void;
  onGoToStep2: () => void;
  onInspectTransaction: (txCode: string) => void;
  onOpenAnalytics: (tab: AnalyticsTab) => void;
}

export const StepDiagnosisView: React.FC<StepDiagnosisViewProps> = ({
  experiment,
  intelligence,
  weaknesses,
  analyzing,
  hasCandidateReady,
  onStartImprovement,
  onCancelImprovement,
  onGoToStep2,
  onInspectTransaction,
  onOpenAnalytics,
}) => {
  const { t, lang, scenarioLabel, ruleLabel, formatKzt } = useLab();
  const [barWidth, setBarWidth] = useState(0);
  const [showAnalystDetails, setShowAnalystDetails] = useState(false);
  const [expandedWeaknessId, setExpandedWeaknessId] = useState<string | null>(null);

  const m = experiment.metrics_json;
  const recallPct =
    m.actual_risk_events > 0 ? (m.true_positives / m.actual_risk_events) * 100 : 0;
  const fprPct = m.false_positive_rate * 100;
  const missedAmount = m.missed_fraud_amount ?? 0;
  const preventedAmount = m.prevented_fraud_amount ?? 0;
  const falseDeclineAmount = m.false_decline_amount ?? 0;
  const reviewQueueCount = m.review_queue_count ?? 0;
  const reviewQueuePct = (m.review_queue_rate ?? 0) * 100;
  const isBlackBox = experiment.diagnostic_mode === "black_box";

  const conclusion = buildVigiliaConclusion(experiment, scenarioLabel, lang);

  useEffect(() => {
    setBarWidth(0);
    const id = window.requestAnimationFrame(() => {
      window.setTimeout(() => setBarWidth(Math.min(100, Math.max(0, recallPct))), 60);
    });
    return () => window.cancelAnimationFrame(id);
  }, [experiment.id, recallPct]);

  if (analyzing) {
    return (
      <StepProgressChecklist
        title={t.v4h.stageAnalyzeLabel}
        steps={[t.v5.checklistAnalyze1, t.v5.checklistAnalyze2, t.v5.checklistAnalyze3]}
        cancelLabel={t.v4h.btnCancelImprovement}
        onCancel={onCancelImprovement}
      />
    );
  }

  const top3Weaknesses = weaknesses.slice(0, 3);

  const badgeTone =
    conclusion.tone === "good"
      ? "bg-[#22C55E]/15 text-[#22C55E]"
      : conclusion.tone === "danger"
        ? "bg-[#EF4444]/15 text-[#EF4444]"
        : "bg-[#F59E0B]/15 text-[#F59E0B]";

  return (
    <div className="space-y-6 v5-step-enter">
      {/* Hero Block — Borderless Dark Money First + Animated Recall Bar */}
      <section className="v4-surface p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${badgeTone}`}>
              {conclusion.headlineBadge}
            </span>
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-[#161E1B] text-[#94A3B8]">
              {isBlackBox ? t.v4h.blackBoxScopeBadge : t.v4h.whiteBoxScopeBadge}
            </span>
          </div>
          <span className="text-sm text-[#94A3B8] tabular-nums">
            {experiment.engine_name || t.ext.internalLabel} · {m.total_transactions}{" "}
            {t.v34.sec1OpsUnit}
          </span>
        </div>

        {/* Center Hero Figures */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-2">
            <div className="text-sm font-medium text-[#94A3B8] uppercase tracking-wider">
              {t.v4h.bizMissedAmount}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={`text-4xl sm:text-[46px] font-bold tracking-tight tabular-nums leading-none whitespace-nowrap ${
                  missedAmount > 0 || m.false_negatives > 0
                    ? "text-rose-400"
                    : "text-[#22C55E]"
                }`}
              >
                <AnimatedNumber value={missedAmount} formatter={formatKzt} />
              </span>
              <span className="text-xl sm:text-2xl font-semibold text-[#94A3B8]">
                {t.v5.missedHeroSuffix}
              </span>
            </div>
            <p className="text-[15px] text-[#CBD5E1] leading-relaxed pt-1">
              {conclusion.whatFound}
            </p>
          </div>

          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
            <div className="rounded-2xl bg-[#16A34A]/12 px-5 py-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#94A3B8]">
                  {t.v4h.bizPreventedAmount}
                </div>
                <div className="text-2xl font-bold text-[#22C55E] tabular-nums mt-0.5">
                  <AnimatedNumber value={preventedAmount} formatter={formatKzt} />{" "}
                  <span className="text-sm font-semibold text-[#22C55E]/80">
                    {t.v5.savedHeroSuffix}
                  </span>
                </div>
              </div>
              <span className="font-mono text-sm font-bold px-2.5 py-1 rounded-lg bg-[#0B100E]/70 text-[#22C55E] shrink-0">
                TP: {m.true_positives}
              </span>
            </div>

            <div className="v4-surface-inset px-5 py-3.5 flex items-center justify-between gap-4 text-sm">
              <div>
                <div className="text-[#94A3B8]">{t.v4h.bizFalseDeclineAmount}</div>
                <div className="font-bold text-[#F1F5F9] tabular-nums text-base">
                  <AnimatedNumber value={falseDeclineAmount} formatter={formatKzt} />
                </div>
              </div>
              <div className="text-right">
                <div className="text-[#94A3B8]">{t.v4h.bizReviewQueue}</div>
                <div className="font-bold text-[#F1F5F9] tabular-nums text-base">
                  {reviewQueueCount} ({reviewQueuePct.toFixed(1)}%)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Clean Wide Animated Progress Bar: Caught vs Missed */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-[#CBD5E1]">
              {t.v5.caughtVsMissedLabel}
            </span>
            <span className="font-mono font-semibold tabular-nums">
              <span className={getRecallColorClass(recallPct)}>
                <AnimatedNumber value={recallPct} decimals={1} suffix="%" />
              </span>
              <span className="text-[#64748B] mx-1.5">·</span>
              <span className="text-[#94A3B8]">
                {m.true_positives} / {m.actual_risk_events}
              </span>
              {m.false_negatives > 0 && (
                <span className="text-[#EF4444] ml-2">
                  (FN: {m.false_negatives})
                </span>
              )}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-[#EF4444]/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#22C55E] transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>

        {/* Primary CTA Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {hasCandidateReady ? (
            <button
              type="button"
              onClick={onGoToStep2}
              className="btn-primary inline-flex items-center gap-2.5"
            >
              <ShieldCheck className="h-5 w-5" />
              <span>{t.v4h.btnGoToImprovement}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartImprovement}
              className="btn-primary inline-flex items-center gap-2.5"
            >
              <ShieldPlus className="h-5 w-5" />
              <span>
                {isBlackBox ? t.v4h.btnPrepareBlackBoxRecs : t.v4h.btnImproveDefense}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAnalystDetails((v) => !v)}
            className="btn-subtle inline-flex items-center gap-2"
          >
            <span>
              {showAnalystDetails
                ? t.v5.hideAnalystDetailsBtn
                : t.v5.analystDetailsBtn}
            </span>
            {showAnalystDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </section>

      {/* Top 3 Weaknesses (Borderless Cards with Decision Trace) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 className="text-lg font-bold text-[#F1F5F9]">
            {t.v5.topWeaknessesTitle}
          </h2>
          {weaknesses.length > 3 && (
            <button
              type="button"
              onClick={() => onOpenAnalytics("errors")}
              className="text-sm font-semibold text-[#22C55E] hover:text-[#4ADE80]"
            >
              {t.v34.showAllWeaknesses} ({weaknesses.length}) →
            </button>
          )}
        </div>

        {top3Weaknesses.length === 0 ? (
          <div className="v4-surface p-6 flex items-center gap-3 text-[#22C55E] font-medium">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span>{t.focus.noProblemsNote}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 v4-stagger">
            {top3Weaknesses.map((w) => {
              const isOpen = expandedWeaknessId === w.id;
              const scenRow = intelligence?.weakness_explorer.find(
                (r) => r.scenario_type === w.scenarioType
              );
              const sampleTx: TransactionInspectorItem | undefined =
                (intelligence?.transaction_inspector_samples || []).find((s) =>
                  w.id.startsWith("fp-")
                    ? s.scenario_type === w.scenarioType && s.outcome === "FP"
                    : s.scenario_type === w.scenarioType && s.outcome === "FN"
                ) ||
                (intelligence?.transaction_inspector_samples || []).find(
                  (s) => s.scenario_type === w.scenarioType
                );
              const story = buildWeaknessPlainStory(
                scenarioLabel(w.scenarioType),
                scenRow?.missed_risks ?? w.missedCount,
                scenRow?.actual_risk_events ?? w.missedCount,
                scenRow?.false_positives ?? 0,
                w.id.startsWith("fp-"),
                isBlackBox,
                lang
              );

              const sevBadge =
                w.severity === "critical"
                  ? "bg-[#EF4444]/15 text-[#EF4444]"
                  : w.severity === "high"
                    ? "bg-[#F59E0B]/15 text-[#F59E0B]"
                    : "bg-[#22C55E]/15 text-[#22C55E]";

              return (
                <div
                  key={w.id}
                  className="dp-elevated p-5 flex flex-col justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedWeaknessId(isOpen ? null : w.id)}
                    className="text-left space-y-2.5 w-full"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${sevBadge}`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {scenarioLabel(w.scenarioType)}
                      </span>
                      <span className="text-[#94A3B8]">
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </div>

                    <div className="text-base font-bold text-[#F1F5F9] leading-snug">
                      {w.title}
                    </div>
                    <p className="text-sm text-[#94A3B8] leading-relaxed">
                      {w.explanation}
                    </p>
                  </button>

                  <div className={`v4-accordion-grid ${isOpen ? "is-open" : ""}`}>
                    <div className="v4-accordion-inner">
                      <div className="pt-3 mt-1 space-y-2.5 text-sm">
                        <p className="text-[#CBD5E1] leading-relaxed">
                          <strong className="text-[#F1F5F9]">
                            {t.v4h.weakWhatToCheck}:{" "}
                          </strong>
                          {story.whatToCheck}
                        </p>

                        {sampleTx && (
                          <div className="v4-surface-inset p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-[#F1F5F9] text-xs">
                                {sampleTx.transaction_code} ·{" "}
                                {formatKzt(sampleTx.amount_kzt)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onInspectTransaction(sampleTx.transaction_code)
                                }
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#22C55E] hover:text-[#4ADE80]"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>{t.v34.openInInspector}</span>
                              </button>
                            </div>
                            {sampleTx.decision_trace && (
                              <div className="text-xs text-[#94A3B8] space-y-1">
                                <div>
                                  {t.v4h.traceScoreVsThreshold}:{" "}
                                  <strong className="text-[#F1F5F9]">
                                    {sampleTx.decision_trace.risk_score?.toFixed(1) ?? "—"}
                                  </strong>{" "}
                                  / {sampleTx.decision_trace.decision_threshold ?? "—"}
                                </div>
                                {sampleTx.decision_trace.rules
                                  .filter((r) => r.triggered)
                                  .slice(0, 2)
                                  .map((r) => (
                                    <div
                                      key={r.rule_name}
                                      className="flex justify-between text-[#CBD5E1]"
                                    >
                                      <span>{ruleLabel(r.rule_name)}</span>
                                      <span className="font-mono text-[#22C55E]">
                                        +{r.score_contribution?.toFixed(1) ?? 0}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            )}
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

      {/* Collapsible Technical ML Metrics for Analysts */}
      <div className={`v4-accordion-grid ${showAnalystDetails ? "is-open" : ""}`}>
        <div className="v4-accordion-inner">
          <section className="v4-surface p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#F1F5F9]">
                {t.v5.analystDetailsBtn}
              </h3>
              <button
                type="button"
                onClick={() => onOpenAnalytics("overview")}
                className="btn-subtle px-3.5 py-2 text-sm inline-flex items-center gap-2"
              >
                <BarChart3 className="h-4 w-4 text-[#22C55E]" />
                <span>{t.v34.sec2OpenDrawer}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="v4-surface-inset p-4">
                <div className="text-sm text-[#94A3B8]">Recall (TP)</div>
                <div className={`text-2xl font-bold tabular-nums ${getRecallColorClass(recallPct)}`}>
                  {recallPct.toFixed(1)}%
                </div>
              </div>
              <div className="v4-surface-inset p-4">
                <div className="text-sm text-[#94A3B8]">FPR (False Declines)</div>
                <div className="text-2xl font-bold tabular-nums text-[#F1F5F9]">
                  {fprPct.toFixed(2)}%
                </div>
              </div>
              <div className="v4-surface-inset p-4">
                <div className="text-sm text-[#94A3B8]">Precision / F1</div>
                <div className="text-2xl font-bold tabular-nums text-[#F1F5F9]">
                  {(m.precision * 100).toFixed(1)}% / {(m.f1_score * 100).toFixed(1)}%
                </div>
              </div>
              <div className="v4-surface-inset p-4">
                <div className="text-sm text-[#94A3B8]">Confusion Matrix</div>
                <div className="text-sm font-mono font-semibold text-[#CBD5E1] mt-1 tabular-nums">
                  TP:{m.true_positives} · FN:{m.false_negatives} · FP:{m.false_positives} · TN:{m.true_negatives}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
