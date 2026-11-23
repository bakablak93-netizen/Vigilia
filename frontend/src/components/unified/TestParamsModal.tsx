import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Play,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { AntifraudEngineView, DatasetSummary, DefenseConfig } from "../../types/api";
import { AdvancedConfigPanel } from "./AdvancedConfigPanel";

interface TestParamsModalProps {
  open: boolean;
  onClose: () => void;
  onRunCheck?: () => void;
  engines: AntifraudEngineView[];
  selectedEngineCode: string;
  onChangeEngineCode: (code: string) => void;
  externalProfile: "baseline" | "candidate" | "updated";
  onChangeExternalProfile: (p: "baseline" | "candidate" | "updated") => void;
  importFormat: "csv" | "json";
  onChangeImportFormat: (fmt: "csv" | "json") => void;
  importContent: string;
  onChangeImportContent: (content: string) => void;
  importVersionLabel: string;
  onChangeImportVersionLabel: (val: string) => void;
  configs: DefenseConfig[];
  datasets: DatasetSummary[];
  selectedDefenseId: number | "";
  onChangeDefenseId: (id: number | "") => void;
  selectedDatasetId: number | null;
  onChangeDatasetId: (id: number | null) => void;
  txCount: number;
  onChangeTxCount: (val: number) => void;
  seed: number;
  onChangeSeed: (val: number) => void;
  splitName: "all" | "calibration" | "validation" | "evaluation";
  onChangeSplitName: (split: "all" | "calibration" | "validation" | "evaluation") => void;
}

export const TestParamsModal: React.FC<TestParamsModalProps> = ({
  open,
  onClose,
  onRunCheck,
  engines,
  selectedEngineCode,
  onChangeEngineCode,
  externalProfile,
  onChangeExternalProfile,
  importFormat,
  onChangeImportFormat,
  importContent,
  onChangeImportContent,
  importVersionLabel,
  onChangeImportVersionLabel,
  configs,
  datasets,
  selectedDefenseId,
  onChangeDefenseId,
  selectedDatasetId,
  onChangeDatasetId,
  txCount,
  onChangeTxCount,
  seed,
  onChangeSeed,
  splitName,
  onChangeSplitName,
}) => {
  const { t } = useLab();
  const [showTechnical, setShowTechnical] = useState(false);

  if (!open) return null;

  const selectedDefense = configs.find((c) => c.id === Number(selectedDefenseId));
  const selectedEngine = engines.find((e) => e.code === selectedEngineCode);
  const isInternal = !selectedEngine || selectedEngine.adapter_type === "internal";
  const isExternalApi = selectedEngine?.adapter_type === "external_api";
  const isImported = selectedEngine?.adapter_type === "imported";

  const handleDatasetChange = (raw: string) => {
    if (!raw) {
      onChangeDatasetId(null);
      return;
    }
    const id = Number(raw);
    onChangeDatasetId(id);
    const ds = datasets.find((d) => d.id === id);
    if (ds) {
      onChangeTxCount(ds.transaction_count);
      onChangeSeed(ds.seed);
    }
  };

  const handleTxCountChange = (val: number) => {
    const safeVal = Math.max(10, Math.min(10000, Number.isFinite(val) ? val : 1000));
    onChangeTxCount(safeVal);
    const currentDs = datasets.find((d) => d.id === selectedDatasetId);
    if (currentDs && currentDs.transaction_count !== safeVal) {
      onChangeDatasetId(null);
    }
  };

  const handleSeedChange = (val: number) => {
    const safeVal = Math.max(0, Number.isFinite(val) ? val : 42);
    onChangeSeed(safeVal);
    const currentDs = datasets.find((d) => d.id === selectedDatasetId);
    if (currentDs && currentDs.seed !== safeVal) {
      onChangeDatasetId(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".json")) {
      onChangeImportFormat("json");
    } else if (file.name.toLowerCase().endsWith(".csv")) {
      onChangeImportFormat("csv");
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChangeImportContent(reader.result);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/65 backdrop-blur-xs" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col lab-card overflow-hidden">
        <div className="px-6 py-4 bg-[#0B0E0C]/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[#43D17A]" />
            <h2 className="text-base font-bold text-[#F4F6F4]">
              {t.focus.paramsModalTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.settings.close}
            className="btn-subtle p-1.5 rounded-xl"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {engines.length > 0 && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#A1ABA4] mb-1.5">
                  {t.ext.engineSourceLabel}
                </label>
                <select
                  className="lab-input"
                  value={selectedEngineCode}
                  onChange={(e) => onChangeEngineCode(e.target.value)}
                >
                  {engines.map((eng) => (
                    <option key={eng.code} value={eng.code}>
                      {eng.name} (
                      {eng.diagnostic_mode === "black_box"
                        ? t.ext.modeBlackBox
                        : t.ext.modeWhiteBox}
                      {eng.adapter_type === "external_api"
                        ? ` · ${eng.online ? t.ext.connected : t.ext.disconnected}`
                        : ""}
                      )
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isInternal && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#A1ABA4] mb-1.5">
                  {t.focus.paramsDefense}
                </label>
                <select
                  className="lab-input"
                  value={selectedDefenseId}
                  onChange={(e) =>
                    onChangeDefenseId(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  {configs.map((cfg) => (
                    <option key={cfg.id} value={cfg.id}>
                      {cfg.version} — {cfg.name}
                      {cfg.is_baseline ? ` (${t.focus.paramsBaselineTag})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isExternalApi && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#A1ABA4] mb-1.5">
                  {t.ext.profileLabel}
                </label>
                <select
                  className="lab-input"
                  value={externalProfile}
                  onChange={(e) =>
                    onChangeExternalProfile(
                      e.target.value as "baseline" | "candidate" | "updated"
                    )
                  }
                >
                  <option value="baseline">baseline (B-1.0-baseline)</option>
                  <option value="candidate">candidate (B-1.1-candidate)</option>
                  <option value="updated">updated (B-1.2-updated)</option>
                </select>
              </div>
            )}

            {isImported && (
              <div className="sm:col-span-2 v4-surface-elevated p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F4F6F4]">
                    {t.ext.importSectionTitle}
                  </span>
                  <label className="btn-subtle py-1 px-3 text-xs cursor-pointer">
                    <Upload className="h-3.5 w-3.5 text-[#43D17A]" />
                    <span>{t.ext.importUploadBtn}</span>
                    <input
                      type="file"
                      accept=".csv,.json,text/csv,application/json"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>

                {!importContent.trim() && (
                  <div className="rounded-xl bg-[#E3AD56]/12 px-3 py-2 text-[11px] text-[#E3AD56]">
                    {t.ext.importMissingAlert}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[#77837C] mb-1">
                      {t.ext.importVersionLabel}
                    </label>
                    <input
                      type="text"
                      className="lab-input py-1.5 text-xs bg-[#171A18]"
                      value={importVersionLabel}
                      onChange={(e) => onChangeImportVersionLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#77837C] mb-1">
                      {t.ext.importFormatLabel}
                    </label>
                    <select
                      className="lab-input py-1.5 text-xs bg-[#171A18]"
                      value={importFormat}
                      onChange={(e) =>
                        onChangeImportFormat(e.target.value as "csv" | "json")
                      }
                    >
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                  </div>
                </div>

                <textarea
                  rows={4}
                  className="lab-input font-mono text-[11px] bg-[#171A18]"
                  placeholder={t.ext.importPlaceholder}
                  value={importContent}
                  onChange={(e) => onChangeImportContent(e.target.value)}
                />
                <p className="text-[11px] text-[#77837C]">{t.ext.importHint}</p>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#A1ABA4] mb-1.5">
                {t.focus.paramsDataset}
              </label>
              <select
                className="lab-input"
                value={selectedDatasetId ?? ""}
                onChange={(e) => handleDatasetChange(e.target.value)}
              >
                <option value="">{t.focus.paramsDatasetAuto}</option>
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    #{ds.id} · {ds.name} ({ds.transaction_count} tx, seed={ds.seed})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1ABA4] mb-1.5">
                {t.focus.paramsTxCount}
              </label>
              <input
                type="number"
                min={10}
                max={10000}
                step={100}
                className="lab-input tabular-nums"
                value={txCount}
                onChange={(e) => handleTxCountChange(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1ABA4] mb-1.5">
                {t.focus.paramsSeed}
              </label>
              <input
                type="number"
                min={0}
                className="lab-input tabular-nums"
                value={seed}
                onChange={(e) => handleSeedChange(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A1ABA4] hover:text-[#F4F6F4]"
            >
              {showTechnical ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              <span>{t.focus.paramsTechToggle}</span>
            </button>

            {showTechnical && (
              <div className="mt-4">
                <AdvancedConfigPanel
                  selectedDefense={selectedDefense}
                  splitName={splitName}
                  onChangeSplitName={onChangeSplitName}
                  onDatasetCreated={(id) => onChangeDatasetId(id)}
                  onDefenseCreated={(id) => onChangeDefenseId(id)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 bg-[#0B0E0C]/85 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-subtle px-4 py-2 text-xs"
          >
            {t.focus.paramsApply}
          </button>
          {onRunCheck && (
            <button
              type="button"
              disabled={isImported && !importContent.trim()}
              onClick={() => {
                onClose();
                onRunCheck();
              }}
              className="btn-primary px-5 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{t.v4.runCheckNow}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
