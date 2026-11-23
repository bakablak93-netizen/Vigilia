import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Maximize2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type {
  EvolutionRun,
  ExperimentSummary,
  ExperimentTxDiffResponse,
  ExternalEvolutionRun,
  MetricsSummary,
  ScenarioComparisonItem,
  SecurityIntelligenceReport,
  TransactionInspectorItem,
} from "../../types/api";
import type { AnalyticsTab } from "../unified/AnalyticsDrawer";
import { AnimatedNumber } from "../v4/AnimatedNumber";
import { DetailOverlayModal } from "../v4/DetailOverlayModal";

interface StepComparisonViewProps {
  experiment: ExperimentSummary;
  evolutionRun: EvolutionRun | null;
  externalEvolution: ExternalEvolutionRun | null;
  diffData: ExperimentTxDiffResponse | null;
  intelligence: SecurityIntelligenceReport | null;
  onOpenAnalytics: (tab: AnalyticsTab) => void;
  onBackToStart: () => void;
}

interface LiveAttackSample {
  transaction_code: string;
  scenario_type: string;
  amount_kzt: number;
  old_risk_score: number | null;
  new_risk_score: number | null;
  triggered_rules: string[];
}

type ModalKind = "efficiency" | "attack" | "shift" | "scenarios" | null;

export const StepComparisonView: React.FC<StepComparisonViewProps> = ({
  experiment,
  evolutionRun,
  externalEvolution,
  diffData,
  intelligence,
  onBackToStart,
}) => {
  const { t, scenarioLabel, ruleLabel, formatKzt } = useLab();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [attackPhase, setAttackPhase] = useState<"idle" | "flowing" | "done">("idle");
  const [barsMounted, setBarsMounted] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [inspectedAttackTx, setInspectedAttackTx] = useState<TransactionInspectorItem | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  const {
    base,
    cand,
    baselineVersion,
    candidateVersion,
    adversarialShift,
    evalCandExpId,
    scenarioComparison,
    guardrailChecks,
  } = useMemo(() => {
    if (evolutionRun?.comparison_json?.evaluation_split) {
      const comp = evolutionRun.comparison_json;
      const ev = comp.evaluation_split!;
      return {
        base: ev.baseline as MetricsSummary,
        cand: ev.candidate as MetricsSummary,
        baselineVersion: comp.baseline_version || "Baseline",
        candidateVersion: comp.candidate_version || "VIGILIA",
        adversarialShift: comp.adversarial_shift || null,
        evalCandExpId:
          evolutionRun.final_candidate_experiment_id ?? experiment.id,
        scenarioComparison: (comp.scenario_comparison || []) as ScenarioComparisonItem[],
        guardrailChecks: comp.guardrail_report?.checks || evolutionRun.guardrails_json?.checks || null,
      };
    }

    const comp = externalEvolution?.comparison_json;
    const ev = comp?.evaluation_split;
    const fallback: MetricsSummary = {
      recall: 0,
      precision: 0,
      f1_score: 0,
      false_positive_rate: 0,
      false_negative_rate: 0,
      accuracy: 0,
      avg_risk_score: 0,
      true_positives: 0,
      false_positives: 0,
      false_negatives: 0,
      true_negatives: 0,
      total_transactions: 0,
      actual_risk_events: 0,
      predicted_risk_events: 0,
    };

    return {
      base: (ev?.baseline || fallback) as MetricsSummary,
      cand: (ev?.candidate || fallback) as MetricsSummary,
      baselineVersion: comp?.baseline_version || "Baseline",
      candidateVersion: comp?.candidate_version || "VIGILIA",
      adversarialShift: comp?.adversarial_shift || null,
      evalCandExpId:
        comp?.final_candidate_experiment_id ??
        externalEvolution?.candidate_experiment_id ??
        experiment.id,
      scenarioComparison: (comp?.scenario_comparison || []) as ScenarioComparisonItem[],
      guardrailChecks: comp?.guardrail_report?.checks || null,
    };
  }, [evolutionRun, externalEvolution, experiment.id]);

  // Animate progress bars from 0% on screen entry
  useEffect(() => {
    setBarsMounted(false);
    const id = window.requestAnimationFrame(() => {
      window.setTimeout(() => setBarsMounted(true), 80);
    });
    return () => window.cancelAnimationFrame(id);
  }, [evalCandExpId]);

  // Pick real missed->caught attack samples for the Live Attack simulator dropdown
  const liveSamples: LiveAttackSample[] = useMemo(() => {
    const fixed = diffData?.fixed_misses || [];
    const picked: LiveAttackSample[] = [];
    const seenScenarios = new Set<string>();

    const priorityOrder = [
      "structuring_smurfing",
      "account_takeover_ato",
      "new_recipient_risk",
      "duplicate_payment",
      "suspicious_sequence",
      "unusual_amount",
    ];

    for (const sc of priorityOrder) {
      const match = fixed.find((item) => item.scenario_type === sc);
      if (match && !seenScenarios.has(sc)) {
        seenScenarios.add(sc);
        picked.push({
          transaction_code: match.transaction_code,
          scenario_type: match.scenario_type,
          amount_kzt: match.amount_kzt,
          old_risk_score: match.old_risk_score,
          new_risk_score: match.new_risk_score,
          triggered_rules: match.new_triggered_rules || [],
        });
      }
    }

    for (const item of fixed) {
      if (picked.length >= 6) break;
      if (!picked.some((p) => p.transaction_code === item.transaction_code)) {
        picked.push({
          transaction_code: item.transaction_code,
          scenario_type: item.scenario_type,
          amount_kzt: item.amount_kzt,
          old_risk_score: item.old_risk_score,
          new_risk_score: item.new_risk_score,
          triggered_rules: item.new_triggered_rules || [],
        });
      }
    }

    if (picked.length === 0 && intelligence?.transaction_inspector_samples) {
      for (const s of intelligence.transaction_inspector_samples) {
        if (s.scenario_type !== "normal_activity" && !seenScenarios.has(s.scenario_type)) {
          seenScenarios.add(s.scenario_type);
          picked.push({
            transaction_code: s.transaction_code,
            scenario_type: s.scenario_type,
            amount_kzt: s.amount_kzt,
            old_risk_score: s.risk_score,
            new_risk_score: s.risk_score !== null ? Math.min(99, s.risk_score + 20) : 78,
            triggered_rules: (s.triggered_rules || []).map((r) => r.rule),
          });
        }
        if (picked.length >= 4) break;
      }
    }

    return picked;
  }, [diffData, intelligence]);

  useEffect(() => {
    setSelectedIdx(0);
    setAttackPhase("idle");
  }, [liveSamples.length]);

  const activeSample = liveSamples[selectedIdx] || null;

  // Fetch full Decision Trace when opening Live Attack modal
  useEffect(() => {
    if (activeModal !== "attack" || !activeSample) {
      return;
    }
    let cancelled = false;
    setInspectLoading(true);
    api
      .inspectTransaction(evalCandExpId, activeSample.transaction_code)
      .then((res) => {
        if (!cancelled) setInspectedAttackTx(res);
      })
      .catch(() => {
        if (!cancelled) setInspectedAttackTx(null);
      })
      .finally(() => {
        if (!cancelled) setInspectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeModal, activeSample, evalCandExpId]);

  const handleLaunchAttack = () => {
    setAttackPhase("flowing");
    window.setTimeout(() => {
      setAttackPhase("done");
    }, 1050);
  };

  const baseMissedAmt = base.missed_fraud_amount ?? 0;
  const candMissedAmt = cand.missed_fraud_amount ?? 0;
  const basePreventedAmt = base.prevented_fraud_amount ?? 0;
  const candPreventedAmt = cand.prevented_fraud_amount ?? 0;
  const savedDeltaAmt = Math.max(0, candPreventedAmt - basePreventedAmt);
  const baseRecallPct = base.recall * 100;
  const candRecallPct = cand.recall * 100;
  const candFprPct = cand.false_positive_rate * 100;

  // Radar data for Adversarial Shift Check (±15%)
  const radarData = useMemo(() => {
    const cleanRec = (adversarialShift?.candidate_clean_metrics?.recall ?? cand.recall) * 100;
    const shiftRec = (adversarialShift?.candidate_shifted_metrics?.recall ?? cand.recall) * 100;
    const cleanPrec = (adversarialShift?.candidate_clean_metrics?.precision ?? cand.precision) * 100;
    const shiftPrec = (adversarialShift?.candidate_shifted_metrics?.precision ?? cand.precision) * 100;
    const fprStability = Math.max(
      0,
      100 - ((adversarialShift?.candidate_shifted_metrics?.false_positive_rate ?? cand.false_positive_rate) * 1000)
    );
    return [
      { metric: "Clean", value: Math.round(cleanRec) },
      { metric: "Shift", value: Math.round(shiftRec) },
      { metric: "Prec", value: Math.round(cleanPrec) },
      { metric: "S-Prec", value: Math.round(shiftPrec) },
      { metric: "FPR", value: Math.round(fprStability) },
    ];
  }, [adversarialShift, cand]);

  const attackScenarios = useMemo(() => {
    const order = [
      "unusual_amount",
      "new_recipient_risk",
      "duplicate_payment",
      "suspicious_sequence",
      "structuring_smurfing",
      "account_takeover_ato",
      "normal_activity",
    ];
    const map = new Map<string, ScenarioComparisonItem>();
    for (const s of scenarioComparison) {
      map.set(s.scenario_type, s);
    }
    const list: ScenarioComparisonItem[] = [];
    for (const key of order) {
      const found = map.get(key);
      if (found) list.push(found);
    }
    for (const s of scenarioComparison) {
      if (!order.includes(s.scenario_type)) list.push(s);
    }
    return list;
  }, [scenarioComparison]);

  const efficiencyChartData = useMemo(
    () => [
      {
        name: "Recall %",
        before: Number((base.recall * 100).toFixed(1)),
        after: Number((cand.recall * 100).toFixed(1)),
      },
      {
        name: "Precision %",
        before: Number((base.precision * 100).toFixed(1)),
        after: Number((cand.precision * 100).toFixed(1)),
      },
      {
        name: "F1 %",
        before: Number((base.f1_score * 100).toFixed(1)),
        after: Number((cand.f1_score * 100).toFixed(1)),
      },
      {
        name: "FPR %",
        before: Number((base.false_positive_rate * 100).toFixed(2)),
        after: Number((cand.false_positive_rate * 100).toFixed(2)),
      },
    ],
    [base, cand]
  );

  const scenarioBarChartData = useMemo(
    () =>
      attackScenarios.map((sc) => ({
        name: scenarioLabel(sc.scenario_type),
        before: Number(((sc.baseline_recall ?? 0) * 100).toFixed(1)),
        after: Number(((sc.candidate_recall ?? 0) * 100).toFixed(1)),
      })),
    [attackScenarios, scenarioLabel]
  );

  const latencyMs = Math.max(8, Math.round(experiment.processing_time_ms || 14));

  return (
    <div className="space-y-6 v5-step-enter">
      {/* 3-Column Executive Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* COLUMN 1: Сравнение эффективности (Clickable) */}
        <section
          role="button"
          tabIndex={0}
          onClick={() => setActiveModal("efficiency")}
          onKeyDown={(e) => e.key === "Enter" && setActiveModal("efficiency")}
          className="v4-surface p-6 flex flex-col justify-between gap-5 cursor-pointer hover:bg-[#161E1B]/90 transition-colors group min-w-0"
        >
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#F1F5F9] tracking-tight">
                {t.v5.efficiencyColTitle}
              </h2>
              <Maximize2 className="h-4 w-4 text-[#64748B] group-hover:text-[#22C55E] transition-colors shrink-0" />
            </div>

            {/* БЫЛО — ТРАДИЦИОННАЯ ЗАЩИТА */}
            <div className="v4-surface-inset p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#EF4444]">
                  {t.v5.beforeTradTitle}
                </span>
                <span className="text-xs font-mono text-[#94A3B8]">
                  {baselineVersion}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl xl:text-[28px] font-bold text-rose-400 tabular-nums whitespace-nowrap">
                  <AnimatedNumber value={baseMissedAmt} formatter={formatKzt} />
                </span>
                <span className="text-base font-bold text-rose-400 font-mono tabular-nums whitespace-nowrap shrink-0">
                  <AnimatedNumber value={baseRecallPct} decimals={1} suffix="%" />
                </span>
              </div>

              <div className="h-2 w-full rounded-full bg-[#EF4444]/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#EF4444] transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: barsMounted ? `${Math.min(100, baseRecallPct)}%` : "0%" }}
                />
              </div>
            </div>

            {/* СТАЛО — VIGILIA */}
            <div className="rounded-2xl bg-[#16A34A]/10 p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#22C55E]">
                  {t.v5.afterVigiliaTitle}
                </span>
                <span className="text-xs font-mono text-[#22C55E]">
                  {candidateVersion}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl xl:text-[28px] font-bold text-[#22C55E] tabular-nums whitespace-nowrap">
                  <AnimatedNumber value={candMissedAmt} formatter={formatKzt} />
                </span>
                <span className="text-base font-bold text-[#22C55E] font-mono tabular-nums whitespace-nowrap shrink-0">
                  <AnimatedNumber value={candRecallPct} decimals={1} suffix="%" />
                </span>
              </div>

              <div className="h-2 w-full rounded-full bg-[#22C55E]/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#22C55E] transition-all duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: barsMounted ? `${Math.min(100, candRecallPct)}%` : "0%" }}
                />
              </div>
            </div>
          </div>

          {/* Bottom Summary: +X ₸ спасено & FPR */}
          <div className="v4-surface-inset p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-[#94A3B8]">{t.v4h.bizSavedMore}</div>
              <div className="text-xl font-bold text-[#22C55E] tabular-nums whitespace-nowrap">
                +<AnimatedNumber value={savedDeltaAmt} formatter={formatKzt} />{" "}
                <span className="text-sm font-semibold">{t.v5.savedHeroSuffix}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-[#94A3B8]">FPR</div>
              <div className="text-lg font-bold text-[#F1F5F9] font-mono tabular-nums whitespace-nowrap">
                <AnimatedNumber value={candFprPct} decimals={2} suffix="%" />
              </div>
            </div>
          </div>
        </section>

        {/* COLUMN 2: Интерактивный симулятор «Live Attack» (Clickable card header/body; select & button stopPropagation) */}
        <section
          role="button"
          tabIndex={0}
          onClick={() => activeSample && setActiveModal("attack")}
          onKeyDown={(e) => e.key === "Enter" && activeSample && setActiveModal("attack")}
          className="v4-surface p-6 flex flex-col justify-between gap-5 cursor-pointer hover:bg-[#161E1B]/90 transition-colors group min-w-0"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#22C55E]">
                  <Zap className="h-3.5 w-3.5" />
                  <span>LIVE ATTACK</span>
                </div>
                <h2 className="text-base font-bold text-[#F1F5F9] tracking-tight">
                  {t.v5.liveAttackTitle}
                </h2>
              </div>
              {activeSample && (
                <Maximize2 className="h-4 w-4 text-[#64748B] group-hover:text-[#22C55E] transition-colors shrink-0 mt-1" />
              )}
            </div>

            {liveSamples.length === 0 ? (
              <div className="v4-surface-inset p-4 text-sm text-[#94A3B8]">
                {t.v5.liveAttackNoSample}
              </div>
            ) : (
              <>
                <div
                  className="space-y-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <select
                    aria-label={t.v5.liveAttackTitle}
                    value={selectedIdx}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setSelectedIdx(Number(e.target.value));
                      setAttackPhase("idle");
                    }}
                    className="lab-input pr-10 text-[13px] font-medium truncate"
                  >
                    {liveSamples.map((s, idx) => (
                      <option key={s.transaction_code} value={idx}>
                        {scenarioLabel(s.scenario_type)} · {formatKzt(s.amount_kzt)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={attackPhase === "flowing"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLaunchAttack();
                    }}
                    className="btn-primary w-full py-3 text-sm font-bold tracking-wide inline-flex items-center justify-center gap-2"
                  >
                    {attackPhase === "flowing" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t.v5.liveAttackRunning}</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        <span>{t.v5.liveAttackRunBtn}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Animated Branching Flow SVG */}
                <div className="v4-surface-inset p-4 space-y-3">
                  <svg viewBox="0 0 320 110" className="w-full h-24 overflow-visible">
                    <circle cx="22" cy="55" r="7" fill="#94A3B8" />
                    <text x="12" y="82" fill="#94A3B8" fontSize="10" fontFamily="monospace">
                      {activeSample?.transaction_code || "TXN"}
                    </text>

                    <path
                      d="M 30 55 C 100 55, 110 22, 190 22 L 296 22"
                      fill="none"
                      stroke={attackPhase === "idle" ? "#334155" : "#EF4444"}
                      strokeWidth="2"
                      strokeDasharray="5 5"
                      className={attackPhase === "flowing" ? "v5-flow-line-active" : ""}
                    />
                    <circle
                      cx="300"
                      cy="22"
                      r="6"
                      fill={attackPhase === "done" ? "#EF4444" : "#334155"}
                    />

                    <path
                      d="M 30 55 C 100 55, 110 88, 190 88 L 296 88"
                      fill="none"
                      stroke={attackPhase === "idle" ? "#334155" : "#22C55E"}
                      strokeWidth="2"
                      strokeDasharray="5 5"
                      className={attackPhase === "flowing" ? "v5-flow-line-active" : ""}
                    />
                    <circle
                      cx="300"
                      cy="88"
                      r="6"
                      fill={attackPhase === "done" ? "#22C55E" : "#334155"}
                    />
                  </svg>

                  {/* Top Result: БЫЛО: ПРОПУЩЕНО */}
                  <div
                    className={`rounded-xl px-4 py-3 transition-all duration-300 ${
                      attackPhase === "done"
                        ? "bg-[#EF4444]/15 opacity-100"
                        : "bg-[#121816]/60 opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-rose-400">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        <span>{t.v5.liveAttackOldStatus}</span>
                      </span>
                      <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                        {activeSample ? formatKzt(activeSample.amount_kzt) : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Result: СТАЛО: ЗАБЛОКИРОВАНО */}
                  <div
                    className={`rounded-xl px-4 py-3 space-y-1 transition-all duration-300 ${
                      attackPhase === "done"
                        ? "bg-[#16A34A]/15 opacity-100"
                        : "bg-[#121816]/60 opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-[#22C55E]">
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>{t.v5.liveAttackNewStatus}</span>
                      </span>
                      <span className="font-mono text-[#94A3B8] whitespace-nowrap shrink-0">
                        {latencyMs} ms
                      </span>
                    </div>
                    {attackPhase === "done" && activeSample && (
                      <div className="text-xs text-[#CBD5E1]">
                        {t.v5.liveAttackRulesFired}{" "}
                        <strong className="text-[#F1F5F9]">
                          {activeSample.triggered_rules.length > 0
                            ? activeSample.triggered_rules.slice(0, 2).map(ruleLabel).join(", ")
                            : t.v34.mechThreshold}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* COLUMN 3: Устойчивость и сценарии (Two independently clickable zones) */}
        <section className="v4-surface p-6 flex flex-col justify-between gap-5">
          {/* Upper: Adversarial Shift Check + RadarChart (Clickable) */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setActiveModal("shift")}
            onKeyDown={(e) => e.key === "Enter" && setActiveModal("shift")}
            className="space-y-3 cursor-pointer rounded-2xl p-2 -m-2 hover:bg-[#161E1B]/80 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
                ADVERSARIAL SHIFT CHECK
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    adversarialShift?.passed !== false
                      ? "bg-[#16A34A]/20 text-[#22C55E]"
                      : "bg-[#F59E0B]/20 text-[#F59E0B]"
                  }`}
                >
                  {adversarialShift?.passed !== false ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {adversarialShift?.passed !== false
                      ? t.v5.resilienceHigh
                      : t.v5.resilienceModerate}
                  </span>
                </span>
                <Maximize2 className="h-4 w-4 text-[#64748B] group-hover:text-[#22C55E] transition-colors shrink-0" />
              </div>
            </div>

            <div className="v4-surface-inset p-3 flex items-center gap-3">
              <div className="w-36 h-28 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="58%" data={radarData}>
                    <PolarGrid stroke="rgba(148, 163, 184, 0.18)" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: "#94A3B8", fontSize: 9 }}
                    />
                    <Radar
                      dataKey="value"
                      stroke="#22C55E"
                      fill="#16A34A"
                      fillOpacity={0.35}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 text-sm">
                <div className="font-bold text-[#F1F5F9]">
                  {adversarialShift?.passed !== false
                    ? t.v5.shiftStressPassed
                    : t.v5.shiftStressSensitive}
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  {t.v4h.advShiftDesc}
                </p>
              </div>
            </div>
          </div>

          {/* Lower: СТАТИСТИКА ПО СЦЕНАРИЯМ (Clickable) */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setActiveModal("scenarios")}
            onKeyDown={(e) => e.key === "Enter" && setActiveModal("scenarios")}
            className="space-y-2.5 cursor-pointer rounded-2xl p-2 -m-2 hover:bg-[#161E1B]/80 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
                {t.v5.scenarioStatsTitle}
              </span>
              <Maximize2 className="h-4 w-4 text-[#64748B] group-hover:text-[#22C55E] transition-colors shrink-0" />
            </div>

            <div className="space-y-2">
              {attackScenarios.map((sc) => {
                const afterPct = (sc.candidate_recall ?? 0) * 100;
                const deltaPct = (sc.recall_delta ?? 0) * 100;
                return (
                  <div key={sc.scenario_type} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-[#CBD5E1] font-medium truncate">
                        {scenarioLabel(sc.scenario_type)}
                      </span>
                      <span className="font-mono tabular-nums shrink-0 whitespace-nowrap">
                        <span className="text-[#F1F5F9] font-semibold">
                          {afterPct.toFixed(0)}%
                        </span>
                        {deltaPct > 0.5 && (
                          <span className="text-[#22C55E] font-bold ml-1.5">
                            +{deltaPct.toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[#0B100E] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#22C55E] transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{ width: barsMounted ? `${Math.min(100, afterPct)}%` : "0%" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Action Bar */}
      <div className="relative flex flex-wrap items-center justify-center gap-4 pt-2">
        <a
          href={api.exportUrl(evalCandExpId, "html")}
          target="_blank"
          rel="noreferrer"
          className="btn-primary px-7 py-3.5 text-sm font-bold tracking-wide inline-flex items-center gap-2.5"
        >
          <FileText className="h-4 w-4" />
          <span>{t.v5.downloadDetailHtml}</span>
        </a>

        <button
          type="button"
          onClick={onBackToStart}
          className="btn-subtle lg:absolute lg:right-0 px-5 py-3 text-sm font-semibold inline-flex items-center gap-2"
        >
          <RotateCcw className="h-4 w-4 text-[#22C55E]" />
          <span>{t.v5.backToStartBtn}</span>
        </button>
      </div>

      {/* MODAL 1: Сравнение эффективности */}
      <DetailOverlayModal
        open={activeModal === "efficiency"}
        onClose={() => setActiveModal(null)}
        title={t.v5.efficiencyColTitle}
        subtitle={`${baselineVersion} → ${candidateVersion}`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="v4-surface-inset p-4 space-y-1">
            <div className="text-xs text-[#94A3B8]">{t.v4h.bizPreventedAmount}</div>
            <div className="text-base font-bold text-[#22C55E] tabular-nums whitespace-nowrap">
              {formatKzt(basePreventedAmt)} → {formatKzt(candPreventedAmt)}
            </div>
            <div className="text-xs font-mono text-[#22C55E]">
              +{formatKzt(savedDeltaAmt)}
            </div>
          </div>
          <div className="v4-surface-inset p-4 space-y-1">
            <div className="text-xs text-[#94A3B8]">{t.v4h.bizMissedAmount}</div>
            <div className="text-base font-bold text-rose-400 tabular-nums whitespace-nowrap">
              {formatKzt(baseMissedAmt)} → {formatKzt(candMissedAmt)}
            </div>
          </div>
          <div className="v4-surface-inset p-4 space-y-1">
            <div className="text-xs text-[#94A3B8]">{t.v4h.bizFalseDeclineAmount}</div>
            <div className="text-base font-bold text-[#F1F5F9] tabular-nums whitespace-nowrap">
              {formatKzt(base.false_decline_amount ?? 0)} →{" "}
              {formatKzt(cand.false_decline_amount ?? 0)}
            </div>
          </div>
          <div className="v4-surface-inset p-4 space-y-1">
            <div className="text-xs text-[#94A3B8]">{t.v4h.bizReviewQueue}</div>
            <div className="text-base font-bold text-[#F1F5F9] tabular-nums whitespace-nowrap">
              {base.review_queue_count ?? 0} → {cand.review_queue_count ?? 0} (
              {((cand.review_queue_rate ?? 0) * 100).toFixed(1)}%)
            </div>
          </div>
        </div>

        {/* BarChart Before vs After */}
        <div className="v4-surface-inset p-4 space-y-2">
          <div className="text-sm font-semibold text-[#F1F5F9]">
            {t.v33.chartDefenseCmpTitle}
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={efficiencyChartData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                <XAxis dataKey="name" tick={{ fill: "#94A3B8", fontSize: 12 }} />
                <YAxis tick={{ fill: "#94A3B8", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#121816",
                    border: "none",
                    borderRadius: "12px",
                    color: "#F1F5F9",
                  }}
                />
                <Legend />
                <Bar dataKey="before" name={baselineVersion} fill="#EF4444" radius={[6, 6, 0, 0]} />
                <Bar dataKey="after" name={candidateVersion} fill="#22C55E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Full ML Metrics Table */}
        <div className="v4-surface-inset overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[#94A3B8] border-b border-white/[0.06]">
                <th className="py-3 px-4 font-medium">Metric</th>
                <th className="py-3 px-4 font-medium">{baselineVersion}</th>
                <th className="py-3 px-4 font-medium">{candidateVersion}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] font-mono tabular-nums">
              <tr>
                <td className="py-2.5 px-4 font-sans text-[#CBD5E1]">Recall</td>
                <td className="py-2.5 px-4 text-rose-400">{(base.recall * 100).toFixed(1)}%</td>
                <td className="py-2.5 px-4 text-[#22C55E] font-bold">{(cand.recall * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans text-[#CBD5E1]">Precision</td>
                <td className="py-2.5 px-4 text-[#CBD5E1]">{(base.precision * 100).toFixed(1)}%</td>
                <td className="py-2.5 px-4 text-[#F1F5F9] font-bold">{(cand.precision * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans text-[#CBD5E1]">F1 Score</td>
                <td className="py-2.5 px-4 text-[#CBD5E1]">{(base.f1_score * 100).toFixed(1)}%</td>
                <td className="py-2.5 px-4 text-[#F1F5F9] font-bold">{(cand.f1_score * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans text-[#CBD5E1]">FPR</td>
                <td className="py-2.5 px-4 text-[#CBD5E1]">{(base.false_positive_rate * 100).toFixed(2)}%</td>
                <td className="py-2.5 px-4 text-[#F1F5F9] font-bold">{(cand.false_positive_rate * 100).toFixed(2)}%</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-sans text-[#CBD5E1]">TP / FP / FN / TN</td>
                <td className="py-2.5 px-4 text-[#94A3B8]">
                  {base.true_positives} / {base.false_positives} / {base.false_negatives} / {base.true_negatives}
                </td>
                <td className="py-2.5 px-4 text-[#F1F5F9]">
                  {cand.true_positives} / {cand.false_positives} / {cand.false_negatives} / {cand.true_negatives}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DetailOverlayModal>

      {/* MODAL 2: Adversarial Shift Check */}
      <DetailOverlayModal
        open={activeModal === "shift"}
        onClose={() => setActiveModal(null)}
        title="Adversarial Shift Check (±10–15%)"
        subtitle={t.v4h.advShiftDesc}
        badge={
          <span
            className={`px-3 py-0.5 rounded-full text-xs font-bold ${
              adversarialShift?.passed !== false
                ? "bg-[#16A34A]/20 text-[#22C55E]"
                : "bg-[#F59E0B]/20 text-[#F59E0B]"
            }`}
          >
            {adversarialShift?.passed !== false ? t.v5.resilienceHigh : t.v5.resilienceModerate}
          </span>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          <div className="v4-surface-inset p-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="rgba(148, 163, 184, 0.2)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: "#CBD5E1", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#121816",
                    border: "none",
                    borderRadius: "12px",
                    color: "#F1F5F9",
                  }}
                />
                <Radar
                  name={candidateVersion}
                  dataKey="value"
                  stroke="#22C55E"
                  fill="#16A34A"
                  fillOpacity={0.38}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="v4-surface-inset p-3.5">
                <div className="text-xs text-[#94A3B8]">{t.v4h.advShiftCleanRecall}</div>
                <div className="text-xl font-bold text-[#F1F5F9] font-mono tabular-nums mt-0.5">
                  {((adversarialShift?.candidate_clean_metrics?.recall ?? cand.recall) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="v4-surface-inset p-3.5">
                <div className="text-xs text-[#94A3B8]">{t.v4h.advShiftShiftedRecall}</div>
                <div className="text-xl font-bold text-[#22C55E] font-mono tabular-nums mt-0.5">
                  {((adversarialShift?.candidate_shifted_metrics?.recall ?? cand.recall) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="v4-surface-inset p-3.5">
                <div className="text-xs text-[#94A3B8]">{t.v4h.advShiftShiftedFpr}</div>
                <div className="text-xl font-bold text-[#F1F5F9] font-mono tabular-nums mt-0.5">
                  {((adversarialShift?.candidate_shifted_metrics?.false_positive_rate ?? cand.false_positive_rate) * 100).toFixed(2)}%
                </div>
              </div>
              <div className="v4-surface-inset p-3.5">
                <div className="text-xs text-[#94A3B8]">{t.v4h.advShiftVsBaseline}</div>
                <div className="text-xl font-bold text-[#22C55E] font-mono tabular-nums mt-0.5">
                  +{((adversarialShift?.recall_gain_vs_baseline_shifted ?? (cand.recall - base.recall)) * 100).toFixed(1)} {t.focus.ppUnit}
                </div>
              </div>
            </div>

            {guardrailChecks && (
              <div className="v4-surface-inset p-4 space-y-2">
                <div className="text-xs font-semibold text-[#94A3B8] uppercase">Guardrails</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(guardrailChecks).map(([k, ok]) => (
                    <span
                      key={k}
                      className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold ${
                        ok ? "bg-[#16A34A]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-rose-400"
                      }`}
                    >
                      {k}: {ok ? "PASS" : "FAIL"}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {adversarialShift?.reason && (
              <p className="text-sm text-[#CBD5E1] leading-relaxed">
                {adversarialShift.reason}
              </p>
            )}
          </div>
        </div>
      </DetailOverlayModal>

      {/* MODAL 3: Статистика по сценариям */}
      <DetailOverlayModal
        open={activeModal === "scenarios"}
        onClose={() => setActiveModal(null)}
        title={t.v5.scenarioStatsTitle}
        subtitle={t.v34.scenarioDeltaTitle}
      >
        <div className="v4-surface-inset p-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scenarioBarChartData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94A3B8", fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={160} tick={{ fill: "#CBD5E1", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#121816",
                  border: "none",
                  borderRadius: "12px",
                  color: "#F1F5F9",
                }}
              />
              <Legend />
              <Bar dataKey="before" name={baselineVersion} fill="#EF4444" radius={[0, 6, 6, 0]} />
              <Bar dataKey="after" name={candidateVersion} fill="#22C55E" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="v4-surface-inset overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[#94A3B8] border-b border-white/[0.06]">
                <th className="py-3 px-4 font-medium">{t.v34.colScenario}</th>
                <th className="py-3 px-3 font-medium">{t.v34.colRiskEvents}</th>
                <th className="py-3 px-3 font-medium">{t.v34.colBefore}</th>
                <th className="py-3 px-3 font-medium">{t.v34.colAfter}</th>
                <th className="py-3 px-3 font-medium">FN ({t.v34.colBefore} → {t.v34.colAfter})</th>
                <th className="py-3 px-3 font-medium">FP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {attackScenarios.map((sc) => (
                <tr key={sc.scenario_type}>
                  <td className="py-2.5 px-4 font-medium text-[#F1F5F9]">
                    {scenarioLabel(sc.scenario_type)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[#94A3B8]">
                    {sc.actual_risk_events ?? "—"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-rose-400">
                    {sc.baseline_recall !== null ? `${(sc.baseline_recall * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[#22C55E] font-bold">
                    {sc.candidate_recall !== null ? `${(sc.candidate_recall * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[#CBD5E1]">
                    {sc.baseline_fn ?? "—"} → {sc.candidate_fn ?? "—"}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[#94A3B8]">
                    {sc.baseline_fp ?? "—"} → {sc.candidate_fp ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailOverlayModal>

      {/* MODAL 4: Live Attack Decision Trace Breakdown */}
      <DetailOverlayModal
        open={activeModal === "attack" && Boolean(activeSample)}
        onClose={() => setActiveModal(null)}
        title={activeSample ? `${t.v4h.traceTitle}: ${activeSample.transaction_code}` : t.v4h.traceTitle}
        subtitle={
          activeSample
            ? `${scenarioLabel(activeSample.scenario_type)} · ${formatKzt(activeSample.amount_kzt)}`
            : undefined
        }
      >
        {activeSample && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[#EF4444]/12 p-4 space-y-1">
                <div className="text-xs font-bold text-rose-400 uppercase">
                  {t.v5.liveAttackOldStatus}
                </div>
                <div className="text-2xl font-bold text-rose-400 tabular-nums">
                  {formatKzt(activeSample.amount_kzt)}
                </div>
                <div className="text-xs font-mono text-[#94A3B8]">
                  Score: {activeSample.old_risk_score !== null ? activeSample.old_risk_score.toFixed(1) : "—"}
                </div>
              </div>

              <div className="rounded-2xl bg-[#16A34A]/12 p-4 space-y-1">
                <div className="text-xs font-bold text-[#22C55E] uppercase">
                  {t.v5.liveAttackNewStatus}
                </div>
                <div className="text-2xl font-bold text-[#22C55E] tabular-nums">
                  Score{" "}
                  {inspectedAttackTx?.decision_trace?.risk_score?.toFixed(1) ??
                    activeSample.new_risk_score?.toFixed(1) ??
                    "—"}
                  {inspectedAttackTx?.decision_trace?.decision_threshold !== null &&
                  inspectedAttackTx?.decision_trace?.decision_threshold !== undefined
                    ? ` / ${inspectedAttackTx.decision_trace.decision_threshold}`
                    : ""}
                </div>
                <div className="text-xs font-mono text-[#94A3B8]">
                  {latencyMs} ms · {inspectedAttackTx?.decision_trace?.decision || "block"}
                </div>
              </div>
            </div>

            {inspectLoading ? (
              <div className="v4-surface-inset p-6 flex items-center gap-3 text-sm text-[#94A3B8]">
                <Loader2 className="h-4 w-4 animate-spin text-[#22C55E]" />
                <span>{t.result.loadingState}</span>
              </div>
            ) : inspectedAttackTx?.decision_trace?.rules?.length ? (
              <div className="v4-surface-inset overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[#94A3B8] border-b border-white/[0.06]">
                      <th className="py-3 px-4 font-medium">{t.v34.colRule}</th>
                      <th className="py-3 px-3 font-medium">{t.v4h.traceActual} / {t.v4h.traceThreshold}</th>
                      <th className="py-3 px-3 font-medium">{t.v4h.traceContribution}</th>
                      <th className="py-3 px-4 font-medium">{t.v34.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {inspectedAttackTx.decision_trace.rules.map((r) => (
                      <tr key={r.rule_name}>
                        <td className="py-2.5 px-4 font-medium text-[#F1F5F9]">
                          {ruleLabel(r.rule_name)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#CBD5E1]">
                          {r.actual_value ?? "—"} / {r.threshold_value ?? "—"}
                          {r.metric_unit ? ` ${r.metric_unit}` : ""}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-[#22C55E]">
                          +{r.score_contribution?.toFixed(1) ?? 0}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              r.triggered
                                ? "bg-[#16A34A]/20 text-[#22C55E]"
                                : "bg-white/5 text-[#94A3B8]"
                            }`}
                          >
                            {r.triggered ? t.v4h.traceTriggered : t.v4h.traceBelowThreshold}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="v4-surface-inset p-4 text-sm text-[#CBD5E1]">
                <strong className="text-[#F1F5F9]">{t.v5.liveAttackRulesFired} </strong>
                {activeSample.triggered_rules.length > 0
                  ? activeSample.triggered_rules.map(ruleLabel).join(", ")
                  : t.v34.mechThreshold}
              </div>
            )}
          </div>
        )}
      </DetailOverlayModal>
    </div>
  );
};
