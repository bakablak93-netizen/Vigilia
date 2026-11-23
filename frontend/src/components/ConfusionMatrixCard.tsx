import React from "react";
import { useLab } from "../context/LabContext";
import type { ConfusionMatrix } from "../types/api";

interface Props {
  matrix: ConfusionMatrix;
  title?: string;
}

export const ConfusionMatrixCard: React.FC<Props> = ({ matrix, title }) => {
  const { t } = useLab();

  return (
    <div className="dp-elevated p-4">
      <h4 className="text-xs font-semibold text-[#F4F6F4] mb-3">
        {title || t.result.confusionTitle}
      </h4>
      <div className="grid grid-cols-2 gap-2.5 text-center">
        <div className="rounded-xl bg-[#43D17A]/10 p-3">
          <div className="text-[11px] font-medium text-[#43D17A]">
            {t.result.tpTitle}
          </div>
          <div
            className="mt-1 text-xl font-bold tabular-nums text-[#43D17A]"
            title="True Positives (TP)"
          >
            {matrix.tp}
          </div>
        </div>
        <div className="rounded-xl bg-[#F16B6B]/10 p-3">
          <div className="text-[11px] font-medium text-[#F16B6B]">
            {t.result.fpTitle}
          </div>
          <div
            className="mt-1 text-xl font-bold tabular-nums text-[#F16B6B]"
            title="False Positives (FP)"
          >
            {matrix.fp}
          </div>
        </div>
        <div className="rounded-xl bg-[#E3AD56]/10 p-3">
          <div className="text-[11px] font-medium text-[#E3AD56]">
            {t.result.fnTitle}
          </div>
          <div
            className="mt-1 text-xl font-bold tabular-nums text-[#E3AD56]"
            title="False Negatives (FN)"
          >
            {matrix.fn}
          </div>
        </div>
        <div className="rounded-xl bg-[#171A18] p-3">
          <div className="text-[11px] font-medium text-[#77837C]">
            {t.result.tnTitle}
          </div>
          <div
            className="mt-1 text-xl font-bold tabular-nums text-[#F4F6F4]"
            title="True Negatives (TN)"
          >
            {matrix.tn}
          </div>
        </div>
      </div>
    </div>
  );
};
