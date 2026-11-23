import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { TransactionInspectorItem } from "../../types/api";
import { TransactionInspectorPanel } from "../TransactionInspectorPanel";

interface TransactionInspectorViewProps {
  experimentId: number;
  scenarios: string[];
  engineName?: string;
  defenseVersion?: string;
  initialTxCode?: string | null;
}

const outcomePill: Record<string, string> = {
  TP: "bg-[#43D17A]/15 text-[#43D17A]",
  FP: "bg-[#F16B6B]/15 text-[#F16B6B]",
  FN: "bg-[#E3AD56]/15 text-[#E3AD56]",
  TN: "bg-[#202522] text-[#A1ABA4]",
};

export const TransactionInspectorView: React.FC<TransactionInspectorViewProps> = ({
  experimentId,
  scenarios,
  engineName,
  defenseVersion,
  initialTxCode = null,
}) => {
  const { t, scenarioLabel, formatKzt } = useLab();

  const [outcome, setOutcome] = useState<string>("all");
  const [scenarioFilter, setScenarioFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState<string>(initialTxCode || "");
  const [searchQuery, setSearchQuery] = useState<string>(initialTxCode || "");
  const [page, setPage] = useState<number>(1);
  const [selectedItem, setSelectedItem] = useState<TransactionInspectorItem | null>(
    null
  );

  const txQuery = useQuery({
    queryKey: [
      "inspectorTransactions",
      experimentId,
      page,
      outcome,
      scenarioFilter,
      searchQuery,
    ],
    queryFn: () =>
      api.listInspectorTransactions(experimentId, {
        page,
        page_size: 12,
        outcome,
        scenario_type: scenarioFilter,
        search: searchQuery,
      }),
  });

  const data = txQuery.data;
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 12));

  const filterChips = [
    { key: "all", label: t.v33.filterAll },
    { key: "tp", label: t.v33.filterTp },
    { key: "fn", label: t.v33.filterFn },
    { key: "fp", label: t.v33.filterFp },
    { key: "legit", label: t.v33.filterLegit },
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  return (
    <div className="space-y-4">
      {/* Filters & Search */}
      <div className="rounded-2xl bg-[#202522] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => {
                  setOutcome(chip.key);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                  outcome === chip.key
                    ? "bg-[#008F36] text-[#F4F6F4]"
                    : "bg-[#171A18] text-[#A1ABA4] hover:text-[#F4F6F4]"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <select
            className="lab-input py-1.5 px-3 text-xs !w-auto min-w-[170px] bg-[#171A18]"
            value={scenarioFilter}
            onChange={(e) => {
              setScenarioFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t.v33.filterAllScenarios}</option>
            {scenarios.map((sc) => (
              <option key={sc} value={sc}>
                {scenarioLabel(sc)}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder={t.detect.searchPlaceholder}
            className="lab-input py-1.5 px-3 text-xs font-mono flex-1 min-w-[200px] bg-[#171A18]"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="lab-btn-secondary py-1.5 px-3.5 text-xs bg-[#171A18]">
            <Search className="h-3.5 w-3.5 text-[#43D17A]" />
            <span>{t.detect.inspectBtn}</span>
          </button>
        </form>
      </div>

      {/* Selected Detail Panel */}
      {(selectedItem || items[0]) && (
        <TransactionInspectorPanel
          item={selectedItem || items[0]}
          onClose={selectedItem ? () => setSelectedItem(null) : undefined}
          engineName={engineName}
          defenseVersion={defenseVersion}
        />
      )}

      {/* Paginated Table */}
      <div className="rounded-2xl bg-[#202522] overflow-hidden">
        {txQuery.isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-xs text-[#A1ABA4]">
            <Loader2 className="h-4 w-4 animate-spin text-[#43D17A]" />
            <span>{t.result.loadingState}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#77837C]">
            {t.v33.inspectorEmpty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-[#171A18]/80 text-[#77837C]">
                <tr>
                  <th className="px-3.5 py-2.5 text-left">ID</th>
                  <th className="px-3 py-2.5 text-left">{t.result.colScenario}</th>
                  <th className="px-3 py-2.5 text-right">{t.inspector.amount}</th>
                  <th className="px-3 py-2.5 text-center">{t.inspector.gt} / {t.inspector.pred}</th>
                  <th className="px-3 py-2.5 text-right">{t.inspector.score}</th>
                  <th className="px-3.5 py-2.5 text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {items.map((row) => {
                  const isSel = (selectedItem || items[0])?.transaction_code === row.transaction_code;
                  return (
                    <tr
                      key={row.transaction_code}
                      onClick={() => setSelectedItem(row)}
                      className={`cursor-pointer transition-colors ${
                        isSel
                          ? "bg-[#008F36]/15"
                          : "hover:bg-[#262C28]"
                      }`}
                    >
                      <td className="px-3.5 py-2.5 font-mono font-semibold text-[#F4F6F4]">
                        {row.transaction_code}
                      </td>
                      <td className="px-3 py-2.5 text-[#A1ABA4]">
                        {scenarioLabel(row.scenario_type)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-[#F4F6F4]">
                        {formatKzt(row.amount_kzt)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-[#A1ABA4]">
                        {row.ground_truth_label} / {row.predicted_label}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#F4F6F4]">
                        {row.risk_score !== null && row.score_available !== false
                          ? Number(row.risk_score).toFixed(1)
                          : "—"}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            outcomePill[row.outcome] || outcomePill.TN
                          }`}
                        >
                          {row.outcome}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        <div className="px-4 py-3 bg-[#171A18]/60 flex items-center justify-between text-xs text-[#A1ABA4]">
          <span className="tabular-nums">
            {t.v33.inspectorPageInfo} {page} / {totalPages} · {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="lab-btn-secondary py-1 px-2.5 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>{t.v33.inspectorPrev}</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="lab-btn-secondary py-1 px-2.5 text-xs"
            >
              <span>{t.v33.inspectorNext}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
