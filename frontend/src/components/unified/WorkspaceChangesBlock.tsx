import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileJson,
  FileSpreadsheet,
  Info,
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
  RemainingWeaknessItem,
  RuleConfig,
} from "../../types/api";
import {
  type DefenseMechanismKey,
  getParamSemanticExplanation,
} from "../../utils/paramSemantics";

interface WorkspaceChangesBlockProps {
  experiment: ExperimentSummary;
  evolutionRun: EvolutionRun | null;
  externalEvolution: ExternalEvolutionRun | null;
  analyzing: boolean;
  validating: boolean;
  validatingPhase: "eval_base" | "eval_cand" | "diffing" | null;
  selectedCandidateKey: string | null;
  onSelectCandidateKey: (key: string) => void;
  onValidate: () => void;
  onAnalyzeManual?: () => void;
  onCancelImprovement?: () => void;
  onInspectTransaction: (txCode: string) => void;
  retestFormat: "csv" | "json";
  onChangeRetestFormat: (fmt: "csv" | "json") => void;
  retestVersionLabel: string;
  onChangeRetestVersionLabel: (val: string) => void;
  retestContent: string;
  onChangeRetestContent: (val: string) => void;
  onRetestBlackBox: (useUpdatedProfile?: boolean) => void;
  retesting: boolean;
}

interface UnifiedChangeRow {
  rowKey: string;
  ruleName: string;
  param: string;
  humanName: string;
  mechanism: DefenseMechanismKey;
  oldVal: string;
  newVal: string;
  purpose: string;
  hypothesis: string;
  linkedWeakness: string | null;
  sideEffect: string;
  attributionMode: string;
  ablationSideEffect?: string;
}

export const WorkspaceChangesBlock: React.FC<WorkspaceChangesBlockProps> = ({
  experiment,
  evolutionRun,
  externalEvolution,
  analyzing,
  validating,
  validatingPhase,
  selectedCandidateKey,
  onSelectCandidateKey,
  onValidate,
  onAnalyzeManual,
  onCancelImprovement,
  onInspectTransaction,
  retestFormat,
  onChangeRetestFormat,
  retestVersionLabel,
  onChangeRetestVersionLabel,
  retestContent,
  onChangeRetestContent,
  onRetestBlackBox,
  retesting,
}) => {
  const { t, lang, ruleLabel, scenarioLabel, formatKzt } = useLab();
  const [showSelectionDetails, setShowSelectionDetails] = useState(false);
  const [showFullConfig, setShowFullConfig] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [expandedParamKeys, setExpandedParamKeys] = useState<string[]>([]);

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

  const valWeaknessesByScenario = useMemo(() => {
    const map: Record<string, { fn: number; act: number; fp: number }> = {};
    const list = experiment.scenario_metrics_json || [];
    for (const s of list) {
      map[s.scenario_type] = {
        fn: s.false_negatives,
        act: s.actual_risk_events,
        fp: s.false_positives,
      };
    }
    return map;
  }, [experiment.scenario_metrics_json]);

  const changedRows: UnifiedChangeRow[] = useMemo(() => {
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
        const linked =
          p.linked_weakness ||
          (sem.mechanism !== "decision_threshold" &&
          valWeaknessesByScenario[sem.mechanism]?.fn > 0
            ? `${scenarioLabel(sem.mechanism)}: FN ${valWeaknessesByScenario[sem.mechanism].fn}/${valWeaknessesByScenario[sem.mechanism].act}`
            : null);

        return {
          rowKey: `${p.rule}-${p.param}-${idx}`,
          ruleName:
            p.rule === "decision_threshold" ? "Decision Threshold" : ruleLabel(p.rule),
          param: p.param,
          humanName: sem.humanName,
          mechanism: sem.mechanism,
          oldVal: String(p.old_value ?? "—"),
          newVal: String(p.new_value ?? "—"),
          purpose: sem.purpose,
          hypothesis: sem.hypothesis,
          linkedWeakness: linked,
          sideEffect: sem.sideEffect,
          attributionMode:
            p.attribution_mode ||
            (p.after_metrics ? "isolated_single_rule_ablation" : "multi_param_joint"),
          ablationSideEffect: p.after_metrics ? p.side_effects : undefined,
        };
      });
    }

    if (externalEvolution && externalEvolution.mode === "configurable_white_box") {
      const baseSnap = externalEvolution.baseline_config_snapshot_json || {};
      const chosen =
        externalEvolution.candidates_json?.find((c) => c.key === activeCandKey) ||
        null;
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
          lang,
          pd
            ? {
                mechanism: pd.mechanism,
                purpose: pd.purpose,
                expectedEffect: pd.expected_effect,
                sideEffect: pd.side_effect,
              }
            : undefined
        );
        let linkedStr: string | null = null;
        if (pd?.linked_weakness) {
          const [scKey, detailText] = pd.linked_weakness.split(": ");
          linkedStr = `${scenarioLabel(scKey)}: ${detailText || ""}`;
        }

        return {
          rowKey: `${key}-${idx}`,
          ruleName: externalEvolution.baseline_label || "External Engine",
          param: key,
          humanName: sem.humanName,
          mechanism: sem.mechanism,
          oldVal: oldRaw !== undefined && oldRaw !== null ? String(oldRaw) : "—",
          newVal: String(afterVal),
          purpose: sem.purpose,
          hypothesis: sem.hypothesis,
          linkedWeakness: linkedStr,
          sideEffect: sem.sideEffect,
          attributionMode:
            pd?.attribution_mode ||
            (Object.keys(proposed).length > 1 ? "multi_param_joint" : "single_param"),
        };
      });
    }

    return [];
  }, [
    evolutionRun,
    externalEvolution,
    activeCandKey,
    lang,
    ruleLabel,
    scenarioLabel,
    valWeaknessesByScenario,
  ]);

  const affectedMechanisms = useMemo(() => {
    const labelByMech: Record<DefenseMechanismKey, string> = {
      duplicate_payment: t.v34.mechDuplicate,
      new_recipient_risk: t.v34.mechNewRecipient,
      unusual_amount: t.v34.mechUnusualAmount,
      suspicious_sequence: t.v34.mechSequence,
      structuring_smurfing: scenarioLabel("structuring_smurfing"),
      account_takeover_ato: scenarioLabel("account_takeover_ato"),
      black_box_routing: t.v4h.blackBoxScopeBadge,
      decision_threshold: t.v34.mechThreshold,
    };
    const seen = new Set<DefenseMechanismKey>();
    const list: Array<{ key: DefenseMechanismKey; label: string; count: number }> = [];
    for (const row of changedRows) {
      if (!seen.has(row.mechanism)) {
        seen.add(row.mechanism);
        list.push({
          key: row.mechanism,
          label: labelByMech[row.mechanism] || row.mechanism,
          count: changedRows.filter((r) => r.mechanism === row.mechanism).length,
        });
      }
    }
    return list;
  }, [changedRows, scenarioLabel, t.v34, t.v4h]);

  const toggleParamExpand = (rowKey: string) => {
    setExpandedParamKeys((prev) =>
      prev.includes(rowKey) ? prev.filter((x) => x !== rowKey) : [...prev, rowKey]
    );
  };

  const isCompletedValidation =
    (evolutionRun && evolutionRun.status === "completed") ||
    (externalEvolution &&
      externalEvolution.mode === "configurable_white_box" &&
      externalEvolution.status === "completed");

  const activeCandInfo = useMemo(() => {
    if (evolutionRun) {
      return (
        evolutionRun.candidates_json?.find((c) => c.key === activeCandKey) || null
      );
    }
    if (externalEvolution) {
      return (
        externalEvolution.candidates_json?.find((c) => c.key === activeCandKey) ||
        null
      );
    }
    return null;
  }, [evolutionRun, externalEvolution, activeCandKey]);

  const validationUnfixed: RemainingWeaknessItem[] = useMemo(() => {
    if (activeCandInfo && "validation_unfixed_weaknesses" in activeCandInfo) {
      return activeCandInfo.validation_unfixed_weaknesses || [];
    }
    return (
      evolutionRun?.comparison_json?.validation_unfixed_weaknesses ||
      externalEvolution?.comparison_json?.validation_unfixed_weaknesses ||
      []
    );
  }, [activeCandInfo, evolutionRun, externalEvolution]);

  const guardrails =
    evolutionRun?.comparison_json?.guardrails ||
    evolutionRun?.guardrails_json?.guardrails ||
    externalEvolution?.comparison_json?.guardrails ||
    externalEvolution?.comparison_json?.guardrail_report?.guardrails ||
    null;

  const handleUploadRetestFile = async (file: File) => {
    const text = await file.text();
    onChangeRetestContent(text);
    onChangeRetestFormat(
      file.name.toLowerCase().endsWith(".json") ? "json" : "csv"
    );
  };

  return (
    <section
      id="sec-proposals"
      className="v4-surface p-5 sm:p-7 space-y-5 focus-enter scroll-mt-20"
    >
      {/* Header + Real Lifecycle Step Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#B8C0BC]">
            <span className="font-mono font-bold text-[#E3AD56]">03</span>
            <span className="font-semibold uppercase tracking-wider text-[#B8C0BC]">
              {t.v4h.improvePanelTitle}
            </span>
          </div>
          <h2 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-[#F1F5F9]">
            {isBlackBox ? t.v34.blackboxTitle : t.v4h.improvePanelTitle}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Factual step pills */}
          <div className="v4-surface-inset px-3.5 py-2 rounded-xl flex items-center gap-2.5 text-[13px] font-medium">
            <span className={analyzing ? "text-[#43D17A] font-semibold" : "text-[#43D17A]"}>
              1. {t.v4h.improveStep1}
            </span>
            <span className="text-[#B8C0BC]">→</span>
            <span
              className={
                evolutionRun || externalEvolution
                  ? "text-[#43D17A] font-semibold"
                  : "text-[#B8C0BC]"
              }
            >
              2. {t.v4h.improveStep2}
            </span>
            <span className="text-[#B8C0BC]">→</span>
            <span
              className={
                validating
                  ? "text-[#E3AD56] font-semibold"
                  : isCompletedValidation
                    ? "text-[#43D17A] font-semibold"
                    : "text-[#B8C0BC]"
              }
            >
              3. {t.v4h.improveStep3}
            </span>
            <span className="text-[#B8C0BC]">→</span>
            <span
              className={
                isCompletedValidation
                  ? "text-[#43D17A] font-semibold"
                  : "text-[#B8C0BC]"
              }
            >
              4. {t.v4h.improveStep4}
            </span>
          </div>

          {onCancelImprovement && !isCompletedValidation && !validating && (
            <button
              type="button"
              onClick={onCancelImprovement}
              className="btn-subtle rounded-xl px-4 py-2 text-sm text-[#CBD5E1]"
            >
              {t.v4h.btnCancelImprovement}
            </button>
          )}
        </div>
      </div>

      {/* Retry state if analysis returned no result or errored */}
      {!analyzing && !evolutionRun && !externalEvolution && onAnalyzeManual && (
        <div className="dp-elevated p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-[#CBD5E1] leading-relaxed">
            {isBlackBox ? t.v4h.stageADescBlackBox : t.v4h.stageADesc}
          </p>
          <button
            type="button"
            onClick={onAnalyzeManual}
            className="btn-primary rounded-full px-6 py-3 text-[15px] font-semibold inline-flex items-center gap-2.5"
          >
            <Sparkles className="h-4 w-4" />
            <span>{t.v4h.btnRetryImprovement}</span>
          </button>
        </div>
      )}

      {analyzing && (
        <div className="rounded-2xl bg-[#202522] p-5 space-y-3 text-[15px] text-[#CBD5E1]">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-[#43D17A] shrink-0" />
            <span className="font-medium text-[#F1F5F9]">{t.v34.analyzingSubtitle}</span>
          </div>
          <div className="v4-shimmer-track">
            <div className="v4-shimmer-bar" />
          </div>
        </div>
      )}

      {/* BLACK-BOX MODE (only after analysis has been run) */}
      {!analyzing && isBlackBox && externalEvolution && (() => {
        const bbPolicy = externalEvolution.comparison_json?.black_box_policy;
        const bbCands = externalEvolution.candidates_json || [];
        const canTuneThreshold = Boolean(
          bbPolicy?.has_risk_scores && bbCands.length > 0 && experiment.adapter_type === "external_api"
        );
        const selBbCand =
          bbCands.find((c) => c.key === activeCandKey) || bbCands[0] || null;
        const blockCutoff = selBbCand?.override?.block_threshold ?? bbPolicy?.recommended_block_threshold;
        const reviewCutoff = selBbCand?.override?.review_threshold ?? bbPolicy?.recommended_review_threshold;

        return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#202522] p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E3AD56]">
                <AlertTriangle className="h-4 w-4" />
                <span>{t.v4h.blackBoxScopeBadge}</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#E3AD56]/15 text-[#E3AD56] text-[13px] font-medium">
                {externalEvolution.status === "completed"
                  ? t.v34.sec4Title
                  : t.v34.blackboxStatus}
              </span>
            </div>
            <p className="text-[15px] text-[#CBD5E1] leading-relaxed">
              {t.v4h.blackBoxScopeNote}
            </p>
          </div>

          {canTuneThreshold && selBbCand ? (
            <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-3 border border-[#43D17A]/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[15px] font-semibold text-[#F1F5F9]">
                  {selBbCand.name}
                </div>
                <span className="text-[13px] font-mono text-[#43D17A]">
                  Block ≥ {String(blockCutoff ?? "—")} · Review ≥ {String(reviewCutoff ?? "—")}
                </span>
              </div>

              {bbCands.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {bbCands.map((cand) => {
                    const isSel = cand.key === (selBbCand?.key || "");
                    return (
                      <button
                        key={cand.key}
                        type="button"
                        onClick={() => onSelectCandidateKey(cand.key)}
                        className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                          isSel
                            ? "bg-[#00B846] text-[#F1F5F9]"
                            : "bg-[#202522] text-[#CBD5E1] hover:text-[#F1F5F9]"
                        }`}
                      >
                        {cand.key}: {cand.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {bbPolicy?.routing_counts && (
                <div className="grid grid-cols-3 gap-2.5 text-sm">
                  <div className="rounded-xl bg-[#202522] p-3">
                    <div className="text-[13px] text-[#B8C0BC]">{t.v4h.blackBoxZonesAllow}</div>
                    <div className="text-base font-mono font-bold text-[#F1F5F9] tabular-nums">
                      {bbPolicy.routing_counts.allow}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#202522] p-3">
                    <div className="text-[13px] text-[#E3AD56]">{t.v4h.blackBoxZonesReview}</div>
                    <div className="text-base font-mono font-bold text-[#E3AD56] tabular-nums">
                      {bbPolicy.routing_counts.review}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#202522] p-3">
                    <div className="text-[13px] text-[#43D17A]">{t.v4h.blackBoxZonesBlock}</div>
                    <div className="text-base font-mono font-bold text-[#43D17A] tabular-nums">
                      {bbPolicy.routing_counts.block}
                    </div>
                  </div>
                </div>
              )}

              {validating ? (
                <div className="v4-surface-inset px-4 py-3 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-[#43D17A]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t.v34.validatingStage2}</span>
                  </div>
                  <div className="v4-shimmer-track">
                    <div className="v4-shimmer-bar" />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onValidate}
                  className="btn-primary rounded-full px-6 py-3 text-[15px] font-semibold inline-flex items-center gap-2.5"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t.v4h.btnVerifyExternalThreshold}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#1A1E1C] px-4 py-3 text-[15px] text-[#CBD5E1]">
              {t.v4h.blackBoxNoScoresNote}
            </div>
          )}

          {externalEvolution.recommendations_json.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-[15px] font-semibold text-[#F1F5F9]">
                {t.v4h.blackBoxVendorRecsBadge}
              </div>
              {externalEvolution.recommendations_json.map((rec, idx) => (
                <div
                  key={`${rec.title}-${idx}`}
                  className="rounded-2xl bg-[#1A1E1C] p-4 space-y-1.5 text-[15px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#F1F5F9]">{rec.title}</span>
                    <span className="text-[13px] px-2.5 py-0.5 rounded-full bg-[#202522] text-[#E3AD56]">
                      {t.v34.hypothesisCause}
                    </span>
                  </div>
                  <p className="text-[#CBD5E1] leading-relaxed">{rec.explanation}</p>
                  {rec.expected_impact && (
                    <p className="text-[#43D17A] text-sm pt-0.5">
                      → {rec.expected_impact}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {externalEvolution.comparison_json?.failed_transactions &&
            externalEvolution.comparison_json.failed_transactions.length > 0 && (
              <div className="rounded-2xl bg-[#1A1E1C] p-4 space-y-2.5">
                <div className="text-[15px] font-semibold text-[#CBD5E1]">
                  {t.v34.blackboxConfirmingOps}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {externalEvolution.comparison_json.failed_transactions
                    .slice(0, 6)
                    .map((ft) => (
                      <button
                        key={ft.transaction_code}
                        type="button"
                        onClick={() => onInspectTransaction(ft.transaction_code)}
                        className="rounded-xl bg-[#202522] hover:bg-[#262C28] px-3.5 py-2.5 text-left text-sm transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-semibold text-[#F1F5F9] truncate">
                            {ft.transaction_code}
                          </div>
                          <div className="text-[13px] text-[#B8C0BC] truncate">
                            {scenarioLabel(ft.scenario_type)} · {formatKzt(ft.amount_kzt)}
                          </div>
                        </div>
                        <span
                          className={`text-[13px] font-semibold px-2 py-0.5 rounded ${
                            ft.outcome === "FN"
                              ? "bg-[#E3AD56]/15 text-[#E3AD56]"
                              : "bg-[#F16B6B]/15 text-[#F16B6B]"
                          }`}
                        >
                          {ft.outcome}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}

          <div className="rounded-2xl bg-[#202522] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[15px] font-semibold text-[#F1F5F9]">
                {t.ext.retestUploadTitle}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={api.exportUrl(experiment.id, "json")}
                  className="btn-subtle rounded-xl px-4 py-2 text-sm inline-flex items-center gap-1.5"
                >
                  <FileJson className="h-4 w-4" />
                  <span>JSON</span>
                </a>
                <a
                  href={api.exportUrl(experiment.id, "csv")}
                  className="btn-subtle rounded-xl px-4 py-2 text-sm inline-flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>CSV</span>
                </a>
              </div>
            </div>

            {experiment.adapter_type === "external_api" && externalEvolution && (
              <button
                type="button"
                disabled={retesting}
                onClick={() => onRetestBlackBox(true)}
                className="btn-subtle rounded-xl px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
              >
                {retesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>{t.ext.retestRunUpdatedProfile}</span>
              </button>
            )}

            {externalEvolution && (
              <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <select
                    value={retestFormat}
                    onChange={(e) =>
                      onChangeRetestFormat(e.target.value as "csv" | "json")
                    }
                    className="lab-input px-3.5 py-2.5 text-sm"
                  >
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                  <input
                    type="text"
                    value={retestVersionLabel}
                    onChange={(e) => onChangeRetestVersionLabel(e.target.value)}
                    placeholder="Updated v2"
                    className="lab-input px-3.5 py-2.5 text-sm"
                  />
                  <label className="btn-subtle rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-2 cursor-pointer">
                    <Upload className="h-4 w-4 text-[#43D17A]" />
                    <span>{t.ext.importUploadBtn}</span>
                    <input
                      type="file"
                      accept=".csv,.json,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadRetestFile(f);
                      }}
                    />
                  </label>
                </div>
                <textarea
                  rows={3}
                  value={retestContent}
                  onChange={(e) => onChangeRetestContent(e.target.value)}
                  placeholder="transaction_id,predicted_label,risk_score,reason_codes"
                  className="lab-input w-full px-3.5 py-2.5 text-sm font-mono"
                />
                <button
                  type="button"
                  disabled={retesting}
                  onClick={() => onRetestBlackBox(false)}
                  className="btn-subtle rounded-xl px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
                >
                  {retesting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{t.ext.retestSubmitBtn}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* WHITE-BOX MODE (Internal Engine or Configurable External Engine) */}
      {!analyzing && !isBlackBox && (evolutionRun || externalEvolution) && (() => {
        const visibleChangedRows = showAllChanges
          ? changedRows
          : changedRows.slice(0, 5);
        const extraChangesCount = Math.max(0, changedRows.length - 5);

        return (
        <div className="space-y-5">
          {/* Clean Summary Line: Что VIGILIA предлагает сделать (no nested gray cards-in-cards) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.07]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px]">
              <span className="font-semibold text-[#F1F5F9]">
                {t.v4h.whatProposePlain}:
              </span>
              {affectedMechanisms.map((mech) => (
                <span
                  key={mech.key}
                  className="inline-flex items-center gap-1.5 text-[#CBD5E1]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#43D17A]" />
                  <span>{mech.label}</span>
                  <span className="font-mono text-[13px] font-semibold text-[#43D17A] tabular-nums">
                    ({mech.count})
                  </span>
                </span>
              ))}
            </div>
            <span
              className="text-[13px] font-medium text-[#43D17A]"
              title={t.v4h.whiteBoxScopeNote}
            >
              {t.v4h.whiteBoxScopeBadge}
            </span>
          </div>

          {/* Table of ONLY Changed Parameters (Конкретные изменения — Top 5 by default, clean 55 -> 50 column) */}
          <div className="rounded-2xl bg-[#1A1E1C] overflow-hidden border border-white/[0.06]">
            <div className="px-5 py-3.5 bg-[#202522] flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <span className="text-[15px] font-semibold text-[#F1F5F9]">
                  {t.v4h.concreteChangesTitle} ({changedRows.length})
                </span>
                <p className="text-[13px] text-[#B8C0BC]">
                  {t.v34.paramExpandHint}
                </p>
              </div>
              {evolutionRun && (
                <button
                  type="button"
                  onClick={() => setShowFullConfig((v) => !v)}
                  className="text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9] inline-flex items-center gap-1.5"
                >
                  <span>
                    {showFullConfig
                      ? t.v34.hideFullConfigDiff
                      : t.v34.showFullConfigDiff}
                  </span>
                  {showFullConfig ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>

            {changedRows.length === 0 ? (
              <div className="p-5 text-[15px] text-[#CBD5E1]">
                {t.focus.noProblemsNote}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05] v4-stagger">
                {/* Clean Header Row */}
                <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-5 py-3 text-[13px] font-medium text-[#B8C0BC] bg-[#171B19]">
                  <div className="col-span-4">{t.v34.colParam}</div>
                  <div className="col-span-3">{t.v34.colBeforeAfter}</div>
                  <div className="col-span-4">{t.v34.colWhy}</div>
                  <div className="col-span-1 text-right" />
                </div>

                {visibleChangedRows.map((row) => {
                  const isExpanded = expandedParamKeys.includes(row.rowKey);
                  return (
                    <div key={row.rowKey} className="transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleParamExpand(row.rowKey)}
                        className="w-full text-left px-5 py-4 hover:bg-[#232825] transition-colors grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-center"
                      >
                        <div className="sm:col-span-4 space-y-0.5 min-w-0">
                          <div className="text-[15px] font-semibold text-[#F1F5F9] leading-snug">
                            {row.humanName}
                          </div>
                          <div className="text-[13px] text-[#B8C0BC] truncate">
                            {row.ruleName}
                          </div>
                        </div>

                        <div className="sm:col-span-3 text-base font-semibold font-mono tabular-nums whitespace-nowrap flex items-center gap-2">
                          <span className="text-[#CBD5E1]">{row.oldVal}</span>
                          <span className="text-[#43D17A]">→</span>
                          <span className="text-[#43D17A] font-bold px-2 py-0.5 rounded-lg bg-[#43D17A]/12">
                            {row.newVal}
                          </span>
                        </div>

                        <div className="sm:col-span-4 text-[15px] text-[#CBD5E1] leading-relaxed">
                          <div className="line-clamp-2">{row.hypothesis}</div>
                        </div>

                        <div className="sm:col-span-1 flex justify-end text-[#B8C0BC]">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </div>
                      </button>

                      {/* Smooth CSS Grid 0fr -> 1fr Expandable Technical Detail */}
                      <div className={`v4-accordion-grid ${isExpanded ? "is-open" : ""}`}>
                        <div className="v4-accordion-inner">
                          <div className="px-5 py-4 bg-[#141715] border-t border-white/[0.05] space-y-3">
                            <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
                              <span className="font-mono px-2.5 py-1 rounded-lg bg-[#1D221F] text-[#CBD5E1]">
                                {row.param}
                              </span>
                              {row.linkedWeakness && (
                                <span className="px-2.5 py-1 rounded-full bg-[#E3AD56]/15 text-[#E3AD56] font-medium">
                                  {row.linkedWeakness}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm leading-relaxed">
                              <div className="rounded-xl bg-[#1D221F] p-3.5 space-y-1">
                                <div className="text-[13px] font-semibold text-[#B8C0BC]">
                                  {t.v34.paramPurposeLabel}
                                </div>
                                <p className="text-[#F1F5F9]">{row.purpose}</p>
                              </div>
                              <div className="rounded-xl bg-[#1D221F] p-3.5 space-y-1">
                                <div className="text-[13px] font-semibold text-[#B8C0BC]">
                                  {t.v34.paramHypothesisLabel}
                                </div>
                                <p className="text-[#F1F5F9]">{row.hypothesis}</p>
                              </div>
                              <div className="rounded-xl bg-[#1D221F] p-3.5 space-y-1">
                                <div className="text-[13px] font-semibold text-[#B8C0BC]">
                                  {t.v34.paramLinkedWeaknessLabel}
                                </div>
                                <p className="text-[#E3AD56]">
                                  {row.linkedWeakness || t.v34.paramNoDirectWeakness}
                                </p>
                              </div>
                              <div className="rounded-xl bg-[#1D221F] p-3.5 space-y-1">
                                <div className="text-[13px] font-semibold text-[#B8C0BC]">
                                  {t.v34.paramSideEffectLabel}
                                </div>
                                <p className="text-[#F16B6B]">{row.sideEffect}</p>
                              </div>
                            </div>

                            <div className="rounded-xl bg-[#1D221F] px-3.5 py-2.5 text-[13px] text-[#CBD5E1] flex items-start gap-2">
                              <Info className="h-4 w-4 text-[#43D17A] shrink-0 mt-0.5" />
                              <span>
                                <strong className="text-[#F1F5F9]">
                                  {t.v34.paramAttributionLabel}:{" "}
                                </strong>
                                {row.attributionMode === "isolated_single_rule_ablation"
                                  ? row.ablationSideEffect || t.v34.attrIsolated
                                  : t.v34.attrMultiJoint}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {extraChangesCount > 0 && (
                  <div className="px-5 py-3.5 bg-[#171B19] flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowAllChanges((v) => !v)}
                      className="btn-subtle rounded-xl px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
                    >
                      <span>
                        {showAllChanges
                          ? t.v34.hideExtraChanges
                          : `${t.v34.showMoreChangesPrefix} ${extraChangesCount} ${t.v34.showMoreChangesSuffix}`}
                      </span>
                      {showAllChanges ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {evolutionRun && (
              <div className={`v4-accordion-grid ${showFullConfig ? "is-open" : ""}`}>
                <div className="v4-accordion-inner">
                  <div className="p-4 border-t border-white/[0.06] bg-[#141715] space-y-2.5">
                    <div className="text-[13px] font-semibold text-[#B8C0BC]">
                      {t.v34.showFullConfigDiff} (Threshold:{" "}
                      {evolutionRun.proposed_decision_threshold})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[13px]">
                      {Object.entries(
                        (evolutionRun.proposed_rules_config_json || {}) as Record<
                          string,
                          RuleConfig
                        >
                      ).map(([rk, cfg]) => (
                        <div key={rk} className="rounded-xl bg-[#1D211F] p-3 space-y-1">
                          <div className="font-semibold text-[#F1F5F9]">
                            {ruleLabel(rk)}
                          </div>
                          <div className="text-[#CBD5E1] font-mono tabular-nums">
                            weight: {cfg.weight} · enabled:{" "}
                            {cfg.enabled ? "true" : "false"}
                            {cfg.threshold !== undefined ? ` · thr: ${cfg.threshold}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Why were these changes proposed? (Почему эти изменения и какие есть риски) */}
          <div id="sec-verify" className="dp-elevated p-5 space-y-3.5 scroll-mt-20">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 max-w-2xl">
                <div className="text-[15px] font-semibold text-[#F1F5F9]">
                  {t.v4h.whyChangesTitle}
                </div>
                <p className="text-[15px] text-[#CBD5E1] leading-relaxed">
                  <strong className="text-[#43D17A]">
                    {t.v34.whyCandSelectedPrefix}:{" "}
                    {activeCandInfo?.name ||
                      evolutionRun?.comparison_json?.selected_candidate_name ||
                      externalEvolution?.comparison_json?.selected_candidate_name ||
                      activeCandKey}
                  </strong>{" "}
                  — {t.v34.whyCandRationale}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSelectionDetails((v) => !v)}
                className="btn-subtle rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-1.5 shrink-0"
              >
                <span>
                  {showSelectionDetails
                    ? t.v34.hideSelectionDetails
                    : t.v34.moreSelectionDetails}
                </span>
                {showSelectionDetails ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Compact Validation Snapshot: Unfixed Weaknesses + Guardrails */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-[#171A18] p-3.5 space-y-1.5">
                <div className="text-[13px] font-semibold text-[#CBD5E1]">
                  {t.v34.whyUnfixedLabel}
                </div>
                {validationUnfixed.length === 0 ? (
                  <p className="text-[#43D17A] text-sm">
                    {t.v34.whyUnfixedNone}
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm text-[#E3AD56]">
                    {validationUnfixed.map((uw) => (
                      <li key={uw.scenario_type}>
                        • {scenarioLabel(uw.scenario_type)}:{" "}
                        {uw.false_negatives > 0
                          ? `FN ${uw.false_negatives}/${uw.actual_risk_events}`
                          : ""}
                        {uw.false_positives > 0
                          ? `${uw.false_negatives > 0 ? ", " : ""}FP ${uw.false_positives}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl bg-[#171A18] p-3.5 space-y-1.5">
                <div className="text-[13px] font-semibold text-[#CBD5E1]">
                  {t.v34.guardrailsListTitle}
                </div>
                {guardrails ? (
                  <div className="text-[13px] font-mono text-[#CBD5E1] flex flex-wrap gap-x-3 gap-y-1">
                    <span>max_fpr ≤ {(guardrails.max_fpr * 100).toFixed(1)}%</span>
                    <span>max_fp_inc ≤ {guardrails.max_fp_increase}</span>
                    <span>
                      min_prec ≥ {(guardrails.min_precision * 100).toFixed(0)}%
                    </span>
                    <span>
                      min_rec_gain ≥ {(guardrails.min_recall_gain * 100).toFixed(1)}%
                    </span>
                  </div>
                ) : (
                  <p className="text-[13px] text-[#B8C0BC]">
                    {t.v34.validationSplitOnlyNote}
                  </p>
                )}
                {activeCandInfo && (
                  <div className="text-[13px] text-[#43D17A] font-medium">
                    Validation: Recall{" "}
                    {(activeCandInfo.validation_metrics.recall * 100).toFixed(1)}% ·
                    Precision{" "}
                    {(activeCandInfo.validation_metrics.precision * 100).toFixed(1)}%
                    · FPR{" "}
                    {(
                      activeCandInfo.validation_metrics.false_positive_rate * 100
                    ).toFixed(2)}
                    %
                  </div>
                )}
              </div>
            </div>

            <div className={`v4-accordion-grid ${showSelectionDetails ? "is-open" : ""}`}>
              <div className="v4-accordion-inner">
                <div className="pt-3 border-t border-white/[0.06] space-y-3">
                  <div className="text-[13px] text-[#B8C0BC]">
                    {t.v34.validationSplitOnlyNote}
                  </div>

                  {/* All Candidates Validation Comparison Table */}
                  <div className="overflow-x-auto rounded-xl bg-[#171A18]">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-[#B8C0BC] border-b border-white/[0.06] text-[13px]">
                          <th className="py-2.5 px-3.5 font-medium">Кандидат</th>
                          <th className="py-2.5 px-3 font-medium">Recall</th>
                          <th className="py-2.5 px-3 font-medium">Precision</th>
                          <th className="py-2.5 px-3 font-medium">FPR</th>
                          <th className="py-2.5 px-3 font-medium">F1</th>
                          <th className="py-2.5 px-3 font-medium">FN / FP</th>
                          <th className="py-2.5 px-3.5 font-medium">Guardrails</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {(
                          evolutionRun?.candidates_json ||
                          externalEvolution?.candidates_json ||
                          []
                        ).map((cand) => {
                          const isSel = cand.key === activeCandKey;
                          const vm = cand.validation_metrics;
                          const allPass = Object.values(
                            cand.guardrail_checks || {}
                          ).every(Boolean);
                          return (
                            <tr
                              key={cand.key}
                              onClick={() =>
                                !validating && onSelectCandidateKey(cand.key)
                              }
                              className={`cursor-pointer transition-colors ${
                                isSel
                                  ? "bg-[#008F36]/18"
                                  : "hover:bg-[#1F2521]"
                              }`}
                            >
                              <td className="py-2.5 px-3.5 font-medium text-[#F1F5F9] flex items-center gap-1.5">
                                {isSel && (
                                  <CheckCircle2 className="h-4 w-4 text-[#43D17A] shrink-0" />
                                )}
                                <span>
                                  {cand.key}: {cand.name}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-[#F1F5F9]">
                                {(vm.recall * 100).toFixed(1)}%
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-[#CBD5E1]">
                                {(vm.precision * 100).toFixed(1)}%
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-[#CBD5E1]">
                                {(vm.false_positive_rate * 100).toFixed(2)}%
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-[#CBD5E1]">
                                {(vm.f1_score * 100).toFixed(1)}%
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-[#CBD5E1]">
                                {vm.false_negatives} / {vm.false_positives}
                              </td>
                              <td className="py-2.5 px-3.5">
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[13px] font-semibold ${
                                    allPass
                                      ? "bg-[#43D17A]/15 text-[#43D17A]"
                                      : "bg-[#E3AD56]/15 text-[#E3AD56]"
                                  }`}
                                >
                                  {allPass ? "PASS" : "TRADEOFF"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {(evolutionRun?.tradeoff_assessment ||
                    activeCandInfo?.validation_assessment) && (
                    <p className="text-[13px] text-[#CBD5E1]">
                      {activeCandInfo?.validation_assessment ||
                        evolutionRun?.tradeoff_assessment}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Honest guard note: Почему нельзя сразу применять изменения? */}
          <div className="v4-surface-inset px-4 py-3.5 flex items-start gap-3 text-sm">
            <Info className="h-4 w-4 text-[#E3AD56] shrink-0 mt-1" />
            <div className="space-y-1">
              <div className="font-semibold text-[#F1F5F9]">
                {t.v4h.verifyGuardTitle}
              </div>
              <p className="text-[#CBD5E1] leading-relaxed">
                {t.v4h.verifyGuardText}
              </p>
            </div>
          </div>

          {/* Stage C — Primary Validate Button */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {validating ? (
              <div className="v4-surface-inset px-4 py-3 rounded-2xl space-y-2 min-w-[300px]">
                <div className="flex items-center gap-2.5 text-[15px] text-[#43D17A] font-semibold">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>
                    {validatingPhase === "eval_base"
                      ? t.v34.validatingStage1
                      : validatingPhase === "diffing"
                        ? t.v34.validatingStage3
                        : t.v34.validatingStage2}
                  </span>
                </div>
                <div className="v4-shimmer-track">
                  <div className="v4-shimmer-bar" />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onValidate}
                className="btn-primary rounded-full px-6 py-3 text-[15px] font-semibold inline-flex items-center gap-2.5"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>{t.v4h.btnVerifyImproved}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            )}

            {isCompletedValidation && !validating && (
              <span className="text-sm font-medium text-[#43D17A] inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                <span>{t.v34.sec4Title}</span>
              </span>
            )}
          </div>
        </div>
        );
      })()}
    </section>
  );
};
