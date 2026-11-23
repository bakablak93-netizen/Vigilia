import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  FileJson,
  FileSpreadsheet,
  Loader2,
  Play,
} from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { BenchmarkRun } from "../../types/api";
import { StabilityComparisonChart } from "../charts/SecurityCharts";
import { DeltaBadge } from "../MetricCard";

interface StabilitySectionProps {
  baselineConfigId: number;
  candidateConfigId: number | null;
  activeBenchmark: BenchmarkRun | null;
  onBenchmarkCompleted: (bm: BenchmarkRun) => void;
  defaultOpenTable?: boolean;
}

export const StabilitySection: React.FC<StabilitySectionProps> = ({
  baselineConfigId,
  candidateConfigId,
  activeBenchmark,
  onBenchmarkCompleted,
  defaultOpenTable = false,
}) => {
  const { t, verdictLabel } = useLab();
  const queryClient = useQueryClient();

  const [showTable, setShowTable] = useState(defaultOpenTable);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const bmMutation = useMutation({
    mutationFn: () =>
      api.runBenchmark({
        name: "Multi-Seed Stability Check",
        transaction_count: 1000,
        customer_count: 100,
        risk_ratio: 0.05,
        seeds: [42, 101, 202, 303, 404],
        scenarios: [
          "normal_activity",
          "unusual_amount",
          "new_recipient_risk",
          "duplicate_payment",
          "suspicious_sequence",
          "structuring_smurfing",
          "account_takeover_ato",
        ],
        split_name: "evaluation",
        baseline_config_id: baselineConfigId,
        candidate_config_id: candidateConfigId,
      }),
    onSuccess: (bm) => {
      setErrorMsg(null);
      onBenchmarkCompleted(bm);
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const agg = activeBenchmark?.aggregated_metrics_json;
  const targetMacro = agg?.candidate?.macro || agg?.baseline?.macro;
  const cmp = activeBenchmark?.comparison_summary_json;

  return (
    <section id="stability" className="rounded-2xl bg-[#171A18] p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#43D17A]" />
          <h2 className="text-base font-bold text-[#F4F6F4]">
            {t.stability.sectionTitle}
          </h2>
        </div>

        <button
          type="button"
          onClick={() => bmMutation.mutate()}
          disabled={bmMutation.isPending}
          className="lab-btn-accent shrink-0 text-xs py-2 px-4"
        >
          {bmMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span>{bmMutation.isPending ? t.stability.runningBtn : t.stability.actionBtn}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-[#F16B6B]/10 p-3 text-xs text-[#F16B6B]">
          {errorMsg}
        </div>
      )}

      {activeBenchmark && agg && targetMacro && (
        <div className="space-y-4 pt-3 border-t border-white/[0.06]">
          {/* Compact Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-[#202522]">
              <div className="text-[#77837C]">{t.stability.runsCount}</div>
              <div className="text-lg font-bold tabular-nums text-[#F4F6F4] mt-1">
                {activeBenchmark.completed_runs} / {activeBenchmark.total_runs}
              </div>
              {cmp?.seed_f1_wins !== undefined && (
                <div className="text-[11px] text-[#A1ABA4] mt-0.5 tabular-nums">
                  {t.v33.stabilityWins}: {cmp.seed_f1_wins}/{activeBenchmark.total_runs}
                </div>
              )}
            </div>
            <div className="p-3.5 rounded-xl bg-[#202522]">
              <div className="text-[#77837C]">{t.stability.meanRecall}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold tabular-nums text-[#43D17A]">
                  {(targetMacro.recall.mean * 100).toFixed(1)}%
                </span>
                {cmp?.macro_deltas?.recall !== undefined && (
                  <DeltaBadge
                    deltaValue={cmp.macro_deltas.recall}
                    higherIsBetter={true}
                    unitLabel={t.focus.ppUnit}
                  />
                )}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#202522]">
              <div className="text-[#77837C]">{t.stability.meanFpr}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold tabular-nums text-[#F4F6F4]">
                  {(targetMacro.false_positive_rate.mean * 100).toFixed(2)}%
                </span>
                {cmp?.macro_deltas?.false_positive_rate !== undefined && (
                  <DeltaBadge
                    deltaValue={cmp.macro_deltas.false_positive_rate}
                    higherIsBetter={false}
                    decimals={2}
                    unitLabel={t.focus.ppUnit}
                  />
                )}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#202522]">
              <div className="text-[#77837C]">{t.v33.stabilityMinMax}</div>
              <div className="text-sm font-bold tabular-nums text-[#F4F6F4] mt-1.5">
                {(targetMacro.recall.min * 100).toFixed(1)}% –{" "}
                {(targetMacro.recall.max * 100).toFixed(1)}%
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#202522]">
              <div className="text-[#77837C]">{t.stability.varianceLabel}</div>
              <div className="text-lg font-bold tabular-nums text-[#F4F6F4] mt-1">
                ±{(targetMacro.recall.std * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Graph 6 — Stability Comparison */}
          <StabilityComparisonChart
            rows={activeBenchmark.per_seed_results_json}
            baselineLabel={cmp?.baseline_version || t.stability.baseCol}
            candidateLabel={cmp?.candidate_version || t.stability.candCol}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <strong className="text-[#F4F6F4]">{t.stability.conclusionLabel}:</strong>{" "}
              <span className="text-[#A1ABA4]">
                {cmp?.verdict ? verdictLabel(cmp.verdict) : activeBenchmark.status}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={api.benchmarkExportUrl(activeBenchmark.id, "json")}
                download
                className="lab-btn-secondary py-1.5 px-3 text-xs"
              >
                <FileJson className="h-3.5 w-3.5 text-[#43D17A]" />
                <span>{t.stability.exportJson}</span>
              </a>
              <a
                href={api.benchmarkExportUrl(activeBenchmark.id, "csv")}
                download
                className="lab-btn-secondary py-1.5 px-3 text-xs"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#43D17A]" />
                <span>{t.stability.exportCsv}</span>
              </a>
              <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                className="lab-btn-secondary py-1.5 px-3 text-xs"
              >
                {showTable ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>{showTable ? t.stability.hideTableBtn : t.stability.tableBtn}</span>
              </button>
            </div>
          </div>

          {showTable && (
            <div className="overflow-x-auto rounded-2xl bg-[#202522]">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-[#101211]/50 text-[#77837C]">
                  <tr>
                    <th className="px-4 py-2.5 text-left">{t.stability.seedCol}</th>
                    <th className="px-3 py-2.5 text-right">
                      {t.stability.baseCol} ({t.result.colDetection})
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      {t.stability.baseCol} ({t.result.colFpr})
                    </th>
                    {agg.candidate && (
                      <>
                        <th className="px-3 py-2.5 text-right">
                          {t.stability.candCol} ({t.result.colDetection})
                        </th>
                        <th className="px-3 py-2.5 text-right">
                          {t.stability.candCol} ({t.result.colFpr})
                        </th>
                        <th className="px-4 py-2.5 text-right">{t.result.colFpr} Δ</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {activeBenchmark.per_seed_results_json.map((row) => (
                    <tr key={row.seed}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#F4F6F4]">
                        {row.seed}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#A1ABA4]">
                        {(row.baseline.recall * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#A1ABA4]">
                        {(row.baseline.false_positive_rate * 100).toFixed(2)}%
                      </td>
                      {row.candidate && row.delta && (
                        <>
                          <td className="px-3 py-2.5 text-right font-bold text-[#43D17A]">
                            {(row.candidate.recall * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#F4F6F4]">
                            {(row.candidate.false_positive_rate * 100).toFixed(2)}%
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <DeltaBadge
                              deltaValue={row.delta.false_positive_rate}
                              higherIsBetter={false}
                              decimals={2}
                              unitLabel={t.focus.ppUnit}
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
