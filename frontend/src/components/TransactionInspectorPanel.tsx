import React from "react";
import { CheckCircle2, ShieldAlert, X, XCircle } from "lucide-react";
import { useLab } from "../context/LabContext";
import type { TransactionInspectorItem } from "../types/api";

interface Props {
  item: TransactionInspectorItem | null;
  onClose?: () => void;
  engineName?: string;
  defenseVersion?: string;
}

const outcomeTone: Record<string, string> = {
  TP: "bg-[#43D17A]/15 text-[#43D17A]",
  FP: "bg-[#F16B6B]/15 text-[#F16B6B]",
  FN: "bg-[#E3AD56]/15 text-[#E3AD56]",
  TN: "bg-[#202522] text-[#A1ABA4]",
};

export const TransactionInspectorPanel: React.FC<Props> = ({
  item,
  onClose,
  engineName,
  defenseVersion,
}) => {
  const { t, scenarioLabel, ruleLabel, formatKzt } = useLab();

  if (!item) return null;

  const badgeCls = outcomeTone[item.outcome] || outcomeTone.TN;
  const outcomeTitle =
    (t.inspector.outcomes as Record<string, string>)[item.outcome] || item.outcome;
  const hasScore =
    item.risk_score !== null &&
    item.risk_score !== undefined &&
    item.score_available !== false;
  const reasonCodes =
    item.reason_codes && item.reason_codes.length > 0
      ? item.reason_codes
      : item.triggered_rules.map((tr) => tr.rule);

  return (
    <div className="rounded-2xl bg-[#202522] p-5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-[#43D17A] shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-[#F4F6F4]">
                {item.transaction_code}
              </span>
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${badgeCls}`}
                title={item.outcome}
              >
                {item.outcome} · {outcomeTitle}
              </span>
            </div>
            <div className="text-xs text-[#A1ABA4] mt-0.5">
              {scenarioLabel(item.scenario_type)} · {item.split_name} ·{" "}
              {new Date(item.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="lab-btn-secondary py-1 px-2.5 text-xs bg-[#171A18]"
          >
            <X className="h-3.5 w-3.5" />
            <span>{t.settings.close}</span>
          </button>
        )}
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <div className="p-3 rounded-xl bg-[#171A18]">
          <div className="text-[#77837C]">{t.inspector.customer}</div>
          <div className="font-mono font-semibold text-[#F4F6F4] mt-0.5">
            {item.customer_code}
          </div>
          <div className="text-[10px] text-[#77837C]">{item.customer_segment}</div>
        </div>
        <div className="p-3 rounded-xl bg-[#171A18]">
          <div className="text-[#77837C]">{t.inspector.recipient}</div>
          <div className="font-mono font-semibold text-[#F4F6F4] mt-0.5">
            {item.recipient_code}
          </div>
          <div className="text-[10px] text-[#A1ABA4]">
            {item.is_new_recipient ? t.inspector.newPayee : t.inspector.knownPayee}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#171A18]">
          <div className="text-[#77837C]">{t.inspector.amount}</div>
          <div className="font-bold tabular-nums text-sm mt-0.5 text-[#F4F6F4]">
            {formatKzt(item.amount_kzt)}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#171A18]">
          <div className="text-[#77837C]">{t.inspector.channel}</div>
          <div className="font-medium text-[#F4F6F4] mt-0.5">{item.channel}</div>
          <div className="text-[10px] text-[#77837C]">{item.transaction_type}</div>
        </div>
        <div className="p-3 rounded-xl bg-[#171A18]">
          <div className="text-[#77837C]">{t.inspector.score}</div>
          {hasScore ? (
            <>
              <div className="font-bold tabular-nums text-sm mt-0.5 text-[#43D17A]">
                {Number(item.risk_score).toFixed(1)} / 100
              </div>
              <div className="text-[10px] text-[#77837C]">
                {t.inspector.threshold}: {item.decision_threshold} (
                {item.gap_to_threshold >= 0 ? "+" : ""}
                {item.gap_to_threshold.toFixed(1)})
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[#A1ABA4] mt-1">
              {t.v33.inspectorScoreUnavailable}
            </div>
          )}
        </div>
        <div className="p-3 rounded-xl bg-[#171A18]">
          <div className="text-[#77837C]">{t.inspector.truth}</div>
          <div className="font-mono font-semibold mt-0.5 flex items-center gap-1.5 text-[#F4F6F4]">
            {item.predicted_label === item.ground_truth_label ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#43D17A]" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-[#F16B6B]" />
            )}
            <span>
              {t.inspector.pred}={item.predicted_label} · {t.inspector.gt}=
              {item.ground_truth_label}
            </span>
          </div>
        </div>
      </div>

      {/* Engine & Config attribution */}
      {(item.engine_name || engineName || item.defense_version || defenseVersion) && (
        <div className="flex flex-wrap gap-4 text-[11px] text-[#A1ABA4]">
          <span>
            {t.v33.inspectorEngineTested}:{" "}
            <strong className="text-[#F4F6F4]">
              {item.engine_name || engineName}
            </strong>
          </span>
          {(item.defense_version || defenseVersion) && (
            <span>
              {t.v33.inspectorConfigUsed}:{" "}
              <strong className="font-mono text-[#F4F6F4]">
                {item.defense_version || defenseVersion}
              </strong>
            </span>
          )}
        </div>
      )}

      {/* Triggered Rules / Reason Codes & Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <div className="font-semibold text-[#F4F6F4]">
            {t.inspector.rulesTitle} ({reasonCodes.length})
          </div>
          {item.triggered_rules.length === 0 && reasonCodes.length === 0 ? (
            <div className="p-3 rounded-xl bg-[#171A18] text-[#77837C]">
              {t.inspector.noRules}
            </div>
          ) : (
            <div className="space-y-1.5">
              {item.triggered_rules.map((tr, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl bg-[#171A18] px-3 py-2"
                >
                  <span className="font-semibold text-[#F4F6F4]">
                    {ruleLabel(tr.rule)}
                  </span>
                  {Number(tr.contribution) > 0 && (
                    <span className="font-mono font-bold text-[#43D17A]">
                      +{Number(tr.contribution).toFixed(1)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="font-semibold text-[#F4F6F4]">
            {t.inspector.explanationTitle}
          </div>
          <div className="p-3 rounded-xl bg-[#171A18] leading-relaxed text-[#A1ABA4]">
            {item.explanation}
          </div>
        </div>
      </div>
    </div>
  );
};
