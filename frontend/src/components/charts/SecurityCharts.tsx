import React, { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLab } from "../../context/LabContext";
import type {
  BenchmarkSeedResult,
  MetricsSummary,
  RiskDistributionBucket,
  ScenarioMetric,
} from "../../types/api";
import {
  buildDefenseComparisonChartExplain,
  buildDetectionChartExplain,
  buildErrorChartExplain,
  buildRiskDistChartExplain,
  buildScenarioChartExplain,
  buildStabilityChartExplain,
} from "../../utils/humanExplain";
import { ChartExplainer } from "../v4/ChartExplainer";

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "#0D110F",
  border: "none",
  borderRadius: "14px",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.08), 0 16px 36px rgba(0,0,0,0.68)",
  color: "#F4F6F4",
  fontSize: "12px",
};

const AXIS_TICK = { fill: "#A1ABA4", fontSize: 11 };
const GRID_STROKE = "rgba(255,255,255,0.06)";

/* -------------------------------------------------------------------------- */
/* 1. Detection Overview (TP + FN stacked bar, FP strictly separate)          */
/* -------------------------------------------------------------------------- */
interface DetectionOverviewChartProps {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
}

export const DetectionOverviewChart: React.FC<DetectionOverviewChartProps> = ({
  tp,
  fn,
  fp,
  tn,
}) => {
  const { t, lang } = useLab();
  const actualRisks = tp + fn;
  const totalLegit = fp + tn;
  const tpPct = actualRisks > 0 ? (tp / actualRisks) * 100 : 0;
  const fnPct = actualRisks > 0 ? (fn / actualRisks) * 100 : 0;
  const fprPct = totalLegit > 0 ? (fp / totalLegit) * 100 : 0;
  const explain = buildDetectionChartExplain(tp, fn, fp, tn, lang);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-[#A1ABA4]">
          {t.v33.detectionOverviewTitle}
        </span>
        <div className="flex items-center gap-4 tabular-nums">
          <span className="inline-flex items-center gap-1.5 text-[#43D17A]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#00B846]" />
            <span>
              {t.v33.tpLegend}: <strong>{tp}</strong> ({tpPct.toFixed(1)}%)
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#E3AD56]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#E3AD56]" />
            <span>
              {t.v33.fnLegend}: <strong>{fn}</strong> ({fnPct.toFixed(1)}%)
            </span>
          </span>
        </div>
      </div>

      {actualRisks > 0 ? (
        <div className="h-4 w-full rounded-full bg-[#202522] overflow-hidden flex">
          {tp > 0 && (
            <div
              className="h-full bg-[#00B846] transition-all duration-300"
              style={{ width: `${tpPct}%` }}
              title={`${t.v33.tpLegend}: ${tp} (${tpPct.toFixed(1)}%)`}
            />
          )}
          {fn > 0 && (
            <div
              className="h-full bg-[#E3AD56] transition-all duration-300"
              style={{ width: `${fnPct}%` }}
              title={`${t.v33.fnLegend}: ${fn} (${fnPct.toFixed(1)}%)`}
            />
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-[#202522] px-4 py-2.5 text-xs text-[#A1ABA4]">
          {t.focus.noRisksInSample}
        </div>
      )}

      {/* Separate denominator block for False Positives */}
      <div className="rounded-xl bg-[#202522] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
        <span className="text-[#A1ABA4]">{t.v33.fpSeparateNote}</span>
        <span
          className={`font-semibold ${
            fp > 0 ? "text-[#F16B6B]" : "text-[#43D17A]"
          }`}
        >
          {fp} / {totalLegit} {t.v33.legitOpsLabel} ({fprPct.toFixed(2)}%)
        </span>
      </div>

      <ChartExplainer content={explain} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. Scenario Detection Chart                                                */
/* -------------------------------------------------------------------------- */
interface ScenarioDetectionChartProps {
  scenarios: ScenarioMetric[];
}

export const ScenarioDetectionChart: React.FC<ScenarioDetectionChartProps> = ({
  scenarios,
}) => {
  const { t, lang, scenarioLabel } = useLab();
  const explain = buildScenarioChartExplain(scenarios, scenarioLabel, lang);
  const data = scenarios
    .filter((s) => s.actual_risk_events > 0 || s.false_positives > 0)
    .map((s) => ({
      name: scenarioLabel(s.scenario_type),
      detected: s.true_positives,
      missed: s.false_negatives,
      falseBlocks: s.false_positives,
      recallLabel:
        s.actual_risk_events > 0 ? `${(s.recall * 100).toFixed(1)}%` : "—",
    }));

  if (data.length === 0) {
    return (
      <div className="rounded-xl bg-[#202522] p-6 text-center text-xs text-[#77837C]">
        {t.focus.noProblemsNote}
      </div>
    );
  }

  return (
    <div className="dp-elevated p-4 space-y-3">
      <div className="text-xs font-semibold text-[#F4F6F4]">
        {t.v33.chartScenarioTitle}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
          >
            <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={145}
              tick={AXIS_TICK}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#A1ABA4" }} />
            <Bar
              dataKey="detected"
              name={t.v33.tpLegend}
              stackId="risk"
              fill="#00B846"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="missed"
              name={t.v33.fnLegend}
              stackId="risk"
              fill="#E3AD56"
              radius={[0, 6, 6, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartExplainer content={explain} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. Error Composition Chart                                                 */
/* -------------------------------------------------------------------------- */
interface ErrorCompositionChartProps {
  scenarios: ScenarioMetric[];
}

export const ErrorCompositionChart: React.FC<ErrorCompositionChartProps> = ({
  scenarios,
}) => {
  const { t, lang, scenarioLabel } = useLab();
  const explain = buildErrorChartExplain(scenarios, scenarioLabel, lang);
  const data = scenarios
    .filter((s) => s.false_negatives > 0 || s.false_positives > 0)
    .map((s) => ({
      name: scenarioLabel(s.scenario_type),
      fn: s.false_negatives,
      fp: s.false_positives,
    }));

  if (data.length === 0) {
    return (
      <div className="rounded-2xl bg-[#202522] p-6 text-center text-xs text-[#43D17A]">
        {t.detect.noWeaknesses}
      </div>
    );
  }

  return (
    <div className="dp-elevated p-4 space-y-3">
      <div className="text-xs font-semibold text-[#F4F6F4]">
        {t.v33.chartErrorTitle}
      </div>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
          >
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="name" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#A1ABA4" }} />
            <Bar
              dataKey="fn"
              name={t.result.fnTitle}
              fill="#E3AD56"
              radius={[6, 6, 0, 0]}
            />
            <Bar
              dataKey="fp"
              name={t.result.fpTitle}
              fill="#F16B6B"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartExplainer content={explain} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. Risk Score Distribution Histogram (0-100)                               */
/* -------------------------------------------------------------------------- */
interface RiskDistributionChartProps {
  available: boolean;
  buckets: RiskDistributionBucket[];
}

export const RiskDistributionChart: React.FC<RiskDistributionChartProps> = ({
  available,
  buckets,
}) => {
  const { t, lang } = useLab();
  const [view, setView] = useState<"truth" | "outcome">("truth");
  const explain = buildRiskDistChartExplain(available, buckets, lang);

  if (!available || buckets.length === 0) {
    return (
      <div className="rounded-2xl bg-[#202522] p-8 text-center space-y-2">
        <div className="text-sm font-semibold text-[#F4F6F4]">
          {t.v33.chartRiskDistTitle}
        </div>
        <div className="text-xs text-[#A1ABA4]">
          {t.v33.chartRiskDistUnavailable}
        </div>
      </div>
    );
  }

  return (
    <div className="dp-elevated p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#F4F6F4]">
          {t.v33.chartRiskDistTitle}
        </div>
        <div className="flex gap-1 rounded-xl bg-[#171A18] p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setView("truth")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              view === "truth"
                ? "bg-[#008F36] text-[#F4F6F4]"
                : "text-[#77837C] hover:text-[#F4F6F4]"
            }`}
          >
            {t.v33.distLegit} / {t.v33.distRisky}
          </button>
          <button
            type="button"
            onClick={() => setView("outcome")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              view === "outcome"
                ? "bg-[#008F36] text-[#F4F6F4]"
                : "text-[#77837C] hover:text-[#F4F6F4]"
            }`}
          >
            {t.v33.distDetected} / {t.v33.distMissed}
          </button>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={buckets}
            margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
          >
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="range" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#A1ABA4" }} />
            {view === "truth" ? (
              <>
                <Bar
                  dataKey="legitimate"
                  name={t.v33.distLegit}
                  fill="#4A5550"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="risky"
                  name={t.v33.distRisky}
                  fill="#00B846"
                  radius={[4, 4, 0, 0]}
                />
              </>
            ) : (
              <>
                <Bar
                  dataKey="detected"
                  name={t.v33.distDetected}
                  fill="#43D17A"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="missed"
                  name={t.v33.distMissed}
                  fill="#E3AD56"
                  radius={[4, 4, 0, 0]}
                />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {explain && <ChartExplainer content={explain} />}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 5. Defense Comparison Chart (Before vs After)                              */
/* -------------------------------------------------------------------------- */
interface DefenseComparisonChartProps {
  baseline: MetricsSummary;
  candidate: MetricsSummary;
  baselineLabel: string;
  candidateLabel: string;
}

export const DefenseComparisonChart: React.FC<DefenseComparisonChartProps> = ({
  baseline,
  candidate,
  baselineLabel,
  candidateLabel,
}) => {
  const { t, lang } = useLab();
  const explain = buildDefenseComparisonChartExplain(baseline, candidate, lang);

  const mainData = [
    {
      metric: "Recall",
      before: Number((baseline.recall * 100).toFixed(1)),
      after: Number((candidate.recall * 100).toFixed(1)),
    },
    {
      metric: "Precision",
      before: Number((baseline.precision * 100).toFixed(1)),
      after: Number((candidate.precision * 100).toFixed(1)),
    },
    {
      metric: "F1",
      before: Number((baseline.f1_score * 100).toFixed(1)),
      after: Number((candidate.f1_score * 100).toFixed(1)),
    },
  ];

  const fprBefore = Number((baseline.false_positive_rate * 100).toFixed(2));
  const fprAfter = Number((candidate.false_positive_rate * 100).toFixed(2));
  const fprIncreased = fprAfter > fprBefore + 0.005;

  return (
    <div className="rounded-2xl bg-[#202522] p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#F4F6F4]">
          {t.v33.chartDefenseCmpTitle}
        </span>
        <span className="text-[11px] font-mono text-[#A1ABA4] tabular-nums">
          FPR: {fprBefore.toFixed(2)}% →{" "}
          <strong className={fprIncreased ? "text-[#F16B6B]" : "text-[#43D17A]"}>
            {fprAfter.toFixed(2)}%
          </strong>
        </span>
      </div>

      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={mainData}
            margin={{ top: 6, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="metric" tick={AXIS_TICK} />
            <YAxis domain={[0, 100]} tick={AXIS_TICK} unit="%" />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number) => `${value.toFixed(1)}%`}
            />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#A1ABA4" }} />
            <Bar
              dataKey="before"
              name={baselineLabel}
              fill="#5D6963"
              radius={[6, 6, 0, 0]}
            />
            <Bar
              dataKey="after"
              name={candidateLabel}
              fill="#00B846"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartExplainer content={explain} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 6. Stability Comparison Chart (Per-Seed Switchable Metrics)                */
/* -------------------------------------------------------------------------- */
interface StabilityComparisonChartProps {
  rows: BenchmarkSeedResult[];
  baselineLabel: string;
  candidateLabel?: string | null;
}

export const StabilityComparisonChart: React.FC<StabilityComparisonChartProps> = ({
  rows,
  baselineLabel,
  candidateLabel,
}) => {
  const { t, lang } = useLab();
  const [metric, setMetric] = useState<"recall" | "f1_score" | "false_positive_rate">(
    "recall"
  );

  if (!rows || rows.length === 0) return null;

  const explain = buildStabilityChartExplain(rows, lang);
  const hasCandidate = rows.some((r) => Boolean(r.candidate));
  const decimals = metric === "false_positive_rate" ? 2 : 1;

  const data = rows.map((r) => ({
    seed: `seed ${r.seed}`,
    baseline: Number(((r.baseline[metric] || 0) * 100).toFixed(decimals)),
    candidate: r.candidate
      ? Number(((r.candidate[metric] || 0) * 100).toFixed(decimals))
      : undefined,
  }));

  return (
    <div className="dp-elevated p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#F4F6F4]">
          {t.v33.chartStabilityTitle}
        </div>
        <div className="flex gap-1 rounded-xl bg-[#171A18] p-0.5 text-[11px]">
          {(
            [
              ["recall", t.v33.stabilityMetricRecall],
              ["f1_score", t.v33.stabilityMetricF1],
              ["false_positive_rate", t.v33.stabilityMetricFpr],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                metric === k
                  ? "bg-[#008F36] text-[#F4F6F4]"
                  : "text-[#77837C] hover:text-[#F4F6F4]"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="seed" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} unit="%" />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number) => `${value.toFixed(decimals)}%`}
            />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#A1ABA4" }} />
            <Bar
              dataKey="baseline"
              name={baselineLabel}
              fill="#5D6963"
              radius={[6, 6, 0, 0]}
            />
            {hasCandidate && (
              <Bar
                dataKey="candidate"
                name={candidateLabel || t.stability.candCol}
                fill={metric === "false_positive_rate" ? "#E3AD56" : "#00B846"}
                radius={[6, 6, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartExplainer content={explain} />
    </div>
  );
};
