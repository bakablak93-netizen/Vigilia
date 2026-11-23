import React from "react";
import { AlertTriangle, Eye, X } from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { SecurityIntelligenceReport, TransactionInspectorItem } from "../../types/api";

export interface SelectedWeaknessDetail {
  id: string;
  scenarioType: string;
  title: string;
  explanation: string;
  severity: "critical" | "high" | "medium";
}

interface WeaknessDetailModalProps {
  weakness: SelectedWeaknessDetail | null;
  intelligence: SecurityIntelligenceReport | null;
  isBlackBox: boolean;
  hasRiskScores: boolean;
  onClose: () => void;
  onInspectTransaction: (txCode: string) => void;
}

export const WeaknessDetailModal: React.FC<WeaknessDetailModalProps> = ({
  weakness,
  intelligence,
  isBlackBox,
  hasRiskScores,
  onClose,
  onInspectTransaction,
}) => {
  const { t, scenarioLabel, ruleLabel, formatKzt } = useLab();

  if (!weakness || !intelligence) return null;

  const scenRow = intelligence.weakness_explorer.find(
    (w) => w.scenario_type === weakness.scenarioType
  );
  const samples: TransactionInspectorItem[] =
    intelligence.transaction_inspector_samples
      .filter((s) => s.scenario_type === weakness.scenarioType)
      .slice(0, 5);

  const realReasons = Array.from(
    new Set(
      samples.flatMap((s) =>
        (s.reason_codes && s.reason_codes.length > 0
          ? s.reason_codes
          : s.triggered_rules.map((tr) => tr.rule)
        ).filter(Boolean)
      )
    )
  );

  const totalTx = scenRow?.total_transactions ?? 0;
  const actualRisks = scenRow?.actual_risk_events ?? 0;
  const tp = scenRow?.detected_risks ?? 0;
  const fn = scenRow?.missed_risks ?? 0;
  const fp = scenRow?.false_positives ?? 0;
  const tn = Math.max(0, totalTx - actualRisks - fp);

  const matchingRecs = intelligence.analyst.recommendations.filter(
    (r) =>
      r.target_rule === weakness.scenarioType ||
      r.target_rule.includes(weakness.scenarioType) ||
      r.issue_category.includes(weakness.scenarioType)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-xs" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[88vh] flex flex-col lab-card overflow-hidden">
        <div className="px-6 py-4 bg-[#101211]/65 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="h-4 w-4 text-[#E3AD56] shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-[#77837C]">
                {t.v33.weaknessDetailTitle} · {scenarioLabel(weakness.scenarioType)}
              </div>
              <h2 className="text-base font-bold text-[#F4F6F4] truncate">
                {weakness.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.settings.close}
            className="p-1.5 rounded-xl bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          <p className="text-sm text-[#A1ABA4] leading-relaxed">{weakness.explanation}</p>

          {isBlackBox && (
            <div className="rounded-xl bg-[#E3AD56]/10 px-4 py-2.5 text-[#E3AD56]">
              {t.v33.weaknessBlackBoxCaveat}
            </div>
          )}

          {/* Metrics Grid */}
          {scenRow && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
              <div className="p-3 rounded-xl bg-[#202522]">
                <div className="text-[#77837C]">{t.v33.weaknessOpsCount}</div>
                <div className="text-base font-bold text-[#F4F6F4] mt-0.5">{totalTx}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#202522]">
                <div className="text-[#77837C]">{t.v33.weaknessRiskCount}</div>
                <div className="text-base font-bold text-[#F4F6F4] mt-0.5">{actualRisks}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#202522]">
                <div className="text-[#77837C]">Recall / Precision</div>
                <div className="text-sm font-bold text-[#43D17A] mt-1">
                  {actualRisks > 0 ? `${(scenRow.recall * 100).toFixed(1)}%` : "—"} /{" "}
                  {scenRow.precision_defined && scenRow.precision !== null
                    ? `${(scenRow.precision * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#202522]">
                <div className="text-[#77837C]">{t.v33.weaknessAvgScore}</div>
                <div className="text-base font-bold text-[#F4F6F4] mt-0.5">
                  {hasRiskScores ? scenRow.avg_risk_score.toFixed(1) : "—"}
                </div>
              </div>
            </div>
          )}

          {/* TP / FP / FN / TN */}
          <div className="grid grid-cols-4 gap-2 text-center tabular-nums">
            <div className="rounded-xl bg-[#43D17A]/10 py-2.5">
              <div className="text-[10px] text-[#43D17A]">TP</div>
              <div className="text-base font-bold text-[#43D17A]">{tp}</div>
            </div>
            <div className="rounded-xl bg-[#F16B6B]/10 py-2.5">
              <div className="text-[10px] text-[#F16B6B]">FP</div>
              <div className="text-base font-bold text-[#F16B6B]">{fp}</div>
            </div>
            <div className="rounded-xl bg-[#E3AD56]/10 py-2.5">
              <div className="text-[10px] text-[#E3AD56]">FN</div>
              <div className="text-base font-bold text-[#E3AD56]">{fn}</div>
            </div>
            <div className="rounded-xl bg-[#202522] py-2.5">
              <div className="text-[10px] text-[#77837C]">TN</div>
              <div className="text-base font-bold text-[#F4F6F4]">{tn}</div>
            </div>
          </div>

          {/* Reason Codes */}
          <div className="space-y-2">
            <div className="font-semibold text-[#F4F6F4]">{t.v33.weaknessReasons}</div>
            {realReasons.length === 0 ? (
              <div className="rounded-xl bg-[#202522] p-3 text-[#77837C]">
                {t.inspector.noRules}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {realReasons.map((code) => (
                  <span
                    key={code}
                    className="px-2.5 py-1 rounded-lg bg-[#202522] text-[#A1ABA4] font-mono"
                  >
                    {ruleLabel(code)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Suspected Causes */}
          {scenRow && scenRow.typical_error_causes.length > 0 && (
            <div className="space-y-2">
              <div className="font-semibold text-[#F4F6F4]">
                {t.v33.weaknessSuspectedCauses}
              </div>
              <ul className="space-y-1.5 text-[#A1ABA4]">
                {scenRow.typical_error_causes.map((cause, idx) => (
                  <li key={idx} className="rounded-xl bg-[#202522] px-3.5 py-2">
                    {cause}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended Checks */}
          {matchingRecs.length > 0 && (
            <div className="space-y-2">
              <div className="font-semibold text-[#F4F6F4]">{t.v33.weaknessRecCheck}</div>
              <div className="space-y-1.5">
                {matchingRecs.map((rec, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl bg-[#202522] px-3.5 py-2.5 text-[#A1ABA4]"
                  >
                    <div className="font-semibold text-[#43D17A]">{rec.title}</div>
                    <div className="mt-0.5">{rec.expected_impact || rec.explanation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2-5 Sample Transactions */}
          {samples.length > 0 && (
            <div className="space-y-2">
              <div className="font-semibold text-[#F4F6F4]">{t.v33.weaknessSamples}</div>
              <div className="flex flex-wrap gap-2">
                {samples.map((smp) => (
                  <button
                    key={smp.transaction_code}
                    type="button"
                    onClick={() => onInspectTransaction(smp.transaction_code)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#202522] hover:bg-[#262C28] text-[#F4F6F4] font-mono transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5 text-[#43D17A]" />
                    <span>{smp.transaction_code}</span>
                    <span className="text-[#77837C]">({formatKzt(smp.amount_kzt)})</span>
                    <span className="text-[10px] text-[#E3AD56]">{smp.outcome}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
