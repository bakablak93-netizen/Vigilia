import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Moon, RotateCcw, Sliders, Sun, X } from "lucide-react";
import { api } from "../../api/client";
import { useLab } from "../../context/LabContext";
import type { Language } from "../../i18n/translations";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onDemoReset?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onDemoReset,
}) => {
  const {
    t,
    lang,
    setLang,
    theme,
    setTheme,
    bgAnimationEnabled,
    setBgAnimationEnabled,
    defaultSimParams,
    setDefaultSimParams,
  } = useLab();
  const queryClient = useQueryClient();

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    enabled: open,
  });

  const resetMutation = useMutation({
    mutationFn: api.resetDemo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["defenseConfigs"] });
      queryClient.invalidateQueries({ queryKey: ["evolutionRuns"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      onDemoReset?.();
      onClose();
    },
  });

  if (!open) return null;

  const handleReset = () => {
    if (window.confirm(t.settings.resetConfirm)) {
      resetMutation.mutate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg lab-card p-6 space-y-5">
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-base font-bold text-[#F4F6F4]">{t.settings.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.settings.close}
            className="p-1.5 rounded-xl bg-[#202522] text-[#A1ABA4] hover:text-[#F4F6F4]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Language */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#A1ABA4]">
            <Globe className="h-3.5 w-3.5 text-[#43D17A]" />
            <span>{t.settings.language}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["ru", "Русский"],
                ["kk", "Қазақша"],
                ["en", "English"],
              ] as Array<[Language, string]>
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={
                  lang === code
                    ? "lab-btn-accent text-xs py-1.5 px-3.5"
                    : "lab-btn-secondary text-xs py-1.5 px-3.5"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#A1ABA4]">
            {theme === "dark" ? (
              <Moon className="h-3.5 w-3.5 text-[#43D17A]" />
            ) : (
              <Sun className="h-3.5 w-3.5 text-[#E3AD56]" />
            )}
            <span>{t.settings.theme}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={
                theme === "dark"
                  ? "lab-btn-accent text-xs py-1.5 px-3.5"
                  : "lab-btn-secondary text-xs py-1.5 px-3.5"
              }
            >
              {t.settings.dark}
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={
                theme === "light"
                  ? "lab-btn-accent text-xs py-1.5 px-3.5"
                  : "lab-btn-secondary text-xs py-1.5 px-3.5"
              }
            >
              {t.settings.light}
            </button>
          </div>
        </div>

        {/* Background Flow Animation Toggle */}
        <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-[#F4F6F4]">
              {t.v4h.bgAnimationLabel}
            </div>
            <div className="text-[11px] text-[#77837C]">
              {t.v4h.bgAnimationHint}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={bgAnimationEnabled}
            aria-label={t.v4h.bgAnimationLabel}
            onClick={() => setBgAnimationEnabled(!bgAnimationEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              bgAnimationEnabled ? "bg-[#00B846]" : "bg-[#2C332F]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[#F4F6F4] transition-transform ${
                bgAnimationEnabled ? "translate-x-[22px]" : "translate-x-[4px]"
              }`}
            />
          </button>
        </div>

        {/* Default Simulator Settings */}
        <div className="space-y-2.5 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#A1ABA4]">
            <Sliders className="h-3.5 w-3.5 text-[#43D17A]" />
            <span>{t.settings.simDefaults}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] text-[#77837C] mb-1">
                {t.settings.txCount}
              </label>
              <input
                type="number"
                min={10}
                max={10000}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={defaultSimParams.transaction_count}
                onChange={(e) =>
                  setDefaultSimParams({
                    ...defaultSimParams,
                    transaction_count: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#77837C] mb-1">
                {t.settings.custCount}
              </label>
              <input
                type="number"
                min={5}
                max={2000}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={defaultSimParams.customer_count}
                onChange={(e) =>
                  setDefaultSimParams({
                    ...defaultSimParams,
                    customer_count: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#77837C] mb-1">
                {t.settings.riskPct}
              </label>
              <input
                type="number"
                min={1}
                max={40}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={Math.round(defaultSimParams.risk_ratio * 100)}
                onChange={(e) =>
                  setDefaultSimParams({
                    ...defaultSimParams,
                    risk_ratio: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#77837C] mb-1">
                {t.settings.seed}
              </label>
              <input
                type="number"
                min={0}
                className="lab-input py-1.5 text-xs tabular-nums"
                value={defaultSimParams.seed}
                onChange={(e) =>
                  setDefaultSimParams({
                    ...defaultSimParams,
                    seed: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* Core Status & Demo Reset */}
        <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#77837C] space-y-1">
            <div className="font-semibold text-[#F4F6F4]">{t.settings.coreStatus}</div>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  healthQuery.isSuccess && healthQuery.data?.status === "ok"
                    ? "bg-[#43D17A]"
                    : "bg-[#F16B6B]"
                }`}
              />
              <span className="text-[#A1ABA4]">
                {t.envStatus.sandbox} ·{" "}
                {healthQuery.isSuccess && healthQuery.data?.status === "ok"
                  ? t.envStatus.online
                  : t.envStatus.offline}
              </span>
            </div>
            <div>
              {healthQuery.data?.llm_configured ? t.settings.llmOn : t.settings.llmOff}
            </div>
          </div>

          <button
            type="button"
            onClick={handleReset}
            disabled={resetMutation.isPending}
            className="lab-btn-danger"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t.settings.resetDemo}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
