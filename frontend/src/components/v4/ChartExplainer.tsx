import React, { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { ChartExplainContent } from "../../utils/humanExplain";

interface ChartExplainerProps {
  content: ChartExplainContent;
}

/**
 * Compact chart explanation strip:
 * - Default: 1 short conclusion + 1 practical takeaway + "Объяснить подробнее" toggle
 * - Expanded: "Что показывает этот график?", "Что означают результаты?", "На что обратить внимание?"
 */
export const ChartExplainer: React.FC<ChartExplainerProps> = ({ content }) => {
  const { t } = useLab();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="v4-surface-inset px-3.5 py-2.5 space-y-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0 flex-1">
          <div className="text-[#F4F6F4] font-medium leading-snug">
            {content.shortSummary}
          </div>
          <div className="text-[11px] text-[#A1ABA4] flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[#E3AD56] shrink-0" />
            <span>{content.attentionPoint}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] font-semibold text-[#43D17A] hover:text-[#6EE7A0] inline-flex items-center gap-1 shrink-0 py-0.5"
        >
          <span>{expanded ? t.v4h.explainLess : t.v4h.explainMore}</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="pt-2 border-t border-white/[0.06] grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] leading-relaxed">
          <div>
            <div className="font-semibold text-[#77837C] mb-0.5">
              {t.v4h.chartWhatShows}
            </div>
            <p className="text-[#D4DDD7]">{content.whatShows}</p>
          </div>
          <div>
            <div className="font-semibold text-[#77837C] mb-0.5">
              {t.v4h.chartWhatMeans}
            </div>
            <p className="text-[#D4DDD7]">{content.detailedMeaning}</p>
          </div>
          <div>
            <div className="font-semibold text-[#77837C] mb-0.5">
              {t.v4h.chartAttention}
            </div>
            <p className="text-[#E3AD56]">{content.attentionPoint}</p>
          </div>
        </div>
      )}
    </div>
  );
};
