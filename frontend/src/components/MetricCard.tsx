import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export interface DeltaBadgeProps {
  deltaValue: number;
  isPercentage?: boolean;
  decimals?: number;
  higherIsBetter?: boolean;
  unitLabel?: string;
}

/**
 * Semantic delta badge:
 * - When higherIsBetter = true (Recall, Precision, F1): delta > 0 is green (positive), delta < 0 is red (negative).
 * - When higherIsBetter = false (FPR, FNR, False Positives): delta > 0 is RED (negative), delta < 0 is GREEN (positive).
 */
export const DeltaBadge: React.FC<DeltaBadgeProps> = ({
  deltaValue,
  isPercentage = true,
  decimals = 1,
  higherIsBetter = true,
  unitLabel = "pp",
}) => {
  const eps = isPercentage ? 0.00005 : 0.001;
  const isZero = Math.abs(deltaValue) < eps;
  const isImprovement = !isZero && (higherIsBetter ? deltaValue > 0 : deltaValue < 0);

  const formatted = isPercentage
    ? `${deltaValue > 0 ? "+" : ""}${(deltaValue * 100).toFixed(decimals)} ${unitLabel}`
    : `${deltaValue > 0 ? "+" : ""}${deltaValue.toFixed(decimals)}`;

  if (isZero) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-[#202522] text-[#77837C] tabular-nums">
        <Minus className="h-3 w-3" />
        <span>0.0{isPercentage ? ` ${unitLabel}` : ""}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full tabular-nums ${
        isImprovement
          ? "bg-[#43D17A]/15 text-[#43D17A]"
          : "bg-[#F16B6B]/15 text-[#F16B6B]"
      }`}
    >
      {deltaValue > 0 ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      <span>{formatted}</span>
    </span>
  );
};

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  deltaValue?: number;
  deltaHigherIsBetter?: boolean;
  deltaDecimals?: number;
  deltaIsPercentage?: boolean;
}

const toneColor: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-[#F4F6F4]",
  accent: "text-[#00B846]",
  success: "text-[#43D17A]",
  warning: "text-[#E3AD56]",
  danger: "text-[#F16B6B]",
};

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subtext,
  tone = "default",
  deltaValue,
  deltaHigherIsBetter = true,
  deltaDecimals = 1,
  deltaIsPercentage = true,
}) => {
  return (
    <div className="dp-elevated p-4">
      <div className="text-[11px] font-semibold text-[#77837C] uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className={`text-2xl font-bold tabular-nums ${toneColor[tone]}`}>{value}</div>
        {deltaValue !== undefined && (
          <DeltaBadge
            deltaValue={deltaValue}
            higherIsBetter={deltaHigherIsBetter}
            decimals={deltaDecimals}
            isPercentage={deltaIsPercentage}
          />
        )}
      </div>
      {subtext && <div className="mt-1.5 text-xs text-[#A1ABA4]">{subtext}</div>}
    </div>
  );
};
