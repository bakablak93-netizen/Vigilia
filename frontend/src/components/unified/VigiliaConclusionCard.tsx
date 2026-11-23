import React, { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldCheck,
  ShieldPlus,
  X,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { ExperimentSummary } from "../../types/api";
import { buildVigiliaConclusion } from "../../utils/humanExplain";
import { AnimatedNumber, getRecallColorClass } from "../v4/AnimatedNumber";
import { VigiliaPixelLogo } from "../v4/VigiliaPixelLogo";

export type ImprovementLifecyclePhase =
  | "BASELINE_RESULT"
  | "IMPROVEMENT_REQUESTED"
  | "CANDIDATE_READY"
  | "VERIFICATION"
  | "COMPARISON_AVAILABLE";

interface VigiliaConclusionCardProps {
  experiment: ExperimentSummary;
  phase: ImprovementLifecyclePhase;
  validatingPhase: "eval_base" | "eval_cand" | "diffing" | null;
  canVerifyBlackBoxPolicy?: boolean;
  onStartImprovement: () => void;
  onVerifyCandidate: () => void;
  onCancelImprovement: () => void;
  onScrollToSection: (sectionId: string) => void;
  onOpenAnalytics: () => void;
}

/**
 * Unified top-of-workspace "Заключение VIGILIA" surface.
 * Single cohesive analytical block (no 4-card split) + focal "Улучшить защиту" CTA.
 */
export const VigiliaConclusionCard: React.FC<VigiliaConclusionCardProps> = ({
  experiment,
  phase,
  validatingPhase,
  canVerifyBlackBoxPolicy = false,
  onStartImprovement,
  onVerifyCandidate,
  onCancelImprovement,
  onScrollToSection,
  onOpenAnalytics,
}) => {
  const { t, lang, scenarioLabel, formatKzt } = useLab();
  const [showDetails, setShowDetails] = useState(false);

  const conclusion = buildVigiliaConclusion(experiment, scenarioLabel, lang);
  const isBlackBox = experiment.diagnostic_mode === "black_box";
  const m = experiment.metrics_json;
  const recallNum =
    m.actual_risk_events > 0 ? (m.true_positives / m.actual_risk_events) * 100 : 0;
  const fprNum = m.false_positive_rate * 100;
  const missedAmount = m.missed_fraud_amount ?? 0;
  const preventedAmount = m.prevented_fraud_amount ?? 0;
  const falseDeclineAmount = m.false_decline_amount ?? 0;
  const reviewQueueCount = m.review_queue_count ?? 0;
  const reviewQueuePct = (m.review_queue_rate ?? 0) * 100;

  const badgeTone =
    conclusion.tone === "good"
      ? "bg-[#43D17A]/15 text-[#43D17A]"
      : conclusion.tone === "danger"
        ? "bg-[#F16B6B]/15 text-[#F16B6B]"
        : conclusion.tone === "warn"
          ? "bg-[#E3AD56]/15 text-[#E3AD56]"
          : "bg-[#202522] text-[#A1ABA4]";

  const verificationStatusText =
    validatingPhase === "eval_base"
      ? t.v34.validatingStage1
      : validatingPhase === "diffing"
        ? t.v34.validatingStage3
        : t.v34.validatingStage2;

  return (
    <section
      id="sec-conclusion"
      className="v4-surface p-5 sm:p-6 space-y-4 focus-enter"
    >
      {/* Unified Header + Security Status */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <div className="pt-0.5 shrink-0">
            <VigiliaPixelLogo variant="mark" size={34} />
          </div>
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-[#F1F5F9]">
                {t.v4h.conclusionTitle}
              </h1>
              <span
                className={`px-3 py-1 rounded-full text-[13px] font-semibold ${badgeTone}`}
              >
                {conclusion.headlineBadge}
              </span>
              <span
                className={`px-3 py-1 rounded-full text-[13px] font-medium ${
                  isBlackBox
                    ? "bg-[#E3AD56]/15 text-[#E3AD56]"
                    : "bg-[#43D17A]/12 text-[#43D17A]"
                }`}
                title={isBlackBox ? t.v4h.blackBoxScopeNote : t.v4h.whiteBoxScopeNote}
              >
                {isBlackBox ? t.v4h.blackBoxScopeBadge : t.v4h.whiteBoxScopeBadge}
              </span>
            </div>

            {/* 2 concise lines: main problem + key numbers */}
            <p className="text-[15px] text-[#F1F5F9] leading-relaxed max-w-3xl">
              {conclusion.whatFound}
            </p>
            <p className="text-sm text-[#CBD5E1] leading-relaxed max-w-3xl">
              {conclusion.whatMeans}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9] inline-flex items-center gap-1 shrink-0 py-1 px-2 rounded-xl transition-colors"
        >
          <span>{showDetails ? t.v4h.detailsHide : t.v4h.detailsToggle}</span>
          {showDetails ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Hero KPI Block — Money First (2x2 Grid: Missed & Blocked Fraud in ₸ + False Declines & Review Queue) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 v4-stagger">
        {/* 1. Пропущенный фрод (Missed Fraud in ₸ — Red/Amber Hero Accent) */}
        <div
          className={`rounded-2xl px-4 py-3.5 space-y-1 border transition-colors duration-200 ${
            missedAmount > 0
              ? "bg-gradient-to-br from-[#2B1517]/95 to-[#151011]/95 border-rose-500/35 hover:border-rose-400/60 shadow-[0_8px_24px_rgba(244,63,94,0.12)]"
              : "v4-surface-inset border-[#43D17A]/25"
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-[#CBD5E1]">
            <span className="whitespace-nowrap">{t.v4h.bizMissedAmount}</span>
            <span
              className={`font-mono text-[13px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap shrink-0 ${
                m.false_negatives > 0
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-[#43D17A]/15 text-[#43D17A]"
              }`}
            >
              FN: {m.false_negatives}
            </span>
          </div>
          <div
            className={`text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight ${
              missedAmount > 0 ? "text-rose-400" : "text-[#43D17A]"
            }`}
          >
            <AnimatedNumber value={missedAmount} formatter={formatKzt} />
          </div>
          <div className="text-[13px] text-[#B8C0BC] tabular-nums">
            {t.v33.missedThreatsShort}:{" "}
            <strong className={m.false_negatives > 0 ? "text-amber-400" : "text-[#F1F5F9]"}>
              {m.false_negatives} / {m.actual_risk_events}
            </strong>
          </div>
        </div>

        {/* 2. Заблокированный фрод (Blocked Fraud in ₸ — Emerald Hero Accent) */}
        <div className="rounded-2xl px-4 py-3.5 space-y-1 bg-gradient-to-br from-[#112A1B]/95 to-[#101713]/95 border border-[#43D17A]/35 hover:border-[#43D17A]/60 transition-colors duration-200 shadow-[0_8px_24px_rgba(0,184,70,0.14)]">
          <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-[#CBD5E1]">
            <span className="whitespace-nowrap">{t.v4h.bizPreventedAmount}</span>
            <span className="font-mono text-[13px] font-bold px-2 py-0.5 rounded-md bg-[#43D17A]/15 text-[#43D17A] whitespace-nowrap shrink-0">
              TP: {m.true_positives}
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight text-[#43D17A]">
            <AnimatedNumber value={preventedAmount} formatter={formatKzt} />
          </div>
          <div className="text-[13px] text-[#B8C0BC] tabular-nums">
            Recall:{" "}
            <strong className={getRecallColorClass(recallNum)}>
              {m.actual_risk_events > 0 ? (
                <AnimatedNumber value={recallNum} decimals={1} suffix="%" />
              ) : (
                "—"
              )}
            </strong>{" "}
            ({m.true_positives}/{m.actual_risk_events})
          </div>
        </div>

        {/* 3. Ложные отказы (False Declines in ₸ — Compact Card) */}
        <div className="v4-surface-inset rounded-xl px-4 py-3.5 space-y-1 border border-white/[0.05] hover:border-white/[0.15] transition-colors duration-200">
          <div className="flex items-center justify-between gap-2 text-[13px] text-[#CBD5E1]">
            <span className="whitespace-nowrap">{t.v4h.bizFalseDeclineAmount}</span>
            <span className="font-mono text-[13px] text-[#B8C0BC] whitespace-nowrap shrink-0">
              FP: {m.false_positives}
            </span>
          </div>
          <div
            className={`text-lg sm:text-xl font-bold tabular-nums tracking-tight ${
              falseDeclineAmount > 0 ? "text-amber-400" : "text-[#F1F5F9]"
            }`}
          >
            <AnimatedNumber value={falseDeclineAmount} formatter={formatKzt} />
          </div>
          <div className="text-[13px] text-[#B8C0BC] tabular-nums">
            FPR:{" "}
            <strong className={fprNum > 3 ? "text-rose-400" : fprNum > 1 ? "text-amber-400" : "text-[#F1F5F9]"}>
              <AnimatedNumber value={fprNum} decimals={2} suffix="%" />
            </strong>
          </div>
        </div>

        {/* 4. Очередь Review (Review Queue — Compact Card) */}
        <div className="v4-surface-inset rounded-xl px-4 py-3.5 space-y-1 border border-white/[0.05] hover:border-white/[0.15] transition-colors duration-200">
          <div className="flex items-center justify-between gap-2 text-[13px] text-[#CBD5E1]">
            <span className="whitespace-nowrap">{t.v4h.bizReviewQueue}</span>
            <span className="font-mono text-[13px] text-[#B8C0BC] whitespace-nowrap shrink-0">
              <AnimatedNumber value={reviewQueuePct} decimals={1} suffix="%" />
            </span>
          </div>
          <div className="text-lg sm:text-xl font-bold tabular-nums tracking-tight text-[#F1F5F9]">
            <AnimatedNumber value={reviewQueueCount} decimals={0} />{" "}
            <span className="text-[13px] font-medium text-[#CBD5E1]">
              {t.v34.sec1OpsUnit}
            </span>
          </div>
          <div className="text-[13px] text-[#B8C0BC] tabular-nums">
            {experiment.engine_name || t.ext.internalLabel} · {m.total_transactions}{" "}
            {t.v34.sec1OpsUnit}
          </div>
        </div>
      </div>

      {/* Smooth CSS Grid Accordion for Expandable Context */}
      <div className={`v4-accordion-grid ${showDetails ? "is-open" : ""}`}>
        <div className="v4-accordion-inner">
          <div className="v4-surface-inset px-4 py-3.5 text-sm text-[#CBD5E1] space-y-2 leading-relaxed">
            <p>
              <span className="text-[#B8C0BC] font-semibold">{t.v4h.partChecked}: </span>
              {conclusion.whatChecked}
            </p>
            <p>
              <span className="text-[#43D17A] font-semibold">{t.v4h.partRecommend}: </span>
              {conclusion.whatRecommended}
            </p>
          </div>
        </div>
      </div>

      {/* Primary Action Strip — Focal "Улучшить защиту" CTA + Aligned Secondary Actions */}
      <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 pt-2 border-t border-white/[0.06]">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 min-w-0">
          {phase === "BASELINE_RESULT" && (
            <button
              type="button"
              onClick={onStartImprovement}
              className="btn-primary rounded-full px-6 py-3 text-[15px] sm:text-base font-semibold inline-flex items-center gap-2.5 whitespace-nowrap shrink-0"
            >
              <ShieldPlus className="h-5 w-5" />
              <span>
                {isBlackBox
                  ? t.v4h.btnPrepareBlackBoxRecs
                  : t.v4h.btnImproveDefense}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {phase === "IMPROVEMENT_REQUESTED" && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="v4-surface-inset px-4 py-2.5 rounded-2xl space-y-1.5 min-w-[260px]">
                <div className="inline-flex items-center gap-2.5 text-[15px] font-semibold text-[#43D17A]">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>{t.v4h.stageAnalyzeLabel}</span>
                </div>
                <div className="v4-shimmer-track">
                  <div className="v4-shimmer-bar" />
                </div>
              </div>
              <button
                type="button"
                onClick={onCancelImprovement}
                className="btn-subtle rounded-xl px-3.5 py-2.5 text-sm font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <X className="h-4 w-4" />
                <span>{t.v4h.btnCancelImprovement}</span>
              </button>
            </div>
          )}

          {phase === "CANDIDATE_READY" && (
            <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
              {isBlackBox && !canVerifyBlackBoxPolicy ? (
                <button
                  type="button"
                  onClick={() => onScrollToSection("sec-proposals")}
                  className="btn-primary rounded-full px-5 py-2.5 text-[15px] font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t.v4h.btnGoToRecs}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onVerifyCandidate}
                  className="btn-primary rounded-full px-5 py-2.5 text-[15px] font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>
                    {isBlackBox
                      ? t.v4h.btnVerifyExternalThreshold
                      : t.v4h.btnVerifyImproved}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onScrollToSection("sec-proposals")}
                className="btn-subtle rounded-xl px-3.5 py-2.5 text-sm font-medium whitespace-nowrap shrink-0"
              >
                {isBlackBox
                  ? t.v4h.blackBoxVendorRecsBadge
                  : t.v4h.concreteChangesTitle}
              </button>
              <button
                type="button"
                onClick={onCancelImprovement}
                className="btn-subtle rounded-xl px-3.5 py-2.5 text-sm font-medium text-[#CBD5E1] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <X className="h-4 w-4" />
                <span>{t.v4h.btnCancelImprovement}</span>
              </button>
            </div>
          )}

          {phase === "VERIFICATION" && (
            <div className="v4-surface-inset px-4 py-2.5 rounded-2xl space-y-1.5 min-w-[280px]">
              <div className="inline-flex items-center gap-2.5 text-[15px] font-semibold text-[#43D17A]">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>{verificationStatusText}</span>
              </div>
              <div className="v4-shimmer-track">
                <div className="v4-shimmer-bar" />
              </div>
            </div>
          )}

          {phase === "COMPARISON_AVAILABLE" && (
            <button
              type="button"
              onClick={() => onScrollToSection("sec-comparison")}
              className="btn-primary rounded-full px-6 py-3 text-[15px] font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{t.v4.navComparison}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Subdued secondary action aligned right on the same row */}
        <button
          type="button"
          onClick={onOpenAnalytics}
          className="btn-subtle rounded-xl px-3.5 py-2.5 text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9] inline-flex items-center gap-2 whitespace-nowrap shrink-0 lg:ml-auto"
        >
          <BarChart3 className="h-4 w-4 text-[#43D17A]" />
          <span>{t.v34.sec2OpenDrawer}</span>
        </button>
      </div>
    </section>
  );
};
