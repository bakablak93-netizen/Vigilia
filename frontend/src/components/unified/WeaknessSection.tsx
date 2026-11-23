import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Search,
  ShieldAlert,
} from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { SecurityIntelligenceReport, TransactionInspectorItem } from "../../types/api";
import { TransactionInspectorPanel } from "../TransactionInspectorPanel";

interface WeaknessSectionProps {
  experimentId: number;
  intelligence: SecurityIntelligenceReport;
  defaultOpenDiagnostics?: boolean;
}

interface DerivedWeakness {
  id: string;
  scenarioType: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  explanation: string;
  missed: number;
  actualRisks: number;
  falseBlocks: number;
  recall: number;
  fpr: number;
  avgScore: number;
}

/**
 * Provides concise Russian/Kazakh rule-calibration guidance matching backend target rules.
 */
function wLocalizedImpact(lang: string, targetRule: string): string {
  const ruMap: Record<string, string> = {
    unusual_amount:
      "Усилить вес и точнее откалибровать порог коэффициента отклонения суммы от профиля клиента, чтобы ловить атипично крупные переводы без лишних ложных срабатываний.",
    new_recipient_risk:
      "Скорректировать вес правила нового получателя и учитывать сочетание с суммой и каналом перевода для выявления целенаправленного вывода средств.",
    duplicate_payment:
      "Сбалансировать окно и вес повторного платежа: улавливать дублирующие списания, не блокируя регулярные легитимные переводы.",
    unusual_frequency:
      "Оптимизировать порог частоты операций за короткое окно времени, чтобы отсекать всплески активности и авто-скрипты.",
    suspicious_sequence:
      "Усилить выявление многошаговых цепочек операций (дробление, переключение устройства или географии перед переводом).",
    global:
      "Откалибровать общий порог риска и совокупные веса правил для лучшего баланса между обнаружением угроз и долей ложных блокировок.",
  };
  const kkMap: Record<string, string> = {
    unusual_amount:
      "Клиент профилінен сома ауытқуының шегі мен салмағын дәлірек баптау: ірі күмәнді аударымдарды жалған бұғаттаусыз анықтау үшін.",
    new_recipient_risk:
      "Жаңа алушы ережесінің салмағын түзету және сома мен арнамен үйлесімін ескеру.",
    duplicate_payment:
      "Қайталанатын төлем терезесі мен салмағын теңестіру: заңды тұрақты төлемдерді бұғаттамай, дубльдерді ұстау үшін.",
    unusual_frequency:
      "Қысқа уақыт аралығындағы операциялар жиілігінің шегін оңтайландыру.",
    suspicious_sequence:
      "Көпқадамды күмәнді тізбектерді (бөлшектеу, құрылғы не география ауыстыру) анықтауды күшейту.",
    global:
      "Қауіптерді анықтау мен жалған бұғаттау үлесінің теңгерімін жақсарту үшін жалпы тәуекел шегін калибрлеу.",
  };

  if (lang === "kk") {
    return (
      kkMap[targetRule] ??
      "Тәуекелді анықтау дәлдігін арттыру және жалған бұғаттауды азайту үшін ереже салмағын калибрлеу ұсынылады."
    );
  }
  return (
    ruMap[targetRule] ??
    "Рекомендуется скорректировать вес данного правила и порог риска для снижения числа пропущенных угроз и ложных срабатываний."
  );
}

export const WeaknessSection: React.FC<WeaknessSectionProps> = ({
  experimentId,
  intelligence,
  defaultOpenDiagnostics = false,
}) => {
  const { t, lang, scenarioLabel, ruleLabel, formatKzt } = useLab();

  const [expandedWeaknessId, setExpandedWeaknessId] = useState<string | null>(null);
  const [showWhyError, setShowWhyError] = useState(defaultOpenDiagnostics);
  const [inspectedTx, setInspectedTx] = useState<TransactionInspectorItem | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  // Build concise, localized weakness items strictly from computed scenario metrics
  const weaknesses: DerivedWeakness[] = [];
  for (const row of intelligence.weakness_explorer) {
    if (row.actual_risk_events > 0 && (row.missed_risks > 0 || row.recall < 0.85)) {
      const sev: DerivedWeakness["severity"] =
        row.recall < 0.45 ? "critical" : row.recall < 0.72 ? "high" : "medium";
      const titleMap = t.detect.weaknessTitles as Record<string, string>;
      const title = titleMap[row.scenario_type] || scenarioLabel(row.scenario_type);
      const expl =
        lang === "en"
          ? `Caught ${row.detected_risks} of ${row.actual_risk_events} threats (${(row.recall * 100).toFixed(1)}%); ${row.missed_risks} missed (avg risk score ${row.avg_risk_score.toFixed(1)}).`
          : lang === "kk"
            ? `${row.actual_risk_events} қауіптің ${row.detected_risks} анықталды (${(row.recall * 100).toFixed(1)}%); ${row.missed_risks} өткізіп алынды (орт. балл ${row.avg_risk_score.toFixed(1)}).`
            : `Обнаружено ${row.detected_risks} из ${row.actual_risk_events} угроз (${(row.recall * 100).toFixed(1)}%); пропущено ${row.missed_risks} (средний балл риска ${row.avg_risk_score.toFixed(1)}).`;

      weaknesses.push({
        id: `fn-${row.scenario_type}`,
        scenarioType: row.scenario_type,
        title,
        severity: sev,
        explanation: expl,
        missed: row.missed_risks,
        actualRisks: row.actual_risk_events,
        falseBlocks: row.false_positives,
        recall: row.recall,
        fpr: row.false_positive_rate,
        avgScore: row.avg_risk_score,
      });
    }

    if (row.false_positives >= 2 || row.false_positive_rate > 0.015) {
      const expl =
        lang === "en"
          ? `${row.false_positives} legitimate operations in «${scenarioLabel(row.scenario_type)}» were falsely blocked (${(row.false_positive_rate * 100).toFixed(2)}%).`
          : lang === "kk"
            ? `«${scenarioLabel(row.scenario_type)}» сценарийінде ${row.false_positives} заңды операция қате бұғатталды (${(row.false_positive_rate * 100).toFixed(2)}%).`
            : `В сценарии «${scenarioLabel(row.scenario_type)}» ошибочно остановлено ${row.false_positives} законных операций (${(row.false_positive_rate * 100).toFixed(2)}%).`;

      weaknesses.push({
        id: `fp-${row.scenario_type}`,
        scenarioType: row.scenario_type,
        title: t.detect.weaknessTitles.false_positives,
        severity: row.false_positive_rate > 0.03 ? "high" : "medium",
        explanation: expl,
        missed: row.missed_risks,
        actualRisks: row.actual_risk_events,
        falseBlocks: row.false_positives,
        recall: row.recall,
        fpr: row.false_positive_rate,
        avgScore: row.avg_risk_score,
      });
    }
  }

  const severityStyle: Record<DerivedWeakness["severity"], string> = {
    critical: "bg-[#D95B5B]/15 text-[#D95B5B]",
    high: "bg-[#D99A36]/15 text-[#D99A36]",
    medium: "bg-[#087F70]/15 text-[#087F70]",
    low: "bg-[#EDF2F6] dark:bg-[#1E2E38] text-[#71818B]",
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupCode.trim()) return;
    try {
      setLookupErr(null);
      const item = await api.inspectTransaction(
        experimentId,
        lookupCode.trim().toUpperCase()
      );
      setInspectedTx(item);
    } catch (err) {
      setLookupErr((err as Error).message);
    }
  };

  return (
    <section id="detect" className="lab-card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#142B34] dark:text-white flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D99A36]" />
            <span>{t.detect.sectionTitle}</span>
          </h2>
          <p className="text-xs text-[#71818B] mt-0.5">{t.detect.sectionHint}</p>
        </div>

        <button
          type="button"
          onClick={() => setShowWhyError((v) => !v)}
          className="lab-btn-secondary py-1.5 px-3 text-xs"
        >
          {showWhyError ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          <span>{showWhyError ? t.detect.hideWhyErrorBtn : t.detect.whyErrorBtn}</span>
        </button>
      </div>

      {/* Compact List of Real Weaknesses */}
      {weaknesses.length === 0 ? (
        <div className="rounded-lg bg-[#16886E]/10 border border-[#16886E]/30 p-3.5 text-xs text-[#16886E] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{t.detect.noWeaknesses}</span>
        </div>
      ) : (
        <div className="divide-y divide-[#E4E9ED] dark:divide-[#233540] border border-[#E4E9ED] dark:border-[#233540] rounded-xl overflow-hidden">
          {weaknesses.map((w) => {
            const isExpanded = expandedWeaknessId === w.id;
            const samples = intelligence.transaction_inspector_samples
              .filter((s) => s.scenario_type === w.scenarioType)
              .slice(0, 4);
            const triggeredRuleNames = Array.from(
              new Set(samples.flatMap((s) => s.triggered_rules.map((tr) => tr.rule)))
            );

            return (
              <div key={w.id} className="bg-white dark:bg-[#142028]">
                <button
                  type="button"
                  onClick={() => setExpandedWeaknessId(isExpanded ? null : w.id)}
                  className="w-full text-left px-4 py-3.5 hover:bg-[#F6F8FA] dark:hover:bg-[#1B2B35] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          severityStyle[w.severity]
                        }`}
                      >
                        {t.detect.severity[w.severity]}
                      </span>
                      <span className="text-sm font-semibold text-[#142B34] dark:text-white">
                        {w.title}
                      </span>
                    </div>
                    <p className="text-xs text-[#71818B]">{w.explanation}</p>
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#087F70] shrink-0">
                    <span>{isExpanded ? t.detect.hideDetails : t.detect.openDetails}</span>
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-[#E4E9ED] dark:border-[#233540] bg-[#F6F8FA] dark:bg-[#0E171D] space-y-3 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="font-semibold text-[#142B34] dark:text-white">
                          {t.detect.triggeredRulesLabel}
                        </div>
                        <div className="text-[#71818B]">
                          {triggeredRuleNames.length > 0
                            ? triggeredRuleNames.map(ruleLabel).join(", ")
                            : t.inspector.noRules}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="font-semibold text-[#142B34] dark:text-white">
                          {t.detect.missedRulesLabel}
                        </div>
                        <div className="text-[#71818B]">
                          {w.id.startsWith("fp-")
                            ? lang === "en"
                              ? `${w.falseBlocks} legitimate operations exceeded the block threshold.`
                              : lang === "kk"
                                ? `${w.falseBlocks} заңды операция бұғаттау шегінен асып кетті.`
                                : `${w.falseBlocks} законных операций превысили порог блокировки по совокупности правил.`
                            : lang === "en"
                              ? `${w.missed} of ${w.actualRisks} threats scored below the block threshold (avg score ${w.avgScore.toFixed(1)}).`
                              : lang === "kk"
                                ? `${w.actualRisks} қауіптің ${w.missed} бұғаттау шегіне жетпеді (орт. балл ${w.avgScore.toFixed(1)}).`
                                : `${w.missed} из ${w.actualRisks} угроз не набрали баллов до порога блокировки (средний балл ${w.avgScore.toFixed(1)}).`}
                        </div>
                      </div>
                    </div>

                    {samples.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="font-semibold text-[#142B34] dark:text-white">
                          {t.detect.sampleOpsLabel}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {samples.map((smp) => (
                            <button
                              key={smp.transaction_code}
                              type="button"
                              onClick={() => {
                                setInspectedTx(smp);
                                setShowWhyError(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#142028] border border-[#E4E9ED] dark:border-[#2A3E4A] hover:border-[#087F70] font-mono text-[11px]"
                            >
                              <Eye className="h-3 w-3 text-[#087F70]" />
                              <span>{smp.transaction_code}</span>
                              <span className="text-[#71818B]">
                                ({formatKzt(smp.amount_kzt)})
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Expandable "Почему система ошиблась?" Security Intelligence Panel */}
      {showWhyError && (
        <div className="pt-4 border-t border-[#E4E9ED] dark:border-[#233540] space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* False Negative Analysis */}
            <div className="rounded-xl border border-[#E4E9ED] dark:border-[#233540] bg-[#F6F8FA] dark:bg-[#0E171D] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#142B34] dark:text-white">
                  <ShieldAlert className="h-4 w-4 text-[#D95B5B]" />
                  <span>{t.detect.fnTitle}</span>
                </div>
                <span className="font-mono text-xs font-semibold text-[#D95B5B]">
                  {intelligence.false_negative_analysis.total_false_negatives}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between p-2 rounded bg-white dark:bg-[#142028]">
                  <span className="text-[#71818B]">{t.detect.nearThreshold}</span>
                  <strong className="tabular-nums">
                    {
                      intelligence.false_negative_analysis.miss_categories
                        .near_threshold_misses.count
                    }
                  </strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-white dark:bg-[#142028]">
                  <span className="text-[#71818B]">{t.detect.singleRule}</span>
                  <strong className="tabular-nums">
                    {
                      intelligence.false_negative_analysis.miss_categories
                        .partial_single_rule_misses.count
                    }
                  </strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-white dark:bg-[#142028]">
                  <span className="text-[#71818B]">{t.detect.zeroScore}</span>
                  <strong className="tabular-nums">
                    {
                      intelligence.false_negative_analysis.miss_categories
                        .untriggered_blind_spots.count
                    }
                  </strong>
                </div>
              </div>
            </div>

            {/* False Positive Analysis */}
            <div className="rounded-xl border border-[#E4E9ED] dark:border-[#233540] bg-[#F6F8FA] dark:bg-[#0E171D] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#142B34] dark:text-white">
                  <AlertCircle className="h-4 w-4 text-[#D99A36]" />
                  <span>{t.detect.fpTitle}</span>
                </div>
                <span className="font-mono text-xs font-semibold text-[#D99A36]">
                  {intelligence.false_positive_analysis.total_false_positives} (
                  {(
                    intelligence.false_positive_analysis.false_positive_rate * 100
                  ).toFixed(2)}
                  %)
                </span>
              </div>

              {intelligence.false_positive_analysis.participating_rules.length === 0 ? (
                <div className="p-3 rounded bg-white dark:bg-[#142028] text-xs text-[#16886E]">
                  {t.detect.noFalseBlocks}
                </div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {intelligence.false_positive_analysis.participating_rules.map((pr) => (
                    <div
                      key={pr.rule}
                      className="flex justify-between items-center p-2 rounded bg-white dark:bg-[#142028]"
                    >
                      <span>{ruleLabel(pr.rule)}</span>
                      <span className="font-mono font-semibold text-[#D99A36]">
                        {pr.fp_count} (+{pr.avg_contribution})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {intelligence.analyst.recommendations.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-[#142B34] dark:text-white">
                {t.detect.recommendationsTitle}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {intelligence.analyst.recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-[#E4E9ED] dark:border-[#233540] p-3 text-xs space-y-1.5"
                  >
                    <div className="font-semibold text-[#087F70]">
                      {ruleLabel(rec.target_rule)}
                    </div>
                    <div className="text-[#17262E] dark:text-[#E7EEF2]">
                      {lang === "en" ? rec.explanation : wLocalizedImpact(lang, rec.target_rule)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(rec.proposed_changes_json).map(([param, diff]) => (
                        <span
                          key={param}
                          className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#F6F8FA] dark:bg-[#0E171D]"
                        >
                          {param}: {String(diff.old)} →{" "}
                          <strong className="text-[#087F70]">{String(diff.new)}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transaction Inspector Lookup & Sample Selector */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#142B34] dark:text-white">
                {t.detect.inspectorTitle}
              </div>
              <form onSubmit={handleLookup} className="flex gap-2">
                <input
                  type="text"
                  placeholder={t.detect.searchPlaceholder}
                  className="lab-input py-1 px-2.5 text-xs font-mono !w-48"
                  value={lookupCode}
                  onChange={(e) => setLookupCode(e.target.value)}
                />
                <button type="submit" className="lab-btn-secondary py-1 px-3 text-xs">
                  <Search className="h-3.5 w-3.5" />
                  <span>{t.detect.inspectBtn}</span>
                </button>
              </form>
            </div>
            {lookupErr && <div className="text-xs text-[#D95B5B]">{lookupErr}</div>}

            <div className="flex flex-wrap gap-1.5">
              {intelligence.transaction_inspector_samples.slice(0, 12).map((smp) => (
                <button
                  key={smp.transaction_code}
                  type="button"
                  onClick={() => setInspectedTx(smp)}
                  className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                    inspectedTx?.transaction_code === smp.transaction_code
                      ? "bg-[#142B34] text-white border-[#142B34]"
                      : "border-[#E4E9ED] dark:border-[#2A3E4A] hover:border-[#087F70]"
                  }`}
                >
                  {(t.inspector.outcomes as Record<string, string>)[smp.outcome]?.split(" ")[0]}{" "}
                  · {smp.transaction_code} ({formatKzt(smp.amount_kzt)})
                </button>
              ))}
            </div>

            <TransactionInspectorPanel
              item={inspectedTx || intelligence.transaction_inspector_samples[0] || null}
              onClose={inspectedTx ? () => setInspectedTx(null) : undefined}
            />
          </div>

          <div className="text-[11px] text-[#71818B]">{t.detect.reliabilityNote}</div>
        </div>
      )}
    </section>
  );
};
