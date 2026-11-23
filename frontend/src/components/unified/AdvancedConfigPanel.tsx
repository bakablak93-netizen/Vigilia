import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CopyPlus, Database, Loader2, Shield, Sparkles } from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { DefenseConfig, RuleConfig } from "../../types/api";

const ALL_SCENARIOS = [
  "normal_activity",
  "unusual_amount",
  "new_recipient_risk",
  "duplicate_payment",
  "suspicious_sequence",
  "structuring_smurfing",
  "account_takeover_ato",
];

interface AdvancedConfigPanelProps {
  selectedDefense: DefenseConfig | undefined;
  splitName: "all" | "calibration" | "validation" | "evaluation";
  onChangeSplitName: (split: "all" | "calibration" | "validation" | "evaluation") => void;
  onDatasetCreated: (datasetId: number) => void;
  onDefenseCreated: (configId: number) => void;
}

export const AdvancedConfigPanel: React.FC<AdvancedConfigPanelProps> = ({
  selectedDefense,
  splitName,
  onChangeSplitName,
  onDatasetCreated,
  onDefenseCreated,
}) => {
  const { t, scenarioLabel, ruleLabel, defaultSimParams } = useLab();
  const queryClient = useQueryClient();

  const [dsName, setDsName] = useState("Синтетический банковский набор");
  const [txCount, setTxCount] = useState(defaultSimParams.transaction_count);
  const [custCount, setCustCount] = useState(defaultSimParams.customer_count);
  const [riskPct, setRiskPct] = useState(Math.round(defaultSimParams.risk_ratio * 100));
  const [seed, setSeed] = useState(defaultSimParams.seed);
  const [scenarios, setScenarios] = useState<string[]>(ALL_SCENARIOS);

  const [versionName, setVersionName] = useState("");
  const [decisionThreshold, setDecisionThreshold] = useState(55);
  const [rulesDraft, setRulesDraft] = useState<Record<string, RuleConfig>>({});
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDefense) {
      setVersionName(`${selectedDefense.name} (Custom)`);
      setDecisionThreshold(selectedDefense.decision_threshold);
      setRulesDraft(JSON.parse(JSON.stringify(selectedDefense.rules_config_json)));
    }
  }, [selectedDefense]);

  const genMutation = useMutation({
    mutationFn: () =>
      api.generateDataset({
        name: dsName,
        transaction_count: txCount,
        customer_count: custCount,
        risk_ratio: riskPct / 100,
        scenarios,
        seed,
      }),
    onSuccess: (ds) => {
      setErrorMsg(null);
      onDatasetCreated(ds.id);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const saveDefenseMutation = useMutation({
    mutationFn: () =>
      api.createDefenseConfig({
        name: versionName || "Настроенная защита",
        description: selectedDefense
          ? `Derived from ${selectedDefense.version}`
          : "Custom test configuration",
        parent_version_id: selectedDefense?.id ?? null,
        decision_threshold: decisionThreshold,
        risk_levels: selectedDefense?.risk_levels_json || {
          low_max: 30,
          medium_max: 55,
          high_max: 80,
        },
        rules_config: rulesDraft,
      }),
    onSuccess: (cfg) => {
      setErrorMsg(null);
      setSavedNotice(`${t.advanced.versionSaved} ${cfg.version}`);
      onDefenseCreated(cfg.id);
      queryClient.invalidateQueries({ queryKey: ["defenseConfigs"] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const toggleScenario = (key: string) => {
    setScenarios((prev) =>
      prev.includes(key)
        ? prev.length > 1
          ? prev.filter((s) => s !== key)
          : prev
        : [...prev, key]
    );
  };

  const updateRule = (ruleKey: string, field: keyof RuleConfig, value: unknown) => {
    setRulesDraft((prev) => ({
      ...prev,
      [ruleKey]: { ...prev[ruleKey], [field]: value },
    }));
  };

  return (
    <div className="pt-4 border-t border-white/[0.06] space-y-5">
      {errorMsg && (
        <div className="rounded-xl bg-[#F16B6B]/10 p-3 text-xs text-[#F16B6B]">
          {errorMsg}
        </div>
      )}
      {savedNotice && (
        <div className="rounded-xl bg-[#43D17A]/10 p-3 text-xs text-[#43D17A] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <span>{savedNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Dataset Generator & Slice Selector */}
        <div className="lg:col-span-5 space-y-3 rounded-2xl bg-[#202522] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#F4F6F4]">
            <Database className="h-3.5 w-3.5 text-[#43D17A]" />
            <span>{t.advanced.datasetSection}</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.splitLabel}
              </label>
              <select
                className="lab-input py-1.5 text-xs"
                value={splitName}
                onChange={(e) =>
                  onChangeSplitName(
                    e.target.value as "all" | "calibration" | "validation" | "evaluation"
                  )
                }
              >
                <option value="all">{t.advanced.splitAll}</option>
                <option value="evaluation">{t.advanced.splitEvaluation}</option>
                <option value="validation">{t.advanced.splitValidation}</option>
                <option value="calibration">{t.advanced.splitCalibration}</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.main.datasetLabel}
              </label>
              <input
                type="text"
                className="lab-input py-1.5 text-xs"
                value={dsName}
                onChange={(e) => setDsName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.txCount}
              </label>
              <input
                type="number"
                min={10}
                max={10000}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={txCount}
                onChange={(e) => setTxCount(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.custCount}
              </label>
              <input
                type="number"
                min={5}
                max={2000}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={custCount}
                onChange={(e) => setCustCount(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.riskPct}
              </label>
              <input
                type="number"
                min={1}
                max={40}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={riskPct}
                onChange={(e) => setRiskPct(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.seed}
              </label>
              <input
                type="number"
                min={0}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#71818B] mb-1.5">
              {t.advanced.scenariosLabel}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SCENARIOS.map((key) => {
                const active = scenarios.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleScenario(key)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                      active
                        ? "bg-[#008F36]/25 text-[#43D17A] font-medium"
                        : "bg-[#171A18] text-[#77837C] hover:text-[#F4F6F4]"
                    }`}
                  >
                    {scenarioLabel(key)}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => genMutation.mutate()}
            disabled={genMutation.isPending}
            className="lab-btn-secondary w-full py-1.5 text-xs"
          >
            {genMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-[#087F70]" />
            )}
            <span>
              {genMutation.isPending ? t.advanced.generatingBtn : t.advanced.generateBtn}
            </span>
          </button>
        </div>

        {/* Defense Engine Rule Editor */}
        <div className="lg:col-span-7 space-y-3 rounded-2xl bg-[#202522] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F4F6F4]">
              <Shield className="h-3.5 w-3.5 text-[#43D17A]" />
              <span>{t.advanced.rulesSection}</span>
            </div>
            {selectedDefense && (
              <span className="font-mono text-[11px] text-[#77837C]">
                {selectedDefense.version}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.newVersionName}
              </label>
              <input
                type="text"
                className="lab-input py-1.5 text-xs"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                {t.advanced.decisionThreshold}
              </label>
              <input
                type="number"
                min={10}
                max={95}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={decisionThreshold}
                onChange={(e) => setDecisionThreshold(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {Object.entries(rulesDraft).map(([key, rule]) => (
              <div
                key={key}
                className="rounded-xl bg-[#171A18] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F4F6F4]">
                    {ruleLabel(key)}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateRule(key, "enabled", !rule.enabled)}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      rule.enabled
                        ? "bg-[#43D17A]/15 text-[#43D17A]"
                        : "bg-[#202522] text-[#77837C]"
                    }`}
                  >
                    {rule.enabled ? t.advanced.enabled : t.advanced.disabled}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#71818B] mb-0.5">
                      {t.advanced.thresholdHint}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      className="lab-input py-1 px-2 text-xs tabular-nums"
                      value={rule.threshold}
                      onChange={(e) => updateRule(key, "threshold", Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#71818B] mb-0.5">
                      {t.advanced.weightHint}
                    </label>
                    <input
                      type="number"
                      step="1"
                      className="lab-input py-1 px-2 text-xs tabular-nums"
                      value={rule.weight}
                      onChange={(e) => updateRule(key, "weight", Number(e.target.value))}
                    />
                  </div>
                  {rule.window_minutes !== undefined && rule.window_minutes !== null && (
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-0.5">
                        {t.advanced.windowHint}
                      </label>
                      <input
                        type="number"
                        step="1"
                        className="lab-input py-1 px-2 text-xs tabular-nums"
                        value={rule.window_minutes}
                        onChange={(e) =>
                          updateRule(key, "window_minutes", Number(e.target.value))
                        }
                      />
                    </div>
                  )}
                  {rule.context_amount_ratio !== undefined &&
                    rule.context_amount_ratio !== null && (
                      <div>
                        <label className="block text-[10px] text-[#71818B] mb-0.5">
                          {t.advanced.contextRatioHint}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          className="lab-input py-1 px-2 text-xs tabular-nums"
                          value={rule.context_amount_ratio}
                          onChange={(e) =>
                            updateRule(
                              key,
                              "context_amount_ratio",
                              Number(e.target.value)
                            )
                          }
                        />
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => saveDefenseMutation.mutate()}
            disabled={saveDefenseMutation.isPending}
            className="lab-btn-primary w-full py-1.5 text-xs"
          >
            {saveDefenseMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CopyPlus className="h-3.5 w-3.5" />
            )}
            <span>
              {saveDefenseMutation.isPending
                ? t.advanced.savingVersion
                : t.advanced.saveVersionBtn}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
