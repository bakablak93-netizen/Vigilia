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

  const tradeoffText =
    externalEvolution?.tradeoff_assessment ||
    evolutionRun?.tradeoff_assessment ||
    "";

  const base = activeComparison.baseline;
  const cand = activeComparison.candidate;
  const recallDiffPp = (cand.recall - base.recall) * 100;
  const precDiffPp = (cand.precision - base.precision) * 100;
  const fprDiffPp = (cand.false_positive_rate - base.false_positive_rate) * 100;
  const tpDelta = cand.true_positives - base.true_positives;
  const fnDelta = base.false_negatives - cand.false_negatives;
  const fpDelta = cand.false_positives - base.false_positives;

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
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#77837C]">
            <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#43D17A] bg-[#008F36]/20 px-2.5 py-0.5 rounded-full">
              {t.v34.sec4Tag}
            </span>
            <span className="font-semibold uppercase tracking-wider text-[#A1ABA4]">
              {t.v34.sec4Title}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full font-semibold ${verdictBadgeTone}`}
            >
              {t.verdicts[verdict as keyof typeof t.verdicts] || verdict}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F4F6F4]">
            {baselineVersion} → {candidateVersion}
          </h2>
          <p className="text-xs text-[#A1ABA4]">{t.v34.evalScopeNote}</p>
        </div>

        <button
          type="button"
          onClick={() => onOpenAnalytics("evolution")}
          className="btn-subtle px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5"
        >
          <BarChart3 className="h-3.5 w-3.5 text-[#43D17A]" />
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
          <div className="dp-elevated p-4 sm:p-5 space-y-2.5 text-xs leading-relaxed">
            <p className="text-sm font-semibold text-[#F4F6F4] leading-snug">
              {story.headline}
            </p>
            <div className="v4-surface-inset px-3.5 py-2.5 space-y-0.5">
              <div className="text-[11px] font-semibold text-[#77837C]">
                {t.v4h.shouldAdoptLabel}
              </div>
              <p className={`font-medium ${adoptTone}`}>{story.shouldAdopt}</p>
            </div>
          </div>
        );
      })()}

      {/* Headline Deltas (elevated KPI wells, concise) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dp-elevated p-4 space-y-1" title={t.v34.hintRecallShort}>
          <div className="text-xs text-[#A1ABA4]">Recall</div>
          <div className="text-lg font-bold tabular-nums text-[#F4F6F4]">
            {formatPp(base.recall * 100)}% →{" "}
            <span
              className={
                recallWorse
                  ? "text-[#F16B6B]"
                  : recallDiffPp > 0.05
                    ? "text-[#43D17A]"
                    : "text-[#F4F6F4]"
              }
            >
              {formatPp(cand.recall * 100)}%
            </span>
          </div>
          <div
            className={`text-xs font-mono tabular-nums ${
              recallDiffPp > 0.05
                ? "text-[#43D17A]"
                : recallWorse
                  ? "text-[#F16B6B]"
                  : "text-[#A1ABA4]"
            }`}
          >
            {recallDiffPp >= 0 ? "+" : ""}
            {formatPp(recallDiffPp)} {t.focus.ppUnit}
          </div>
        </div>

        <div className="dp-elevated p-4 space-y-1" title={t.v34.hintFprShort}>
          <div className="text-xs text-[#A1ABA4]">FPR</div>
          <div className="text-lg font-bold tabular-nums text-[#F4F6F4]">
            {formatPp(base.false_positive_rate * 100, 2)}% →{" "}
            <span
              className={
                fprWorse
                  ? "text-[#F16B6B]"
                  : fprDiffPp < -0.005
                    ? "text-[#43D17A]"
                    : "text-[#F4F6F4]"
              }
            >
              {formatPp(cand.false_positive_rate * 100, 2)}%
            </span>
          </div>
          <div
            className={`text-xs font-mono tabular-nums ${
              fprWorse
                ? "text-[#F16B6B]"
                : fpDelta < 0
                  ? "text-[#43D17A]"
                  : "text-[#A1ABA4]"
            }`}
          >
            FP: {base.false_positives} → {cand.false_positives} (
            {fpDelta >= 0 ? `+${fpDelta}` : fpDelta})
          </div>
        </div>

        <div className="dp-elevated p-4 space-y-1">
          <div className="text-xs text-[#A1ABA4]">Precision</div>
          <div className="text-lg font-bold tabular-nums text-[#F4F6F4]">
            {formatPp(base.precision * 100)}% →{" "}
            <span
              className={
                precisionWorse
                  ? "text-[#F16B6B]"
                  : precDiffPp > 0.05
                    ? "text-[#43D17A]"
                    : "text-[#F4F6F4]"
              }
            >
              {formatPp(cand.precision * 100)}%
            </span>
          </div>
          <div
            className={`text-xs font-mono tabular-nums ${
              precisionWorse
                ? "text-[#F16B6B]"
                : precDiffPp > 0.05
                  ? "text-[#43D17A]"
                  : "text-[#A1ABA4]"
            }`}
          >
            {precDiffPp >= 0 ? "+" : ""}
            {formatPp(precDiffPp)} {t.focus.ppUnit}
          </div>
        </div>

        <div className="dp-elevated p-4 space-y-1" title={t.v34.hintFnShort}>
          <div className="text-xs text-[#A1ABA4]">{t.v34.extraDetected}</div>
          <div
            className={`text-lg font-bold tabular-nums ${
              tpDelta > 0
                ? "text-[#43D17A]"
                : tpDelta < 0
                  ? "text-[#F16B6B]"
                  : "text-[#F4F6F4]"
            }`}
          >
            {tpDelta >= 0 ? `+${tpDelta}` : tpDelta}
          </div>
          <div className="text-xs text-[#A1ABA4] font-mono tabular-nums">
            FN: {base.false_negatives} → {cand.false_negatives} · +{newFpCount} FP (
            {diffData ? diffData.summary.fixed_misses_count : Math.max(0, fnDelta)})
          </div>
        </div>
      </div>

      {/* Balanced Evaluation Summary (Successes + Regressions + Remaining Weaknesses + Guardrails Verdict) */}
      <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3">
        <div className="text-xs font-semibold text-[#F4F6F4]">
          {t.v34.evalVerdictSummaryTitle}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-[#202522] p-3 space-y-1.5">
            <div className="font-semibold text-[#43D17A]">
              {t.v34.evalImprovedLabel}
            </div>
            {improvements.length > 0 ? (
              <ul className="space-y-1 text-[11px] text-[#F4F6F4]">
                {improvements.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[#77837C]">—</p>
            )}
          </div>

          <div className="rounded-xl bg-[#202522] p-3 space-y-1.5">
            <div
              className={`font-semibold ${
                regressions.length > 0 ? "text-[#F16B6B]" : "text-[#43D17A]"
              }`}
            >
              {t.v34.evalWorseLabel}
            </div>
            {regressions.length > 0 ? (
              <ul className="space-y-1 text-[11px] text-[#F16B6B]">
                {regressions.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[#43D17A]">
                {t.v34.evalNoRegressions}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-[#202522] p-3 space-y-1.5">
            <div className="font-semibold text-[#E3AD56]">
              {t.v34.evalRemainingLabel}
            </div>
            {remainingLines.length > 0 ? (
              <ul className="space-y-1 text-[11px] text-[#A1ABA4]">
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
              <p className="text-[11px] text-[#43D17A]">
                {t.v34.evalNoRemaining}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-[#202522] p-3 space-y-1.5">
            <div className="font-semibold text-[#A1ABA4]">
              {t.v34.evalVerdictReasonLabel}
            </div>
            <p className="text-[11px] text-[#F4F6F4] leading-relaxed">
              {tradeoffText ||
                (t.verdicts[verdict as keyof typeof t.verdicts] || verdict)}
            </p>
            {guardrailReport?.checks && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.entries(guardrailReport.checks).map(([k, ok]) => (
                  <span
                    key={k}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
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
            <div className="flex items-center gap-2 text-xs font-semibold text-[#43D17A]">
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
                className="text-[11px] text-[#A1ABA4] hover:text-[#F4F6F4]"
              >
                {showAllFixed ? t.v34.hideExtraWeaknesses : `${fixedMisses.length}`}
              </button>
            )}
          </div>

          {diffLoading && !diffData ? (
            <div className="flex items-center gap-2 text-xs text-[#A1ABA4] py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#43D17A]" />
              <span>{t.result.loadingState}</span>
            </div>
          ) : visibleFixed.length === 0 ? (
            <div className="rounded-xl bg-[#202522] px-3.5 py-3 text-xs text-[#A1ABA4]">
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
                  className="w-full rounded-xl bg-[#202522] hover:bg-[#262C28] p-3 text-left text-xs transition-colors flex items-start justify-between gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-[#F4F6F4]">
                        {item.transaction_code}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#43D17A]/15 text-[#43D17A]">
                        {scenarioLabel(item.scenario_type)}
                      </span>
                      <span className="text-[11px] text-[#A1ABA4] tabular-nums">
                        {formatKzt(item.amount_kzt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#A1ABA4] flex flex-wrap items-center gap-2 font-mono">
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
                        <span className="font-sans text-[#77837C] truncate">
                          · {item.new_triggered_rules.slice(0, 2).map(ruleLabel).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-3.5 w-3.5 text-[#77837C] shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2) Newly Introduced Errors */}
        <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F16B6B]">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                {t.v34.newErrorsTitle} ({diffData ? newErrors.length : "—"})
              </span>
            </div>
            {newErrors.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllErrors((v) => !v)}
                className="text-[11px] text-[#A1ABA4] hover:text-[#F4F6F4]"
              >
                {showAllErrors ? t.v34.hideExtraWeaknesses : `${newErrors.length}`}
              </button>
            )}
          </div>

          {diffLoading && !diffData ? (
            <div className="flex items-center gap-2 text-xs text-[#A1ABA4] py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#43D17A]" />
              <span>{t.result.loadingState}</span>
            </div>
          ) : visibleErrors.length === 0 ? (
            <div className="rounded-xl bg-[#202522] px-3.5 py-3 text-xs text-[#43D17A] flex items-center gap-2">
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
                  className="w-full rounded-xl bg-[#202522] hover:bg-[#262C28] p-3 text-left text-xs transition-colors flex items-start justify-between gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-[#F4F6F4]">
                        {item.transaction_code}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F16B6B]/15 text-[#F16B6B]">
                        {item.errType === "FP"
                          ? t.v34.newFpBadge
                          : t.v34.newFnBadge}
                      </span>
                      <span className="text-[11px] text-[#A1ABA4] tabular-nums">
                        {formatKzt(item.amount_kzt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#A1ABA4] flex flex-wrap items-center gap-2 font-mono">
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
                        <span className="font-sans text-[#77837C] truncate">
                          · {item.new_triggered_rules.slice(0, 2).map(ruleLabel).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-3.5 w-3.5 text-[#77837C] shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-Scenario Before vs After + Totals Verification */}
      {scenarioComparison.length > 0 && (
        <div className="rounded-2xl bg-[#1A1E1C] overflow-hidden">
          <div className="px-4 py-3 bg-[#202522] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#F4F6F4]">
              <TrendingUp className="h-4 w-4 text-[#43D17A]" />
              <span>{t.v34.scenarioDeltaTitle}</span>
            </div>
            <span className="text-[11px] text-[#77837C]">
              {t.v34.hintFnShort} · {t.v34.hintFpShort}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[#77837C] border-b border-white/[0.06]">
                  <th className="py-2.5 px-4 font-medium">{t.v34.colScenario}</th>
                  <th className="py-2.5 px-3 font-medium">{t.v34.colRiskEvents}</th>
                  <th className="py-2.5 px-3 font-medium">{t.v34.colBefore}</th>
                  <th className="py-2.5 px-3 font-medium">{t.v34.colAfter}</th>
                  <th className="py-2.5 px-3 font-medium">{t.v34.colFnDelta}</th>
                  <th className="py-2.5 px-3 font-medium">{t.v34.colFpDelta}</th>
                  <th className="py-2.5 px-4 font-medium">{t.v34.colAssessment}</th>
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
                  let statusTone = "text-[#A1ABA4] bg-[#202522]";
                  if (
                    (riskCount === 0 || riskCount === null || riskCount === undefined) &&
                    fpD === 0
                  ) {
                    statusText = t.v34.insufficientData;
                    statusTone = "text-[#77837C] bg-[#202522]";
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
                        : "text-[#A1ABA4]";
                  const fpTone =
                    fpD > 0
                      ? "text-[#F16B6B]"
                      : fpD < 0
                        ? "text-[#43D17A]"
                        : "text-[#A1ABA4]";

                  return (
                    <tr key={sc.scenario_type}>
                      <td className="py-2.5 px-4 font-medium text-[#F4F6F4]">
                        {scenarioLabel(sc.scenario_type)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#A1ABA4] tabular-nums">
                        {riskCount ?? "—"}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#A1ABA4] tabular-nums">
                        {hasRiskEvents && sc.baseline_recall !== null
                          ? `${(sc.baseline_recall * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#F4F6F4] tabular-nums">
                        {hasRiskEvents && sc.candidate_recall !== null
                          ? `${(sc.candidate_recall * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className={`py-2.5 px-3 font-mono tabular-nums ${fnTone}`}>
                        {sc.baseline_fn !== null &&
                        sc.baseline_fn !== undefined &&
                        sc.candidate_fn !== null &&
                        sc.candidate_fn !== undefined
                          ? `${sc.baseline_fn} → ${sc.candidate_fn}`
                          : "—"}
                      </td>
                      <td className={`py-2.5 px-3 font-mono tabular-nums ${fpTone}`}>
                        {sc.baseline_fp !== null &&
                        sc.baseline_fp !== undefined &&
                        sc.candidate_fp !== null &&
                        sc.candidate_fp !== undefined
                          ? `${sc.baseline_fp} → ${sc.candidate_fp}`
                          : "—"}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusTone}`}
                        >
                          {statusText === t.v34.statusWorse && (
                            <AlertTriangle className="h-3 w-3" />
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
                  <tr className="border-t border-white/[0.08] bg-[#141715] font-semibold text-[#F4F6F4]">
                    <td className="py-2.5 px-4">{t.v34.totalsRowLabel}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      {scenarioAudit.overall.actual_risk_events}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#A1ABA4]">
                      {formatPp(base.recall * 100)}%
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#F4F6F4]">
                      {formatPp(cand.recall * 100)}%
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#43D17A]">
                      {scenarioAudit.overall.baseline_fn} →{" "}
                      {scenarioAudit.overall.candidate_fn}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono tabular-nums ${
                        scenarioAudit.overall.candidate_fp >
                        scenarioAudit.overall.baseline_fp
                          ? "text-[#F16B6B]"
                          : "text-[#A1ABA4]"
                      }`}
                    >
                      {scenarioAudit.overall.baseline_fp} →{" "}
                      {scenarioAudit.overall.candidate_fp}
                    </td>
                    <td className="py-2.5 px-4 text-[10px] font-mono text-[#43D17A]">
                      {scenarioAudit.totals_match_overall ? "✓ MATCH" : "CHECK"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {scenarioAudit && (
            <div className="px-4 py-2 text-[11px] text-[#77837C] bg-[#141715]">
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
