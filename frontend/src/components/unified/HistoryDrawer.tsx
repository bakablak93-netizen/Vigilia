import React from "react";
import { FileJson, FileSpreadsheet, History, Printer, X } from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { BenchmarkRun, ExperimentSummary } from "../../types/api";
import { buildHistoryItemSummary } from "../../utils/humanExplain";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  experiments: ExperimentSummary[];
  benchmarks: BenchmarkRun[];
  activeExperimentId: number | null;
  onSelectExperiment: (expId: number) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  open,
  onClose,
  experiments,
  benchmarks,
  activeExperimentId,
  onSelectExperiment,
}) => {
  const { t, lang, verdictLabel } = useLab();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-xl v4-sidebar h-full flex flex-col">
        <div className="px-6 py-4 bg-[#0B0E0C]/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <History className="h-4 w-4 text-[#43D17A]" />
            <div>
              <h2 className="text-sm font-bold text-[#F4F6F4]">{t.history.title}</h2>
              <p className="text-xs text-[#77837C]">{t.history.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.settings.close}
            className="p-1.5 rounded-xl bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Experiments List */}
          <div className="space-y-3">
            {experiments.length === 0 ? (
              <div className="text-sm text-[#77837C] py-10 text-center">
                {t.history.empty}
              </div>
            ) : (
              experiments.map((exp) => {
                const isActive = exp.id === activeExperimentId;
                const recallPct =
                  exp.metrics_json.actual_risk_events > 0
                    ? `${(exp.metrics_json.recall * 100).toFixed(1)}%`
                    : "—";
                const fprPct = `${(exp.metrics_json.false_positive_rate * 100).toFixed(2)}%`;

                return (
                  <div
                    key={exp.id}
                    className={`rounded-2xl p-4 space-y-3 transition-colors ${
                      isActive
                        ? "bg-[#202522] ring-1 ring-[#008F36]/70"
                        : "bg-[#202522]/75 hover:bg-[#202522]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#F4F6F4]">
                            <span className="font-mono text-xs text-[#77837C] mr-1.5">
                              #{exp.id}
                            </span>
                            {exp.name}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#171A18] text-[#A1ABA4]">
                            {exp.adapter_type === "external_api"
                              ? t.ext.adapterExternal
                              : exp.adapter_type === "imported"
                                ? t.ext.adapterImported
                                : t.ext.adapterInternal}
                          </span>
                        </div>
                        <div className="text-xs text-[#77837C] mt-1">
                          {exp.engine_name ? `${exp.engine_name} · ` : ""}
                          {exp.defense_version || `#${exp.defense_config_id}`} ·{" "}
                          {new Date(exp.created_at).toLocaleString()}
                        </div>
                        <div className="text-xs text-[#D4DDD7] mt-1.5">
                          {buildHistoryItemSummary(exp, lang)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectExperiment(exp.id);
                          onClose();
                        }}
                        className="lab-btn-accent py-1.5 px-3 text-xs shrink-0"
                      >
                        {t.history.loadBtn}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-white/[0.05] text-xs">
                      <div className="flex flex-wrap items-center gap-3 tabular-nums">
                        <span className="text-[#A1ABA4]">
                          {t.focus.detectedOfTotal}{" "}
                          <strong className="text-[#43D17A]">
                            {exp.metrics_json.true_positives}/
                            {exp.metrics_json.actual_risk_events}
                          </strong>{" "}
                          ({recallPct})
                        </span>
                        <span className="text-[#77837C]">
                          {t.focus.falseBlocksLine}:{" "}
                          <strong className="text-[#F4F6F4]">
                            {exp.metrics_json.false_positives}
                          </strong>{" "}
                          ({fprPct})
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#43D17A]/15 text-[#43D17A]">
                          {exp.status === "completed" ? t.result.statusCompleted : exp.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <a
                          href={api.exportUrl(exp.id, "json")}
                          download
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171A18] hover:bg-[#101211] text-[11px] font-medium text-[#A1ABA4] hover:text-[#F4F6F4]"
                        >
                          <FileJson className="h-3 w-3 text-[#43D17A]" />
                          <span>{t.history.exportJson}</span>
                        </a>
                        <a
                          href={api.exportUrl(exp.id, "csv")}
                          download
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171A18] hover:bg-[#101211] text-[11px] font-medium text-[#A1ABA4] hover:text-[#F4F6F4]"
                        >
                          <FileSpreadsheet className="h-3 w-3 text-[#43D17A]" />
                          <span>{t.history.exportCsv}</span>
                        </a>
                        <a
                          href={api.exportUrl(exp.id, "html")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171A18] hover:bg-[#101211] text-[11px] font-medium text-[#A1ABA4] hover:text-[#F4F6F4]"
                        >
                          <Printer className="h-3 w-3 text-[#43D17A]" />
                          <span>{t.history.exportHtml}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Saved Benchmarks List */}
          {benchmarks.length > 0 && (
            <div className="space-y-2.5 pt-4 border-t border-white/[0.06]">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#77837C]">
                {t.history.benchmarksTitle}
              </h3>
              {benchmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="rounded-xl bg-[#202522] p-3.5 text-xs flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-semibold text-[#F4F6F4]">
                      #{bm.id} · {bm.name}
                    </div>
                    <div className="text-[11px] text-[#77837C] mt-0.5">
                      {bm.completed_runs}/{bm.total_runs} seeds ·{" "}
                      {bm.comparison_summary_json?.verdict
                        ? verdictLabel(bm.comparison_summary_json.verdict)
                        : bm.status}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <a
                      href={api.benchmarkExportUrl(bm.id, "json")}
                      download
                      className="px-2.5 py-1 rounded-lg bg-[#171A18] text-[11px] text-[#A1ABA4] hover:text-[#F4F6F4]"
                    >
                      JSON
                    </a>
                    <a
                      href={api.benchmarkExportUrl(bm.id, "csv")}
                      download
                      className="px-2.5 py-1 rounded-lg bg-[#171A18] text-[11px] text-[#A1ABA4] hover:text-[#F4F6F4]"
                    >
                      CSV
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
