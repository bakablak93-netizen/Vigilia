import React from "react";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { ExperimentSummary } from "../../types/api";
import { buildVigiliaConclusion } from "../../utils/humanExplain";
import { VigiliaPixelLogo } from "../v4/VigiliaPixelLogo";

interface VigiliaConclusionCardProps {
  experiment: ExperimentSummary;
  hasProposal: boolean;
  hasVerifiedComparison: boolean;
  onActionClick: () => void;
}

/**
 * Top-of-workspace "Заключение VIGILIA" card.
 * Always shown FIRST (above all charts and tables) so any non-technical user
 * understands the test result in under 10 seconds.
 */
export const VigiliaConclusionCard: React.FC<VigiliaConclusionCardProps> = ({
  experiment,
  hasProposal,
  hasVerifiedComparison,
  onActionClick,
}) => {
  const { t, lang, scenarioLabel } = useLab();
  const conclusion = buildVigiliaConclusion(experiment, scenarioLabel, lang);
  const isBlackBox = experiment.diagnostic_mode === "black_box";

  const badgeTone =
    conclusion.tone === "good"
      ? "bg-[#43D17A]/15 text-[#43D17A]"
      : conclusion.tone === "danger"
        ? "bg-[#F16B6B]/15 text-[#F16B6B]"
        : conclusion.tone === "warn"
          ? "bg-[#E3AD56]/15 text-[#E3AD56]"
          : "bg-[#202522] text-[#A1ABA4]";

  const ctaLabel = isBlackBox
    ? t.v4h.btnGoToRecs
    : hasVerifiedComparison
      ? t.v4.navComparison
      : hasProposal
        ? t.v4h.btnVerifyImproved
        : t.v4h.btnFindImprovement;

  return (
    <section
      id="sec-conclusion"
      className="v4-surface p-5 sm:p-6 space-y-4 focus-enter"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <VigiliaPixelLogo variant="mark" size={30} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#F4F6F4]">
                {t.v4h.conclusionTitle}
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${badgeTone}`}
              >
                {conclusion.headlineBadge}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onActionClick}
          className="btn-primary px-5 py-2.5 text-xs sm:text-sm inline-flex items-center gap-2"
        >
          {hasProposal && !isBlackBox ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          <span>{ctaLabel}</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Four concise plain-language statements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs leading-relaxed">
        <div className="dp-elevated p-3.5 space-y-1">
          <div className="text-[11px] font-semibold text-[#77837C]">
            {t.v4h.partChecked}
          </div>
          <p className="text-[#F4F6F4]">{conclusion.whatChecked}</p>
        </div>

        <div className="dp-elevated p-3.5 space-y-1">
          <div className="text-[11px] font-semibold text-[#77837C]">
            {t.v4h.partFound}
          </div>
          <p className="text-[#F4F6F4]">{conclusion.whatFound}</p>
        </div>

        <div className="dp-elevated p-3.5 space-y-1">
          <div className="text-[11px] font-semibold text-[#77837C]">
            {t.v4h.partMeans}
          </div>
          <p className="text-[#D4DDD7]">{conclusion.whatMeans}</p>
        </div>

        <div className="dp-elevated p-3.5 space-y-1">
          <div className="text-[11px] font-semibold text-[#43D17A]">
            {t.v4h.partRecommend}
          </div>
          <p className="text-[#D4DDD7]">{conclusion.whatRecommended}</p>
        </div>
      </div>
    </section>
  );
};
