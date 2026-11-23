import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type {
  EvolutionRun,
  ExperimentSummary,
  ExternalEvolutionRun,
  ExternalParamDetail,
  ParamChange,
} from "../../types/api";
import {
  type DefenseMechanismKey,
  getParamSemanticExplanation,
} from "../../utils/paramSemantics";
import { StepProgressChecklist } from "./StepProgressChecklist";

interface StepConfigureViewProps {
  experiment: ExperimentSummary;
  evolutionRun: EvolutionRun | null;
  externalEvolution: ExternalEvolutionRun | null;
  analyzing: boolean;
  validating: boolean;
  selectedCandidateKey: string | null;
  onSelectCandidateKey: (key: string) => void;
  onValidate: () => void;
  onAnalyzeManual: () => void;
  onCancelImprovement: () => void;
  retestFormat: "csv" | "json";
  onChangeRetestFormat: (fmt: "csv" | "json") => void;
  retestVersionLabel: string;
  onChangeRetestVersionLabel: (val: string) => void;
  retestContent: string;
  onChangeRetestContent: (val: string) => void;
  onRetestBlackBox: (useUpdatedProfile?: boolean) => void;
  retesting: boolean;
}

interface GroupedDecisionCard {
  mechanism: DefenseMechanismKey;
  title: string;
  summaryDelta: string;
  description: string;
  paramCount: number;
}

export const StepConfigureView: React.FC<StepConfigureViewProps> = ({
  experiment,
  evolutionRun,
  externalEvolution,
  analyzing,
  validating,
  selectedCandidateKey,
  onSelectCandidateKey,
  onValidate,
  onAnalyzeManual,
  onCancelImprovement,
  retestFormat,
  onChangeRetestFormat,
  retestVersionLabel,
  onChangeRetestVersionLabel,
  retestContent,
  onChangeRetestContent,
  onRetestBlackBox,
  retesting,
}) => {
  const { t, lang, ruleLabel, scenarioLabel } = useLab();
  const [showTechTable, setShowTechTable] = useState(false);

  const isBlackBox =
    externalEvolution?.mode === "black_box_manual" ||
    (experiment.diagnostic_mode === "black_box" && !evolutionRun);

  const activeCandKey = useMemo(() => {
    if (selectedCandidateKey) return selectedCandidateKey;
    if (evolutionRun) return evolutionRun.selected_candidate_key || "D";
    if (externalEvolution) {
      return externalEvolution.comparison_json?.selected_candidate_key || "";
    }
    return "";
  }, [selectedCandidateKey, evolutionRun, externalEvolution]);

  const changedRows = useMemo(() => {
    if (evolutionRun) {
      const selectedCand = evolutionRun.candidates_json?.find(
        (c) => c.key === activeCandKey
      );
      const paramsList: ParamChange[] =
        selectedCand?.changed_params || evolutionRun.changed_params_json || [];

      return paramsList.map((p, idx) => {
        const sem = getParamSemanticExplanation(
          p.param,
          p.rule,
          p.old_value,
          p.new_value,
          lang,
          {
            mechanism: p.mechanism,
            purpose: p.purpose,
            expectedEffect: p.expected_effect,
            sideEffect: p.side_effects,
          }
        );
        return {
          rowKey: `${p.rule}-${p.param}-${idx}`,
          ruleName:
            p.rule === "decision_threshold" ? "Decision Threshold" : ruleLabel(p.rule),
          param: p.param,
          humanName: sem.humanName,
          mechanism: sem.mechanism,
          oldVal: String(p.old_value ?? "—"),
          newVal: String(p.new_value ?? "—"),
          hypothesis: sem.hypothesis,
        };
      });
    }

    if (externalEvolution && externalEvolution.mode === "configurable_white_box") {
      const baseSnap = externalEvolution.baseline_config_snapshot_json || {};
      const chosen =
        externalEvolution.candidates_json?.find((c) => c.key === activeCandKey) || null;
      const proposed = chosen?.override || externalEvolution.proposed_config_json || {};
      const detailsMap: Record<string, ExternalParamDetail> = {};
      for (const pd of chosen?.param_details ||
        externalEvolution.comparison_json?.param_details ||
        []) {
        detailsMap[pd.param] = pd;
      }

      return Object.entries(proposed).map(([key, afterVal], idx) => {
        const pd = detailsMap[key];
        const oldRaw = pd ? pd.old_value : baseSnap[key];
        const sem = getParamSemanticExplanation(
          key,
          pd?.mechanism || key,
          oldRaw,
          afterVal,
          lang
        );
        return {
          rowKey: `${key}-${idx}`,
          ruleName: externalEvolution.baseline_label || "External Engine",
          param: key,
          humanName: sem.humanName,
          mechanism: sem.mechanism,
          oldVal: oldRaw !== undefined && oldRaw !== null ? String(oldRaw) : "—",
          newVal: String(afterVal),
          hypothesis: sem.hypothesis,
        };
      });
    }

    return [];
  }, [evolutionRun, externalEvolution, activeCandKey, lang, ruleLabel]);

  const decisionCards: GroupedDecisionCard[] = useMemo(() => {
    const labelByMech: Record<DefenseMechanismKey, string> = {
      decision_threshold: t.v34.mechThreshold,
      new_recipient_risk: t.v34.mechNewRecipient,
      duplicate_payment: t.v34.mechDuplicate,
      unusual_amount: t.v34.mechUnusualAmount,
      suspicious_sequence: t.v34.mechSequence,
      structuring_smurfing: scenarioLabel("structuring_smurfing"),
      account_takeover_ato: scenarioLabel("account_takeover_ato"),
      black_box_routing: t.v4h.blackBoxScopeBadge,
    };

    const grouped = new Map<DefenseMechanismKey, typeof changedRows>();
    for (const row of changedRows) {
      const list = grouped.get(row.mechanism) || [];
      list.push(row);
      grouped.set(row.mechanism, list);
    }

    const cards: GroupedDecisionCard[] = [];
    for (const [mech, rows] of grouped.entries()) {
      const primary = rows[0];
      cards.push({
        mechanism: mech,
        title: labelByMech[mech] || primary.humanName,
        summaryDelta: `${primary.oldVal} → ${primary.newVal}`,
        description: primary.hypothesis,
        paramCount: rows.length,
      });
    }
    return cards.slice(0, 4);
  }, [changedRows, scenarioLabel, t.v34, t.v4h]);

  if (analyzing) {
    return (
      <StepProgressChecklist
        title={t.v4h.stageAnalyzeLabel}
        steps={[t.v5.checklistAnalyze1, t.v5.checklistAnalyze2, t.v5.checklistAnalyze3]}
        cancelLabel={t.v4h.btnCancelImprovement}
        onCancel={onCancelImprovement}
      />
    );
  }

  if (validating) {
    return (
      <StepProgressChecklist
        title={t.v4h.stageVerifyLabel}
        steps={[t.v5.checklistVerify1, t.v5.checklistVerify2, t.v5.checklistVerify3]}
      />
    );
  }

  if (!evolutionRun && !externalEvolution) {
    return (
      <div className="v4-surface p-8 text-center space-y-4 max-w-xl mx-auto v5-step-enter">
        <p className="text-base text-[#94A3B8]">{t.v4h.stageADesc}</p>
        <button
          type="button"
          onClick={onAnalyzeManual}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Sparkles className="h-4 w-4" />
          <span>{t.v4h.btnImproveDefense}</span>
        </button>
      </div>
    );
  }

  // Black-Box View
  if (isBlackBox && externalEvolution) {
    const bbPolicy = externalEvolution.comparison_json?.black_box_policy;
    const bbCands = externalEvolution.candidates_json || [];
    const canTuneThreshold = Boolean(
      bbPolicy?.has_risk_scores && bbCands.length > 0 && experiment.adapter_type === "external_api"
    );
    const selBbCand = bbCands.find((c) => c.key === activeCandKey) || bbCands[0] || null;
    const blockCutoff = selBbCand?.override?.block_threshold ?? bbPolicy?.recommended_block_threshold;
    const reviewCutoff = selBbCand?.override?.review_threshold ?? bbPolicy?.recommended_review_threshold;

    return (
      <div className="space-y-6 v5-step-enter">
        <section className="v4-surface p-6 sm:p-8 space-y-5">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F59E0B]/15 text-[#F59E0B]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t.v4h.blackBoxScopeBadge}
            </span>
            <h2 className="text-2xl font-bold text-[#F1F5F9] mt-2">
              {t.v34.blackboxTitle}
            </h2>
          </div>
          <p className="text-[15px] text-[#94A3B8] leading-relaxed">
            {t.v4h.blackBoxScopeNote}
          </p>

          {canTuneThreshold && selBbCand && (
            <div className="v4-surface-inset p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base font-bold text-[#F1F5F9]">{selBbCand.name}</span>
                <span className="font-mono text-sm font-semibold text-[#22C55E]">
                  Block ≥ {String(blockCutoff ?? "—")} · Review ≥ {String(reviewCutoff ?? "—")}
                </span>
              </div>

              {bbCands.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {bbCands.map((cand) => (
                    <button
                      key={cand.key}
                      type="button"
                      onClick={() => onSelectCandidateKey(cand.key)}
                      className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                        cand.key === selBbCand.key
                          ? "bg-[#16A34A] text-white"
                          : "bg-[#161E1B] text-[#94A3B8] hover:text-[#F1F5F9]"
                      }`}
                    >
                      {cand.key}: {cand.name}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={onValidate}
                className="btn-primary inline-flex items-center gap-2.5"
              >
                <ShieldCheck className="h-5 w-5" />
                <span>{t.v4h.btnVerifyExternalThreshold}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {externalEvolution.recommendations_json.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {externalEvolution.recommendations_json.slice(0, 4).map((rec, idx) => (
                <div key={`${rec.title}-${idx}`} className="v4-surface-inset p-4 space-y-1.5">
                  <div className="font-semibold text-[#F1F5F9] text-[15px]">{rec.title}</div>
                  <p className="text-sm text-[#94A3B8]">{rec.explanation}</p>
                </div>
              ))}
            </div>
          )}

          {experiment.adapter_type === "external_api" && (
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={retesting}
                onClick={() => onRetestBlackBox(true)}
                className="btn-subtle inline-flex items-center gap-2"
              >
                {retesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                <span>{t.ext.retestRunUpdatedProfile}</span>
              </button>
              <a href={api.exportUrl(experiment.id, "html")} target="_blank" rel="noreferrer" className="btn-subtle">
                {t.v5.downloadHtmlReport}
              </a>
            </div>
          )}

          {experiment.adapter_type === "imported" && (
            <div className="v4-surface-inset p-4 space-y-3">
              <div className="font-semibold text-[#F1F5F9] text-sm">{t.ext.retestUploadTitle}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <select
                  value={retestFormat}
                  onChange={(e) => onChangeRetestFormat(e.target.value as "csv" | "json")}
                  className="lab-input"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
                <input
                  type="text"
                  value={retestVersionLabel}
                  onChange={(e) => onChangeRetestVersionLabel(e.target.value)}
                  placeholder="Updated v2"
                  className="lab-input"
                />
                <label className="btn-subtle cursor-pointer justify-center">
                  <Upload className="h-4 w-4 text-[#22C55E]" />
                  <span>{t.ext.importUploadBtn}</span>
                  <input
                    type="file"
                    accept=".csv,.json,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        onChangeRetestContent(await f.text());
                        onChangeRetestFormat(f.name.toLowerCase().endsWith(".json") ? "json" : "csv");
                      }
                    }}
                  />
                </label>
              </div>
              <textarea
                rows={3}
                value={retestContent}
                onChange={(e) => onChangeRetestContent(e.target.value)}
                placeholder="transaction_id,predicted_label,risk_score,reason_codes"
                className="lab-input font-mono text-sm"
              />
              <button
                type="button"
                disabled={retesting}
                onClick={() => onRetestBlackBox(false)}
                className="btn-primary inline-flex items-center gap-2"
              >
                {retesting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{t.ext.retestSubmitBtn}</span>
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  // White-Box View: Borderless Decision Cards + Collapsible Technical Table
  const candidates =
    evolutionRun?.candidates_json || externalEvolution?.candidates_json || [];

  return (
    <div className="space-y-6 v5-step-enter">
      <section className="v4-surface p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#16A34A]/15 text-[#22C55E]">
              {t.v4h.whiteBoxScopeBadge}
            </span>
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-[#F1F5F9]">
              {t.v4h.whatProposePlain}
            </h1>
            <p className="text-[15px] text-[#94A3B8] max-w-2xl">
              {t.v4h.verifyGuardText}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelImprovement}
            className="btn-subtle px-4 py-2 text-sm"
          >
            {t.v4h.btnCancelImprovement}
          </button>
        </div>

        {/* Clean Borderless Decision Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 v4-stagger">
          {decisionCards.map((card) => (
            <div
              key={card.mechanism}
              className="dp-elevated p-5 flex flex-col gap-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-lg font-bold text-[#F1F5F9] leading-snug">
                  {card.title}
                </div>
                <span className="font-mono text-base font-bold text-[#22C55E] bg-[#16A34A]/15 px-3 py-1 rounded-xl whitespace-nowrap shrink-0 tabular-nums">
                  {card.summaryDelta}
                </span>
              </div>
              <p className="text-[15px] text-[#94A3B8] leading-relaxed">
                {card.description}
              </p>
              {card.paramCount > 1 && (
                <div className="text-sm font-medium text-[#64748B]">
                  +{card.paramCount - 1} {t.v34.colParam.toLowerCase()}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bottom Action Row: Main CTA + Toggle Technical Parameters */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3">
          <button
            type="button"
            onClick={onValidate}
            className="btn-primary inline-flex items-center gap-2.5"
          >
            <ShieldCheck className="h-5 w-5" />
            <span>{t.v5.btnApplyAndVerify}</span>
            <ArrowRight className="h-4 w-4" />
          </button>

          {changedRows.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTechTable((v) => !v)}
              className="text-sm font-semibold text-[#94A3B8] hover:text-[#F1F5F9] inline-flex items-center gap-1.5"
            >
              <span>
                {showTechTable
                  ? t.v5.hideAllParams
                  : `${t.v5.showAllParamsPrefix} ${changedRows.length} ${t.v5.showAllParamsSuffix}`}
              </span>
              {showTechTable ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </section>

      {/* Collapsible Full Technical Parameters & Candidate Selector */}
      <div className={`v4-accordion-grid ${showTechTable ? "is-open" : ""}`}>
        <div className="v4-accordion-inner space-y-5">
          {candidates.length > 1 && (
            <section className="v4-surface p-5 space-y-3">
              <div className="text-sm font-bold text-[#F1F5F9]">
                {t.v34.candidatesCompared}
              </div>
              <div className="flex flex-wrap gap-2">
                {candidates.map((cand) => {
                  const isSel = cand.key === activeCandKey;
                  return (
                    <button
                      key={cand.key}
                      type="button"
                      onClick={() => onSelectCandidateKey(cand.key)}
                      className={`px-3.5 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2 transition-all ${
                        isSel
                          ? "bg-[#16A34A] text-white"
                          : "bg-[#161E1B] text-[#94A3B8] hover:text-[#F1F5F9]"
                      }`}
                    >
                      {isSel && <CheckCircle2 className="h-4 w-4" />}
                      <span>
                        {cand.key}: {cand.name} (Recall{" "}
                        {(cand.validation_metrics.recall * 100).toFixed(1)}%)
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="v4-surface overflow-hidden">
            <div className="px-6 py-4 bg-[#161E1B]/80 font-semibold text-[#F1F5F9] text-base">
              {t.v4h.concreteChangesTitle} ({changedRows.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="text-[#94A3B8] text-sm bg-[#0B100E]/60">
                    <th className="py-3 px-6 font-medium">{t.v34.colParam}</th>
                    <th className="py-3 px-4 font-medium">{t.v34.colBeforeAfter}</th>
                    <th className="py-3 px-6 font-medium">{t.v34.colWhy}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {changedRows.map((row) => (
                    <tr key={row.rowKey} className="hover:bg-[#161E1B]/60 transition-colors">
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-[#F1F5F9]">{row.humanName}</div>
                        <div className="text-xs font-mono text-[#64748B]">{row.param}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-base font-bold tabular-nums whitespace-nowrap">
                        <span className="text-[#94A3B8]">{row.oldVal}</span>
                        <span className="mx-2 text-[#22C55E]">→</span>
                        <span className="text-[#22C55E]">{row.newVal}</span>
                      </td>
                      <td className="py-3.5 px-6 text-[#94A3B8]">{row.hypothesis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
