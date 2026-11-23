import React, { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

interface StepProgressChecklistProps {
  title: string;
  steps: string[];
  cancelLabel?: string;
  onCancel?: () => void;
}

/**
 * Borderless dark animated step-by-step progress card for analysis & verification phases.
 */
export const StepProgressChecklist: React.FC<StepProgressChecklistProps> = ({
  title,
  steps,
  cancelLabel,
  onCancel,
}) => {
  const [completedIdx, setCompletedIdx] = useState(0);

  useEffect(() => {
    setCompletedIdx(0);
    const t1 = window.setTimeout(() => setCompletedIdx(1), 500);
    const t2 = window.setTimeout(() => setCompletedIdx(2), 1150);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [title, steps.length]);

  return (
    <div className="v4-surface p-8 sm:p-10 max-w-xl mx-auto space-y-6 v5-step-enter">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[#16A34A]/15 flex items-center justify-center shrink-0">
            <Loader2 className="h-5 w-5 animate-spin text-[#22C55E]" />
          </div>
          <h2 className="text-xl font-bold text-[#F1F5F9]">{title}</h2>
        </div>
        {onCancel && cancelLabel && (
          <button
            type="button"
            onClick={onCancel}
            className="btn-subtle px-3.5 py-2 text-sm inline-flex items-center gap-1.5"
          >
            <X className="h-4 w-4" />
            <span>{cancelLabel}</span>
          </button>
        )}
      </div>

      <div className="v4-shimmer-track">
        <div className="v4-shimmer-bar" />
      </div>

      <div className="space-y-3">
        {steps.map((label, idx) => {
          const isDone = idx < completedIdx;
          const isCurrent = idx === completedIdx;
          return (
            <div
              key={label}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 ${
                isDone
                  ? "bg-[#16A34A]/15 text-[#F1F5F9]"
                  : isCurrent
                    ? "bg-[#161E1B] text-[#F1F5F9]"
                    : "bg-[#0B100E]/60 text-[#64748B]"
              }`}
            >
              <span
                className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  isDone
                    ? "bg-[#16A34A] text-white"
                    : isCurrent
                      ? "bg-[#16A34A]/20 text-[#22C55E]"
                      : "bg-white/10 text-[#64748B]"
                }`}
              >
                {isDone ? (
                  <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                ) : isCurrent ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="text-xs font-mono font-bold">{idx + 1}</span>
                )}
              </span>
              <span className="text-[15px] font-medium">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
