import React, { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type {
  EvolutionRun,
  ExperimentTxDiffItem,
  ExperimentTxDiffResponse,
  ExternalEvolutionRun,
} from "../../types/api";
import { DefenseComparisonChart } from "../charts/SecurityCharts";
import { buildComparisonPlainStory } from "../../utils/humanExplain";
import { AnimatedNumber, getRecallColorClass } from "../v4/AnimatedNumber";
import type { AnalyticsTab } from "./AnalyticsDrawer";

interface WorkspaceComparisonBlockProps {
  evolutionRun: EvolutionRun | null;
  externalEvolution: ExternalEvolutionRun | null;
  diffData: ExperimentTxDiffResponse | null;
  diffLoading: boolean;
  onInspectTransaction: (txCode: string, experimentId?: number) => void;
  onOpenAnalytics: (tab: AnalyticsTab) => void;
}

export const WorkspaceComparisonBlock: React.FC<
  WorkspaceComparisonBlockProps
> = ({
  evolutionRun,
  externalEvolution,
  diffData,
  diffLoading,
  onInspectTransaction,
  onOpenAnalytics,
}) => {
  const { t, lang, scenarioLabel, ruleLabel, formatKzt } = useLab();
  const [showAllFixed, setShowAllFixed] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);

  const activeComparison =
    externalEvolution?.comparison_json?.evaluation_split ||
    evolutionRun?.comparison_json?.evaluation_split;

  if (!activeComparison) return null;

  const verdict =
    externalEvolution?.verdict ||
    evolutionRun?.verdict ||
    "no_significant_improvement";
  const baselineVersion =
    externalEvolution?.comparison_json?.baseline_version ||
    externalEvolution?.baseline_label ||
    evolutionRun?.comparison_json?.baseline_version ||
    "Baseline";
  const candidateVersion =
    externalEvolution?.comparison_json?.candidate_version ||
    externalEvolution?.candidate_label ||
    evolutionRun?.comparison_json?.candidate_version ||
    "Candidate";

  const scenarioComparison =
    externalEvolution?.comparison_json?.scenario_comparison ||
    evolutionRun?.comparison_json?.scenario_comparison ||
    [];
  const scenarioAudit =
    externalEvolution?.comparison_json?.scenario_audit ||
    evolutionRun?.comparison_json?.scenario_audit ||
    null;

  const evalRemaining =
    externalEvolution?.comparison_json?.evaluation_remaining_weaknesses ||
    evolutionRun?.comparison_json?.evaluation_remaining_weaknesses ||
    [];

  const guardrailReport =
    externalEvolution?.comparison_json?.guardrail_report ||
    evolutionRun?.comparison_json?.guardrail_report ||
    null;

  const adversarialShift =
    externalEvolution?.comparison_json?.adversarial_shift ||
    evolutionRun?.comparison_json?.adversarial_shift ||
    null;

  const blackBoxPolicy =
    externalEvolution?.comparison_json?.black_box_policy || null;

  const tradeoffText =
    externalEvolution?.tradeoff_assessment ||
    evolutionRun?.tradeoff_assessment ||
    "";

  const base = activeComparison.baseline;
  const cand = activeComparison.candidate;
  const cmpDelta = activeComparison.delta || {};
  const recallDiffPp = (cand.recall - base.recall) * 100;
  const precDiffPp = (cand.precision - base.precision) * 100;
  const fprDiffPp = (cand.false_positive_rate - base.false_positive_rate) * 100;
  const tpDelta = cand.true_positives - base.true_positives;
  const fnDelta = base.false_negatives - cand.false_negatives;
  const fpDelta = cand.false_positives - base.false_positives;
  const preventedDelta =
    cmpDelta.delta_prevented_fraud_amount ??
    (cand.prevented_fraud_amount ?? 0) - (base.prevented_fraud_amount ?? 0);
  const missedMoneyDelta =
    cmpDelta.delta_missed_fraud_amount ??
    (cand.missed_fraud_amount ?? 0) - (base.missed_fraud_amount ?? 0);
  const falseDeclineDelta =
    cmpDelta.delta_false_decline_amount ??
    (cand.false_decline_amount ?? 0) - (base.false_decline_amount ?? 0);
  const reviewCountDelta =
    cmpDelta.delta_review_queue_count ??
    (cand.review_queue_count ?? 0) - (base.review_queue_count ?? 0);
  const hasMoneyMetrics =
    typeof base.prevented_fraud_amount === "number" ||
    typeof cand.prevented_fraud_amount === "number";

  const evalCandExpId =
    externalEvolution?.comparison_json?.final_candidate_experiment_id ||
    externalEvolution?.candidate_experiment_id ||
    evolutionRun?.final_candidate_experiment_id ||
    undefined;

  const formatPp = (val: number, decimals = 1) => {
    const fixed = val.toFixed(decimals);
    return lang === "en" ? fixed : fixed.replace(".", ",");
  };

  const verdictBadgeTone =
    verdict === "improved"
      ? "bg-[#43D17A]/15 text-[#43D17A]"
      : verdict === "rejected_regression"
        ? "bg-[#F16B6B]/15 text-[#F16B6B]"
        : "bg-[#E3AD56]/15 text-[#E3AD56]";

  const fixedMisses: ExperimentTxDiffItem[] = diffData?.fixed_misses || [];
  const newErrors: Array<ExperimentTxDiffItem & { errType: "FP" | "FN" }> = [
    ...(diffData?.new_false_positives || []).map((x) => ({
      ...x,
      errType: "FP" as const,
    })),
    ...(diffData?.new_misses || []).map((x) => ({
      ...x,
      errType: "FN" as const,
    })),
  ];

  const visibleFixed = showAllFixed ? fixedMisses : fixedMisses.slice(0, 6);
  const visibleErrors = showAllErrors ? newErrors : newErrors.slice(0, 6);

  // Derive balanced positive & negative statements from actual evaluation metrics
  const improvements: string[] = [];
  if (recallDiffPp > 0.05) {
    improvements.push(
      `Recall: ${formatPp(base.recall * 100)}% → ${formatPp(cand.recall * 100)}% (+${formatPp(recallDiffPp)} ${t.focus.ppUnit})`
    );
  }
  if (tpDelta > 0) {
    improvements.push(`${t.v34.extraDetected}: +${tpDelta}`);
  }
  if (fpDelta < 0) {
    improvements.push(
      `FP: ${base.false_positives} → ${cand.false_positives} (${fpDelta})`
    );
  }
  if (precDiffPp > 0.05) {
    improvements.push(
      `Precision: ${formatPp(base.precision * 100)}% → ${formatPp(cand.precision * 100)}% (+${formatPp(precDiffPp)} ${t.focus.ppUnit})`
    );
  }

  const regressions: string[] = [];
  if (fpDelta > 0) {
    regressions.push(
      `${t.v34.newFalseBlocks}: +${fpDelta} (FP: ${base.false_positives} → ${cand.false_positives})`
    );
  }
  if (fprDiffPp > 0.005) {
    regressions.push(
      `FPR: ${formatPp(base.false_positive_rate * 100, 2)}% → ${formatPp(cand.false_positive_rate * 100, 2)}% (+${formatPp(fprDiffPp, 2)} ${t.focus.ppUnit})`
    );
  }
  if (precDiffPp < -0.05) {
    regressions.push(
      `Precision: ${formatPp(base.precision * 100)}% → ${formatPp(cand.precision * 100)}% (${formatPp(precDiffPp)} ${t.focus.ppUnit})`
    );
  }
  if (recallDiffPp < -0.05) {
    regressions.push(
      `Recall: ${formatPp(base.recall * 100)}% → ${formatPp(cand.recall * 100)}% (${formatPp(recallDiffPp)} ${t.focus.ppUnit})`
    );
  }

  // Remaining scenario misses/FPs from evaluation
  const remainingLines =
    evalRemaining.length > 0
      ? evalRemaining
      : scenarioComparison
          .filter(
            (s) =>
              (s.candidate_fn !== null &&
                s.candidate_fn !== undefined &&
                s.candidate_fn > 0) ||
              (s.candidate_fp !== null &&
                s.candidate_fp !== undefined &&
                s.candidate_fp > 0)
          )
          .map((s) => ({
            scenario_type: s.scenario_type,
            actual_risk_events: s.actual_risk_events ?? 0,
            false_negatives: s.candidate_fn ?? 0,
            false_positives: s.candidate_fp ?? 0,
          }));

  const precisionWorse = precDiffPp < -0.05;
  const fprWorse = fprDiffPp > 0.005;
  const recallWorse = recallDiffPp < -0.05;
  const newFpCount =
    diffData?.summary.new_false_positives_count ?? Math.max(0, fpDelta);

  return (
    <section
      id="sec-comparison"
      className="v4-surface p-5 sm:p-7 space-y-5 focus-enter scroll-mt-20"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#B8C0BC]">
            <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#43D17A] bg-[#008F36]/20 px-2.5 py-0.5 rounded-full">
              {t.v34.sec4Tag}
            </span>
            <span className="font-semibold uppercase tracking-wider text-[#B8C0BC]">
              {t.v34.sec4Title}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full font-semibold ${verdictBadgeTone}`}
            >
              {t.verdicts[verdict as keyof typeof t.verdicts] || verdict}
            </span>
          </div>
          <h2 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-[#F1F5F9]">
            {baselineVersion} → {candidateVersion}
          </h2>
          <p className="text-sm text-[#CBD5E1]">{t.v34.evalScopeNote}</p>
        </div>

        <button
          type="button"
          onClick={() => onOpenAnalytics("evolution")}
          className="btn-subtle rounded-xl px-4 py-2.5 text-sm font-medium inline-flex items-center gap-2"
        >
          <BarChart3 className="h-4 w-4 text-[#43D17A]" />
          <span>{t.v34.sec2OpenDrawer}</span>
        </button>
      </div>

      {/* Plain-language Stage D Summary + Should-Adopt Verdict */}
      {(() => {
        const story = buildComparisonPlainStory(
          base,
          cand,
          verdict,
          scenarioComparison,
          scenarioLabel,
          lang
        );
        const adoptTone =
          story.tone === "good"
            ? "text-[#43D17A]"
            : story.tone === "danger"
              ? "text-[#F16B6B]"
              : "text-[#E3AD56]";
        return (
          <div className="dp-elevated p-4 sm:p-5 space-y-2.5 text-[15px] leading-relaxed">
            <p className="text-[15px] font-semibold text-[#F1F5F9] leading-snug">
              {story.headline}
            </p>
            <div className="v4-surface-inset px-3.5 py-2.5 space-y-1">
              <div className="text-[13px] font-semibold text-[#B8C0BC]">
                {t.v4h.shouldAdoptLabel}
              </div>
              <p className={`text-sm font-medium ${adoptTone}`}>{story.shouldAdopt}</p>
            </div>
          </div>
        );
      })()}

      {/* Headline Deltas (elevated KPI wells, concise + stagger) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 v4-stagger">
        <div className="dp-elevated p-4 space-y-1.5" title={t.v34.hintRecallShort}>
          <div className="text-[13px] text-[#CBD5E1]">Recall</div>
          <div className="text-lg font-bold tabular-nums text-[#F1F5F9]">
            <span className={getRecallColorClass(base.recall * 100)}>
              <AnimatedNumber
                value={base.recall * 100}
                formatter={(v) => `${formatPp(v)}%`}
              />
            </span>{" "}
            →{" "}
            <span className={getRecallColorClass(cand.recall * 100)}>
              <AnimatedNumber
                value={cand.recall * 100}
                formatter={(v) => `${formatPp(v)}%`}
              />
            </span>
          </div>
          <div
            className={`text-[13px] font-mono tabular-nums ${
              recallDiffPp > 0.05
                ? "text-[#43D17A]"
                : recallWorse
                  ? "text-rose-400"
                  : "text-[#B8C0BC]"
            }`}
          >
            {recallDiffPp >= 0 ? "+" : ""}
            <AnimatedNumber
              value={recallDiffPp}
              formatter={(v) => `${formatPp(v)} ${t.focus.ppUnit}`}
            />
          </div>
        </div>

        <div className="dp-elevated p-4 space-y-1.5" title={t.v34.hintFprShort}>
          <div className="text-[13px] text-[#CBD5E1]">FPR</div>
          <div className="text-lg font-bold tabular-nums text-[#F1F5F9]">
            <AnimatedNumber
              value={base.false_positive_rate * 100}
              formatter={(v) => `${formatPp(v, 2)}%`}
            />{" "}
            →{" "}
            <span
              className={
                fprWorse
                  ? "text-rose-400"
                  : fprDiffPp < -0.005
                    ? "text-[#43D17A]"
                    : "text-[#F1F5F9]"
              }
            >
              <AnimatedNumber
                value={cand.false_positive_rate * 100}
                formatter={(v) => `${formatPp(v, 2)}%`}
              />
            </span>
          </div>
          <div
            className={`text-[13px] font-mono tabular-nums ${
              fprWorse
                ? "text-rose-400"
                : fpDelta < 0
                  ? "text-[#43D17A]"
                  : "text-[#B8C0BC]"
            }`}
          >
            FP: {base.false_positives} → {cand.false_positives} (
            {fpDelta >= 0 ? `+${fpDelta}` : fpDelta})
          </div>
        </div>

        <div className="dp-elevated p-4 space-y-1.5">
          <div className="text-[13px] text-[#CBD5E1]">Precision</div>
          <div className="text-lg font-bold tabular-nums text-[#F1F5F9]">
            <AnimatedNumber
              value={base.precision * 100}
              formatter={(v) => `${formatPp(v)}%`}
            />{" "}
            →{" "}
            <span
              className={
                precisionWorse
                  ? "text-rose-400"
                  : precDiffPp > 0.05
                    ? "text-[#43D17A]"
                    : "text-[#F1F5F9]"
              }
            >
              <AnimatedNumber
                value={cand.precision * 100}
                formatter={(v) => `${formatPp(v)}%`}
              />
            </span>
          </div>
          <div
            className={`text-[13px] font-mono tabular-nums ${
              precisionWorse
                ? "text-rose-400"
                : precDiffPp > 0.05
                  ? "text-[#43D17A]"
                  : "text-[#B8C0BC]"
            }`}
          >
            {precDiffPp >= 0 ? "+" : ""}
            <AnimatedNumber
              value={precDiffPp}
              formatter={(v) => `${formatPp(v)} ${t.focus.ppUnit}`}
            />
          </div>
        </div>

        <div className="dp-elevated p-4 space-y-1.5" title={t.v34.hintFnShort}>
          <div className="text-[13px] text-[#CBD5E1]">{t.v34.extraDetected}</div>
          <div
            className={`text-lg font-bold tabular-nums ${
              tpDelta > 0
                ? "text-[#43D17A]"
                : tpDelta < 0
                  ? "text-rose-400"
                  : "text-[#F1F5F9]"
            }`}
          >
            {tpDelta >= 0 ? `+${tpDelta}` : tpDelta}
          </div>
          <div className="text-[13px] text-[#B8C0BC] font-mono tabular-nums">
            FN: {base.false_negatives} → {cand.false_negatives} · +{newFpCount} FP (
            {diffData ? diffData.summary.fixed_misses_count : Math.max(0, fnDelta)})
          </div>
        </div>
      </div>

      {/* Financial Effect & Review Queue Load (Before vs After) */}
      {hasMoneyMetrics && (
        <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-2.5 border border-white/[0.06]">
          <div className="text-[15px] font-semibold text-[#F1F5F9]">
            {t.v4h.bizTitle}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm v4-stagger">
            <div className="rounded-xl bg-[#202522] p-3.5 space-y-1">
              <div className="text-[13px] text-[#B8C0BC]">{t.v4h.bizPreventedAmount}</div>
              <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                <AnimatedNumber value={base.prevented_fraud_amount ?? 0} formatter={formatKzt} /> →{" "}
                <span className={preventedDelta > 0 ? "text-[#43D17A]" : preventedDelta < 0 ? "text-rose-400" : ""}>
                  <AnimatedNumber value={cand.prevented_fraud_amount ?? 0} formatter={formatKzt} />
                </span>
              </div>
              <div className={`text-[13px] font-mono tabular-nums ${preventedDelta > 0 ? "text-[#43D17A]" : preventedDelta < 0 ? "text-rose-400" : "text-[#B8C0BC]"}`}>
                {preventedDelta >= 0 ? "+" : "-"}
                <AnimatedNumber value={Math.abs(preventedDelta)} formatter={formatKzt} />
              </div>
            </div>

            <div className="rounded-xl bg-[#202522] p-3.5 space-y-1">
              <div className="text-[13px] text-[#B8C0BC]">{t.v4h.bizMissedAmount}</div>
              <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                <AnimatedNumber value={base.missed_fraud_amount ?? 0} formatter={formatKzt} /> →{" "}
                <span className={missedMoneyDelta < 0 ? "text-[#43D17A]" : missedMoneyDelta > 0 ? "text-rose-400" : ""}>
                  <AnimatedNumber value={cand.missed_fraud_amount ?? 0} formatter={formatKzt} />
                </span>
              </div>
              <div className={`text-[13px] font-mono tabular-nums ${missedMoneyDelta < 0 ? "text-[#43D17A]" : missedMoneyDelta > 0 ? "text-rose-400" : "text-[#B8C0BC]"}`}>
                {missedMoneyDelta >= 0 ? "+" : "-"}
                <AnimatedNumber value={Math.abs(missedMoneyDelta)} formatter={formatKzt} />
              </div>
            </div>

            <div className="rounded-xl bg-[#202522] p-3.5 space-y-1">
              <div className="text-[13px] text-[#B8C0BC]">{t.v4h.bizFalseDeclineAmount}</div>
              <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                <AnimatedNumber value={base.false_decline_amount ?? 0} formatter={formatKzt} /> →{" "}
                <span className={falseDeclineDelta > 0 ? "text-rose-400" : falseDeclineDelta < 0 ? "text-[#43D17A]" : ""}>
                  <AnimatedNumber value={cand.false_decline_amount ?? 0} formatter={formatKzt} />
                </span>
              </div>
              <div className={`text-[13px] font-mono tabular-nums ${falseDeclineDelta > 0 ? "text-rose-400" : falseDeclineDelta < 0 ? "text-[#43D17A]" : "text-[#B8C0BC]"}`}>
                {falseDeclineDelta >= 0 ? "+" : "-"}
                <AnimatedNumber value={Math.abs(falseDeclineDelta)} formatter={formatKzt} />
              </div>
            </div>

            <div className="rounded-xl bg-[#202522] p-3.5 space-y-1">
              <div className="text-[13px] text-[#B8C0BC]">{t.v4h.bizReviewQueue}</div>
              <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                <AnimatedNumber value={base.review_queue_count ?? 0} decimals={0} /> →{" "}
                <AnimatedNumber value={cand.review_queue_count ?? 0} decimals={0} />
              </div>
              <div className="text-[13px] font-mono text-[#B8C0BC] tabular-nums">
                {reviewCountDelta >= 0 ? `+${reviewCountDelta}` : reviewCountDelta} ·{" "}
                {((cand.review_queue_rate ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Balanced Evaluation Summary (Successes + Regressions + Remaining Weaknesses + Guardrails Verdict) */}
      <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3">
        <div className="text-[15px] font-semibold text-[#F1F5F9]">
          {t.v34.evalVerdictSummaryTitle}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
            <div className="font-semibold text-[#43D17A]">
              {t.v34.evalImprovedLabel}
            </div>
            {improvements.length > 0 ? (
              <ul className="space-y-1 text-sm text-[#F1F5F9]">
                {improvements.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#B8C0BC]">—</p>
            )}
          </div>

          <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
            <div
              className={`font-semibold ${
                regressions.length > 0 ? "text-[#F16B6B]" : "text-[#43D17A]"
              }`}
            >
              {t.v34.evalWorseLabel}
            </div>
            {regressions.length > 0 ? (
              <ul className="space-y-1 text-sm text-[#F16B6B]">
                {regressions.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#43D17A]">
                {t.v34.evalNoRegressions}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
            <div className="font-semibold text-[#E3AD56]">
              {t.v34.evalRemainingLabel}
            </div>
            {remainingLines.length > 0 ? (
              <ul className="space-y-1 text-sm text-[#CBD5E1]">
                {remainingLines.map((rw) => (
                  <li key={rw.scenario_type}>
                    • {scenarioLabel(rw.scenario_type)}:{" "}
                    {rw.false_negatives > 0
                      ? `FN ${rw.false_negatives}/${rw.actual_risk_events}`
                      : ""}
                    {rw.false_positives > 0
                      ? `${rw.false_negatives > 0 ? ", " : ""}FP ${rw.false_positives}`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#43D17A]">
                {t.v34.evalNoRemaining}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-[#202522] p-3.5 space-y-1.5">
            <div className="font-semibold text-[#CBD5E1]">
              {t.v34.evalVerdictReasonLabel}
            </div>
            <p className="text-sm text-[#F1F5F9] leading-relaxed">
              {tradeoffText ||
                (t.verdicts[verdict as keyof typeof t.verdicts] || verdict)}
            </p>
            {guardrailReport?.checks && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.entries(guardrailReport.checks).map(([k, ok]) => (
                  <span
                    key={k}
                    className={`px-2 py-0.5 rounded-full text-[13px] font-mono ${
                      ok
                        ? "bg-[#43D17A]/15 text-[#43D17A]"
                        : "bg-[#F16B6B]/15 text-[#F16B6B]"
                    }`}
                  >
                    {k}: {ok ? "OK" : "FAIL"}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Adversarial Shift Stress Check (±10–15% amount & timing perturbation) */}
      {adversarialShift && (
        <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3 border border-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[15px] font-semibold text-[#F1F5F9]">
                {t.v4h.advShiftTitle}
              </div>
              <p className="text-[13px] text-[#B8C0BC]">
                {t.v4h.advShiftDesc}
              </p>
            </div>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[13px] font-semibold ${
                adversarialShift.status !== "evaluated"
                  ? "bg-[#202522] text-[#CBD5E1]"
                  : adversarialShift.passed
                    ? "bg-[#43D17A]/15 text-[#43D17A]"
                    : "bg-[#F16B6B]/15 text-[#F16B6B]"
              }`}
            >
              {adversarialShift.status !== "evaluated"
                ? t.v4h.advShiftUnavailable
                : adversarialShift.passed
                  ? t.v4h.advShiftPassed
                  : t.v4h.advShiftFailed}
            </span>
          </div>

          {adversarialShift.status === "evaluated" &&
            adversarialShift.candidate_clean_metrics &&
            adversarialShift.candidate_shifted_metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-sm">
                <div className="rounded-xl bg-[#202522] p-3">
                  <div className="text-[13px] text-[#B8C0BC]">{t.v4h.advShiftCleanRecall}</div>
                  <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                    {(adversarialShift.candidate_clean_metrics.recall * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-xl bg-[#202522] p-3">
                  <div className="text-[13px] text-[#B8C0BC]">{t.v4h.advShiftShiftedRecall}</div>
                  <div
                    className={`text-base font-mono font-bold tabular-nums ${
                      (adversarialShift.recall_delta_vs_clean || 0) < -0.08
                        ? "text-[#F16B6B]"
                        : "text-[#43D17A]"
                    }`}
                  >
                    {(adversarialShift.candidate_shifted_metrics.recall * 100).toFixed(1)}% (
                    {((adversarialShift.recall_delta_vs_clean || 0) * 100 >= 0 ? "+" : "") +
                      ((adversarialShift.recall_delta_vs_clean || 0) * 100).toFixed(1)}
                    %)
                  </div>
                </div>
                <div className="rounded-xl bg-[#202522] p-3">
                  <div className="text-[13px] text-[#B8C0BC]">{t.v4h.advShiftShiftedFpr}</div>
                  <div
                    className={`text-base font-mono font-bold tabular-nums ${
                      (adversarialShift.fpr_delta_vs_clean || 0) > 0.015
                        ? "text-[#F16B6B]"
                        : "text-[#F1F5F9]"
                    }`}
                  >
                    {(adversarialShift.candidate_shifted_metrics.false_positive_rate * 100).toFixed(2)}% (
                    {((adversarialShift.fpr_delta_vs_clean || 0) * 100 >= 0 ? "+" : "") +
                      ((adversarialShift.fpr_delta_vs_clean || 0) * 100).toFixed(2)}
                    %)
                  </div>
                </div>
                <div className="rounded-xl bg-[#202522] p-3">
                  <div className="text-[13px] text-[#B8C0BC]">{t.v4h.advShiftVsBaseline}</div>
                  <div className="text-base font-mono font-bold text-[#43D17A] tabular-nums">
                    {((adversarialShift.recall_gain_vs_baseline_shifted || 0) * 100 >= 0 ? "+" : "") +
                      ((adversarialShift.recall_gain_vs_baseline_shifted || 0) * 100).toFixed(1)}{" "}
                    {t.focus.ppUnit}
                  </div>
                </div>
              </div>
            )}

          {adversarialShift.reason && (
            <p className="text-[13px] text-[#CBD5E1]">{adversarialShift.reason}</p>
          )}
        </div>
      )}

      {/* Black-Box Allow / Review / Block Policy Breakdown when validated */}
      {blackBoxPolicy && blackBoxPolicy.routing_supported && blackBoxPolicy.routing_counts && (
        <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-2.5 border border-[#E3AD56]/20">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-[#F1F5F9]">{t.v4h.blackBoxScopeBadge}</span>
            <span className="font-mono text-[13px] text-[#E3AD56]">
              Block ≥ {String(blackBoxPolicy.recommended_block_threshold ?? "—")} · Review ≥{" "}
              {String(blackBoxPolicy.recommended_review_threshold ?? "—")}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5 text-sm">
            <div className="rounded-xl bg-[#202522] p-3">
              <div className="text-[13px] text-[#B8C0BC]">{t.v4h.blackBoxZonesAllow}</div>
              <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                {blackBoxPolicy.routing_counts.allow}
              </div>
            </div>
            <div className="rounded-xl bg-[#202522] p-3">
              <div className="text-[13px] text-[#E3AD56]">{t.v4h.blackBoxZonesReview}</div>
              <div className="text-base font-mono font-bold text-[#E3AD56] tabular-nums">
                {blackBoxPolicy.routing_counts.review}
              </div>
            </div>
            <div className="rounded-xl bg-[#202522] p-3">
              <div className="text-[13px] text-[#43D17A]">{t.v4h.blackBoxZonesBlock}</div>
              <div className="text-base font-mono font-bold text-[#43D17A] tabular-nums">
                {blackBoxPolicy.routing_counts.block}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Before / After Bar Chart */}
      <DefenseComparisonChart
        baseline={base}
        candidate={cand}
        baselineLabel={baselineVersion}
        candidateLabel={candidateVersion}
      />

      {/* Transaction-level Diff Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1) Fixed Misses */}
        <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[#43D17A]">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>
                {t.v34.fixedMissesTitle} (
                {diffData ? diffData.summary.fixed_misses_count : "—"})
              </span>
            </div>
            {fixedMisses.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllFixed((v) => !v)}
                className="text-[13px] text-[#CBD5E1] hover:text-[#F1F5F9]"
              >
                {showAllFixed ? t.v34.hideExtraWeaknesses : `${fixedMisses.length}`}
              </button>
            )}
          </div>

          {diffLoading && !diffData ? (
            <div className="flex items-center gap-2 text-sm text-[#CBD5E1] py-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#43D17A]" />
              <span>{t.result.loadingState}</span>
            </div>
          ) : visibleFixed.length === 0 ? (
            <div className="rounded-xl bg-[#202522] px-3.5 py-3 text-sm text-[#CBD5E1]">
              {t.v34.fixedMissesEmpty}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleFixed.map((item) => (
                <button
                  key={item.transaction_code}
                  type="button"
                  onClick={() =>
                    onInspectTransaction(item.transaction_code, evalCandExpId)
                  }
                  className="w-full rounded-xl bg-[#202522] hover:bg-[#262C28] p-3.5 text-left text-sm transition-colors flex items-start justify-between gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-[#F1F5F9]">
                        {item.transaction_code}
                      </span>
                      <span className="text-[13px] px-2 py-0.5 rounded-full bg-[#43D17A]/15 text-[#43D17A]">
                        {scenarioLabel(item.scenario_type)}
                      </span>
                      <span className="text-[13px] text-[#CBD5E1] tabular-nums">
                        {formatKzt(item.amount_kzt)}
                      </span>
                    </div>
                    <div className="text-[13px] text-[#CBD5E1] flex flex-wrap items-center gap-2 font-mono">
                      <span>0 → 1</span>
                      {item.old_risk_score !== null &&
                        item.new_risk_score !== null && (
                          <span>
                            · Score {item.old_risk_score.toFixed(1)} →{" "}
                            <strong className="text-[#43D17A]">
                              {item.new_risk_score.toFixed(1)}
                            </strong>
                          </span>
                        )}
                      {item.new_triggered_rules.length > 0 && (
                        <span className="font-sans text-[#B8C0BC] truncate">
                          · {item.new_triggered_rules.slice(0, 2).map(ruleLabel).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-4 w-4 text-[#B8C0BC] shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2) Newly Introduced Errors */}
        <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[#F16B6B]">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                {t.v34.newErrorsTitle} ({diffData ? newErrors.length : "—"})
              </span>
            </div>
            {newErrors.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllErrors((v) => !v)}
                className="text-[13px] text-[#CBD5E1] hover:text-[#F1F5F9]"
              >
                {showAllErrors ? t.v34.hideExtraWeaknesses : `${newErrors.length}`}
              </button>
            )}
          </div>

          {diffLoading && !diffData ? (
            <div className="flex items-center gap-2 text-sm text-[#CBD5E1] py-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#43D17A]" />
              <span>{t.result.loadingState}</span>
            </div>
          ) : visibleErrors.length === 0 ? (
            <div className="rounded-xl bg-[#202522] px-3.5 py-3 text-sm text-[#43D17A] flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{t.v34.newErrorsEmpty}</span>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleErrors.map((item) => (
                <button
                  key={`${item.errType}-${item.transaction_code}`}
                  type="button"
                  onClick={() =>
                    onInspectTransaction(item.transaction_code, evalCandExpId)
                  }
                  className="w-full rounded-xl bg-[#202522] hover:bg-[#262C28] p-3.5 text-left text-sm transition-colors flex items-start justify-between gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-[#F1F5F9]">
                        {item.transaction_code}
                      </span>
                      <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-[#F16B6B]/15 text-[#F16B6B]">
                        {item.errType === "FP"
                          ? t.v34.newFpBadge
                          : t.v34.newFnBadge}
                      </span>
                      <span className="text-[13px] text-[#CBD5E1] tabular-nums">
                        {formatKzt(item.amount_kzt)}
                      </span>
                    </div>
                    <div className="text-[13px] text-[#CBD5E1] flex flex-wrap items-center gap-2 font-mono">
                      <span>
                        {item.old_decision} → {item.new_decision}
                      </span>
                      {item.old_risk_score !== null &&
                        item.new_risk_score !== null && (
                          <span>
                            · Score {item.old_risk_score.toFixed(1)} →{" "}
                            <strong className="text-[#F16B6B]">
                              {item.new_risk_score.toFixed(1)}
                            </strong>
                          </span>
                        )}
                      {item.new_triggered_rules.length > 0 && (
                        <span className="font-sans text-[#B8C0BC] truncate">
                          · {item.new_triggered_rules.slice(0, 2).map(ruleLabel).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-4 w-4 text-[#B8C0BC] shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-Scenario Before vs After + Totals Verification */}
      {scenarioComparison.length > 0 && (
        <div className="rounded-2xl bg-[#1A1E1C] overflow-hidden">
          <div className="px-5 py-3.5 bg-[#202522] flex flex-wrap items-center justify-between gap-2 text-[15px]">
            <div className="flex items-center gap-2 font-semibold text-[#F1F5F9]">
              <TrendingUp className="h-4 w-4 text-[#43D17A]" />
              <span>{t.v34.scenarioDeltaTitle}</span>
            </div>
            <span className="text-[13px] text-[#B8C0BC]">
              {t.v34.hintFnShort} · {t.v34.hintFpShort}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr className="text-[#B8C0BC] border-b border-white/[0.06] text-[13px]">
                  <th className="py-3 px-4 font-medium">{t.v34.colScenario}</th>
                  <th className="py-3 px-3 font-medium">{t.v34.colRiskEvents}</th>
                  <th className="py-3 px-3 font-medium">{t.v34.colBefore}</th>
                  <th className="py-3 px-3 font-medium">{t.v34.colAfter}</th>
                  <th className="py-3 px-3 font-medium">{t.v34.colFnDelta}</th>
                  <th className="py-3 px-3 font-medium">{t.v34.colFpDelta}</th>
                  <th className="py-3 px-4 font-medium">{t.v34.colAssessment}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {scenarioComparison.map((sc) => {
                  const riskCount = sc.actual_risk_events;
                  const hasRiskEvents =
                    riskCount !== null && riskCount !== undefined && riskCount > 0;
                  const recallDelta = sc.recall_delta ?? 0;
                  const fnD = sc.fn_delta ?? 0;
                  const fpD = sc.fp_delta ?? 0;

                  let statusText: string = t.v34.statusSame;
                  let statusTone = "text-[#CBD5E1] bg-[#202522]";
                  if (
                    (riskCount === 0 || riskCount === null || riskCount === undefined) &&
                    fpD === 0
                  ) {
                    statusText = t.v34.insufficientData;
                    statusTone = "text-[#B8C0BC] bg-[#202522]";
                  } else if ((recallDelta > 0.005 || fnD < 0) && fpD <= 0) {
                    statusText = t.v34.statusBetter;
                    statusTone = "text-[#43D17A] bg-[#43D17A]/15";
                  } else if (recallDelta > 0.005 && fpD > 0) {
                    statusText = `${t.v34.statusBetter} / FP +${fpD}`;
                    statusTone = "text-[#E3AD56] bg-[#E3AD56]/15";
                  } else if (recallDelta < -0.005 || fpD > 0 || fnD > 0) {
                    statusText = t.v34.statusWorse;
                    statusTone = "text-[#F16B6B] bg-[#F16B6B]/15";
                  }

                  const fnTone =
                    fnD < 0
                      ? "text-[#43D17A]"
                      : fnD > 0
                        ? "text-[#F16B6B]"
                        : "text-[#CBD5E1]";
                  const fpTone =
                    fpD > 0
                      ? "text-[#F16B6B]"
                      : fpD < 0
                        ? "text-[#43D17A]"
                        : "text-[#CBD5E1]";

                  return (
                    <tr key={sc.scenario_type} className="hover:bg-[#232825] transition-colors">
                      <td className="py-3 px-4 font-medium text-[#F1F5F9]">
                        {scenarioLabel(sc.scenario_type)}
                      </td>
                      <td className="py-3 px-3 font-mono text-[#CBD5E1] tabular-nums">
                        {riskCount ?? "—"}
                      </td>
                      <td className="py-3 px-3 font-mono text-[#CBD5E1] tabular-nums">
                        {hasRiskEvents && sc.baseline_recall !== null
                          ? `${(sc.baseline_recall * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-[#F1F5F9] tabular-nums">
                        {hasRiskEvents && sc.candidate_recall !== null
                          ? `${(sc.candidate_recall * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className={`py-3 px-3 text-base font-semibold font-mono tabular-nums ${fnTone}`}>
                        {sc.baseline_fn !== null &&
                        sc.baseline_fn !== undefined &&
                        sc.candidate_fn !== null &&
                        sc.candidate_fn !== undefined
                          ? `${sc.baseline_fn} → ${sc.candidate_fn}`
                          : "—"}
                      </td>
                      <td className={`py-3 px-3 text-base font-semibold font-mono tabular-nums ${fpTone}`}>
                        {sc.baseline_fp !== null &&
                        sc.baseline_fp !== undefined &&
                        sc.candidate_fp !== null &&
                        sc.candidate_fp !== undefined
                          ? `${sc.baseline_fp} → ${sc.candidate_fp}`
                          : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] font-semibold ${statusTone}`}
                        >
                          {statusText === t.v34.statusWorse && (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          <span>{statusText}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {scenarioAudit?.categories_disjoint && (
                <tfoot>
                  <tr className="border-t border-white/[0.08] bg-[#141715] font-semibold text-[#F1F5F9]">
                    <td className="py-3 px-4">{t.v34.totalsRowLabel}</td>
                    <td className="py-3 px-3 font-mono tabular-nums">
                      {scenarioAudit.overall.actual_risk_events}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-[#CBD5E1]">
                      {formatPp(base.recall * 100)}%
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-[#F1F5F9]">
                      {formatPp(cand.recall * 100)}%
                    </td>
                    <td className="py-3 px-3 text-base font-mono tabular-nums text-[#43D17A]">
                      {scenarioAudit.overall.baseline_fn} →{" "}
                      {scenarioAudit.overall.candidate_fn}
                    </td>
                    <td
                      className={`py-3 px-3 text-base font-mono tabular-nums ${
                        scenarioAudit.overall.candidate_fp >
                        scenarioAudit.overall.baseline_fp
                          ? "text-[#F16B6B]"
                          : "text-[#CBD5E1]"
                      }`}
                    >
                      {scenarioAudit.overall.baseline_fp} →{" "}
                      {scenarioAudit.overall.candidate_fp}
                    </td>
                    <td className="py-3 px-4 text-[13px] font-mono text-[#43D17A]">
                      {scenarioAudit.totals_match_overall ? "✓ MATCH" : "CHECK"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {scenarioAudit && (
            <div className="px-4 py-2.5 text-[13px] text-[#B8C0BC] bg-[#141715]">
              {scenarioAudit.categories_disjoint
                ? t.v34.totalsDisjointNote
                : t.v34.totalsOverlapNote}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
