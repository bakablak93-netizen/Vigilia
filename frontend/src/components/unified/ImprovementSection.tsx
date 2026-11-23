import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitCompareArrows,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { EvolutionRun } from "../../types/api";
import { ConfusionMatrixCard } from "../ConfusionMatrixCard";
import { DeltaBadge } from "../MetricCard";

interface ImprovementSectionProps {
  experimentId: number;
  activeEvolution: EvolutionRun | null;
  onEvolutionCompleted: (evo: EvolutionRun) => void;
  defaultShowDetails?: boolean;
}

export const ImprovementSection: React.FC<ImprovementSectionProps> = ({
  experimentId,
  activeEvolution,
  onEvolutionCompleted,
  defaultShowDetails = false,
}) => {
  const { t, lang, ruleLabel, scenarioLabel, verdictLabel } = useLab();
  const queryClient = useQueryClient();

  const [progressStep, setProgressStep] = useState<number>(0);
  const [showDetails, setShowDetails] = useState(defaultShowDetails);
  const [selectedCandKey, setSelectedCandKey] = useState<string>("D");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ["evolutionHistory"],
    queryFn: api.getEvolutionHistory,
    enabled: showDetails,
  });

  const improveMutation = useMutation({
    mutationFn: async (candidateKeyOverride?: string) => {
      setErrorMsg(null);
      setProgressStep(1);
      const analyzed = await api.analyzeEvolution(experimentId);
      setProgressStep(2);
      const chosenKey =
        candidateKeyOverride || analyzed.selected_candidate_key || "D";
      setSelectedCandKey(chosenKey);
      setProgressStep(3);
      const validated = await api.validateEvolution({
        evolution_run_id: analyzed.id,
        candidate_key: chosenKey,
      });
      setProgressStep(4);
      return validated;
    },
    onSuccess: (evo) => {
      onEvolutionCompleted(evo);
      queryClient.invalidateQueries({ queryKey: ["evolutionRuns"] });
      queryClient.invalidateQueries({ queryKey: ["evolutionHistory"] });
      queryClient.invalidateQueries({ queryKey: ["defenseConfigs"] });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => {
      setProgressStep(0);
      setErrorMsg(err.message);
    },
  });

  const evalCmp = activeEvolution?.comparison_json?.evaluation_split;
  const candidates = activeEvolution?.candidates_json || [];
  const guardChecks = activeEvolution?.comparison_json?.guardrail_report?.checks;

  const renderVerdictBadge = (verdict: string) => {
    const label = verdictLabel(verdict);
    if (verdict === "improved") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#43D17A]/15 text-[#43D17A]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>{label}</span>
        </span>
      );
    }
    if (verdict === "rejected_regression") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F16B6B]/15 text-[#F16B6B]">
          <XCircle className="h-3.5 w-3.5" />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#E3AD56]/15 text-[#E3AD56]">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{label}</span>
      </span>
    );
  };

  return (
    <section id="improve" className="rounded-2xl bg-[#171A18] p-5 space-y-5">
      {/* Header + Primary Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#F4F6F4] flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-[#43D17A]" />
            <span>{t.improve.sectionTitle}</span>
          </h2>
          <p className="text-xs text-[#A1ABA4] mt-0.5">{t.improve.sectionHint}</p>
        </div>

        <button
          type="button"
          onClick={() => improveMutation.mutate(undefined)}
          disabled={improveMutation.isPending}
          className="lab-btn-accent shrink-0"
        >
          {improveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span>
            {improveMutation.isPending ? t.improve.runningBtn : t.improve.actionBtn}
          </span>
        </button>
      </div>

      {/* Live Progress Bar during Evolution */}
      {improveMutation.isPending && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {t.improve.progressSteps.map((stepLabel, idx) => {
            const active = progressStep >= idx + 1;
            return (
              <div
                key={stepLabel}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  active
                    ? "border-[#087F70] bg-[#087F70]/10 text-[#087F70]"
                    : "border-[#E4E9ED] dark:border-[#233540] text-[#71818B]"
                }`}
              >
                {stepLabel}
              </div>
            );
          })}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-[#D95B5B]/40 bg-[#D95B5B]/5 p-3 text-xs text-[#D95B5B]">
          {errorMsg}
        </div>
      )}

      {/* Compact Single Before / After Comparison Block */}
      {activeEvolution && activeEvolution.status === "completed" && evalCmp && (
        <div id="verify" className="space-y-4 pt-3 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-sm font-bold text-[#F4F6F4] flex items-center gap-1.5">
                <span>{activeEvolution.comparison_json.baseline_version}</span>
                <ArrowRight className="h-4 w-4 text-[#43D17A]" />
                <span className="text-[#43D17A]">
                  {activeEvolution.comparison_json.candidate_version}
                </span>
              </span>
              {renderVerdictBadge(activeEvolution.verdict)}
            </div>

            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="lab-btn-secondary py-1 px-3 text-xs"
            >
              {showDetails ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              <span>
                {showDetails ? t.improve.hideDetailsBtn : t.improve.detailsBtn}
              </span>
            </button>
          </div>

          <div className="text-xs text-[#77837C]">{t.improve.beforeAfterTitle}</div>

          {/* Before -> After Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="rounded-xl bg-[#202522] p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[#77837C]">{t.improve.detectionMetric}</div>
                <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                  <span className="text-sm text-[#A1ABA4]">
                    {(evalCmp.baseline.recall * 100).toFixed(1)}%
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-[#77837C]" />
                  <span className="text-xl font-bold text-[#F4F6F4]">
                    {(evalCmp.candidate.recall * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] text-[#77837C] mt-0.5 tabular-nums">
                  TP: {evalCmp.baseline.true_positives} → {evalCmp.candidate.true_positives}
                </div>
              </div>
              <DeltaBadge
                deltaValue={evalCmp.delta.recall}
                higherIsBetter={true}
                unitLabel={t.focus.ppUnit}
              />
            </div>

            <div className="rounded-xl bg-[#202522] p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[#77837C]">{t.improve.falseBlockMetric}</div>
                <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                  <span className="text-sm text-[#A1ABA4]">
                    {(evalCmp.baseline.false_positive_rate * 100).toFixed(2)}%
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-[#77837C]" />
                  <span className="text-xl font-bold text-[#F4F6F4]">
                    {(evalCmp.candidate.false_positive_rate * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="text-[11px] text-[#77837C] mt-0.5 tabular-nums">
                  FP: {evalCmp.baseline.false_positives} → {evalCmp.candidate.false_positives}
                </div>
              </div>
              <DeltaBadge
                deltaValue={evalCmp.delta.false_positive_rate}
                higherIsBetter={false}
                decimals={2}
                unitLabel={t.focus.ppUnit}
              />
            </div>
          </div>

          {/* Verdict / Guardrails Note */}
          {(() => {
            const summarySentence =
              lang === "en"
                ? activeEvolution.tradeoff_assessment
                : lang === "kk"
                  ? `Қауіптерді анықтау ${(evalCmp.baseline.recall * 100).toFixed(1)}% → ${(evalCmp.candidate.recall * 100).toFixed(1)}%, жалған бұғаттау ${(evalCmp.baseline.false_positive_rate * 100).toFixed(2)}% → ${(evalCmp.candidate.false_positive_rate * 100).toFixed(2)}% (${verdictLabel(activeEvolution.verdict)}).`
                  : `Обнаружение угроз: ${(evalCmp.baseline.recall * 100).toFixed(1)}% → ${(evalCmp.candidate.recall * 100).toFixed(1)}%, ложные блокировки: ${(evalCmp.baseline.false_positive_rate * 100).toFixed(2)}% → ${(evalCmp.candidate.false_positive_rate * 100).toFixed(2)}% (${verdictLabel(activeEvolution.verdict)}).`;

            return activeEvolution.verdict === "rejected_regression" ? (
              <div
                className="rounded-lg border border-[#D95B5B]/40 bg-[#D95B5B]/10 p-3 text-xs text-[#D95B5B]"
                title={activeEvolution.tradeoff_assessment}
              >
                <strong>{t.improve.guardrailRejectedNote}</strong> {summarySentence}
              </div>
            ) : (
              <div
                className="text-xs text-[#17262E] dark:text-[#CBD5DC]"
                title={activeEvolution.tradeoff_assessment}
              >
                <strong>{t.improve.verdictLabel}:</strong> {summarySentence}
              </div>
            );
          })()}

          {/* Expandable Detailed Analytics for Before / After */}
          {showDetails && (
            <div className="pt-4 border-t border-white/[0.06] space-y-5">
              {/* Precision, F1 & Guardrails */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="rounded-xl bg-[#202522] p-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#77837C]">{t.improve.precisionMetric}</div>
                    <div className="text-lg font-bold tabular-nums text-[#F4F6F4] mt-1">
                      {(evalCmp.baseline.precision * 100).toFixed(1)}% →{" "}
                      {(evalCmp.candidate.precision * 100).toFixed(1)}%
                    </div>
                  </div>
                  <DeltaBadge deltaValue={evalCmp.delta.precision} higherIsBetter={true} unitLabel={t.focus.ppUnit} />
                </div>

                <div className="rounded-xl bg-[#202522] p-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#77837C]">{t.improve.f1Metric}</div>
                    <div className="text-lg font-bold tabular-nums text-[#F4F6F4] mt-1">
                      {(evalCmp.baseline.f1_score * 100).toFixed(1)}% →{" "}
                      {(evalCmp.candidate.f1_score * 100).toFixed(1)}%
                    </div>
                  </div>
                  <DeltaBadge deltaValue={evalCmp.delta.f1_score} higherIsBetter={true} unitLabel={t.focus.ppUnit} />
                </div>

                {guardChecks && (
                  <div className="rounded-xl bg-[#202522] p-4 space-y-1.5">
                    <div className="text-xs font-semibold text-[#77837C]">Guardrails</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(guardChecks).map(([k, ok]) => (
                        <span
                          key={k}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                            ok
                              ? "bg-[#43D17A]/15 text-[#43D17A]"
                              : "bg-[#F16B6B]/15 text-[#F16B6B]"
                          }`}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfusionMatrixCard
                  matrix={{
                    tp: evalCmp.baseline.true_positives,
                    fp: evalCmp.baseline.false_positives,
                    tn: evalCmp.baseline.true_negatives,
                    fn: evalCmp.baseline.false_negatives,
                  }}
                  title={`${t.improve.baselineCol} (${activeEvolution.comparison_json.baseline_version})`}
                />
                <ConfusionMatrixCard
                  matrix={{
                    tp: evalCmp.candidate.true_positives,
                    fp: evalCmp.candidate.false_positives,
                    tn: evalCmp.candidate.true_negatives,
                    fn: evalCmp.candidate.false_negatives,
                  }}
                  title={`${t.improve.proposedCol} (${activeEvolution.comparison_json.candidate_version})`}
                />
              </div>

              {/* Candidate Variants Table */}
              {candidates.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-[#142B34] dark:text-white">
                      {t.improve.candidatesTitle}
                    </div>
                    <button
                      type="button"
                      onClick={() => improveMutation.mutate(selectedCandKey)}
                      disabled={improveMutation.isPending}
                      className="lab-btn-secondary py-1 px-2.5 text-xs"
                    >
                      {t.improve.useCandidateBtn} ({selectedCandKey})
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-xl bg-[#202522]">
                    <table className="w-full text-xs tabular-nums">
                      <thead className="bg-[#101211]/50 text-[#77837C]">
                        <tr>
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">{t.result.colScenario}</th>
                          <th className="px-3 py-2 text-right">{t.result.colDetection}</th>
                          <th className="px-3 py-2 text-right">{t.result.colFpr}</th>
                          <th className="px-3 py-2 text-right">F1</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {candidates.map((cand) => (
                          <tr
                            key={cand.key}
                            onClick={() => setSelectedCandKey(cand.key)}
                            className={`cursor-pointer ${
                              selectedCandKey === cand.key
                                ? "bg-[#008F36]/20"
                                : "hover:bg-[#262C28]"
                            }`}
                          >
                            <td className="px-3 py-2 font-mono font-bold text-[#F4F6F4]">
                              {cand.key}
                            </td>
                            <td className="px-3 py-2 text-[#A1ABA4]">{cand.name}</td>
                            <td className="px-3 py-2 text-right font-semibold text-[#43D17A]">
                              {(cand.validation_metrics.recall * 100).toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right text-[#F4F6F4]">
                              {(cand.validation_metrics.false_positive_rate * 100).toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-[#F4F6F4]">
                              {(cand.validation_metrics.f1_score * 100).toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Changed Parameters & Isolated Rule Contribution */}
              {activeEvolution.changed_params_json.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-[#F4F6F4]">
                    {t.improve.changedParamsTitle}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {activeEvolution.changed_params_json.map((ch, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-[#202522] p-3 text-xs space-y-1"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold text-[#F4F6F4]">
                            {ruleLabel(ch.rule)}{" "}
                            <span className="font-mono text-[#77837C]">.{ch.param}</span>
                          </span>
                          <span className="font-mono text-[#A1ABA4]">
                            {String(ch.old_value)} →{" "}
                            <strong className="text-[#43D17A]">{String(ch.new_value)}</strong>
                          </span>
                        </div>
                        {ch.before_metrics && ch.after_metrics && (
                          <div className="text-[11px] font-mono text-[#77837C]">
                            Recall:{" "}
                            {((ch.before_metrics.recall ?? 0) * 100).toFixed(1)}% →{" "}
                            {((ch.after_metrics.recall ?? 0) * 100).toFixed(1)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scenario Before/After */}
              {(activeEvolution.comparison_json.scenario_comparison || []).length > 0 && (
                <div className="overflow-x-auto rounded-xl bg-[#202522]">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="bg-[#101211]/50 text-[#77837C]">
                      <tr>
                        <th className="px-3 py-2 text-left">{t.result.colScenario}</th>
                        <th className="px-3 py-2 text-right">{t.improve.baselineCol}</th>
                        <th className="px-3 py-2 text-right">{t.improve.proposedCol}</th>
                        <th className="px-3 py-2 text-right">{t.result.colDetection} Δ</th>
                        <th className="px-3 py-2 text-right">{t.result.colFpr} Δ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {activeEvolution.comparison_json.scenario_comparison!.map((sc) => (
                        <tr key={sc.scenario_type}>
                          <td className="px-3 py-2 font-medium text-[#F4F6F4]">
                            {scenarioLabel(sc.scenario_type)}
                          </td>
                          <td className="px-3 py-2 text-right text-[#A1ABA4]">
                            {sc.baseline_recall !== null
                              ? `${(sc.baseline_recall * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-[#43D17A]">
                            {sc.candidate_recall !== null
                              ? `${(sc.candidate_recall * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {sc.recall_delta !== null ? (
                              <DeltaBadge
                                deltaValue={sc.recall_delta}
                                higherIsBetter={true}
                                unitLabel={t.focus.ppUnit}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {sc.fpr_delta !== null ||
                            (sc.candidate_fpr !== null &&
                              sc.baseline_fpr !== null) ? (
                              <DeltaBadge
                                deltaValue={
                                  sc.fpr_delta ??
                                  (sc.candidate_fpr ?? 0) - (sc.baseline_fpr ?? 0)
                                }
                                higherIsBetter={false}
                                decimals={2}
                                unitLabel={t.focus.ppUnit}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Version Lineage */}
              {historyQuery.data && historyQuery.data.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-[#F4F6F4]">
                    {t.improve.lineageTitle}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {historyQuery.data.map((h) => (
                      <div
                        key={h.id}
                        className="text-[11px] font-mono px-3 py-1.5 rounded-xl bg-[#202522] text-[#A1ABA4]"
                      >
                        <strong className="text-[#F4F6F4]">{h.version}</strong>
                        {h.parent_version ? ` ← ${h.parent_version}` : ""} ·{" "}
                        {verdictLabel(h.verdict)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
