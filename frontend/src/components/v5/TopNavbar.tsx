import React from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  History,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { Language } from "../../i18n/translations";
import { VigiliaPixelLogo } from "../v4/VigiliaPixelLogo";

export type ActiveStepId = 1 | 2 | 3;

interface TopNavbarProps {
  activeStep: ActiveStepId;
  maxUnlockedStep: ActiveStepId;
  onSelectStep: (step: ActiveStepId) => void;
  modeBadge: string;
  historyCount: number;
  onOpenHistory: () => void;
  onOpenAnalytics: () => void;
  onOpenSettings: () => void;
  onNewCheck: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeStep,
  maxUnlockedStep,
  onSelectStep,
  modeBadge,
  historyCount,
  onOpenHistory,
  onOpenAnalytics,
  onOpenSettings,
  onNewCheck,
}) => {
  const { t, lang, setLang } = useLab();

  const steps: Array<{ id: ActiveStepId; label: string }> = [
    { id: 1, label: t.v5.step1 },
    { id: 2, label: t.v5.step2 },
    { id: 3, label: t.v5.step3 },
  ];

  return (
    <header className="sticky top-0 z-30 bg-[#0A0E0D]/80 backdrop-blur-md">
      <div className="max-w-[1440px] mx-auto px-6">
        {/* Top Row: Official Pixel Logo + Mode Label (Left) & Minimalist Action Buttons (Right) */}
        <div className="h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 shrink-0">
            <VigiliaPixelLogo variant="sidebar" />
            <span className="hidden sm:inline-block h-5 w-px bg-white/10" />
            <span className="hidden sm:inline-flex items-center text-sm font-medium text-[#94A3B8]">
              {modeBadge}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenHistory}
              className="px-3 py-2 rounded-xl text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9] hover:bg-[#161E1B]/80 transition-colors inline-flex items-center gap-2"
              title={t.topBar.history}
            >
              <History className="h-4 w-4 text-[#22C55E]" />
              <span className="hidden md:inline">{t.topBar.history}</span>
              {historyCount > 0 && (
                <span className="font-mono text-xs font-semibold text-[#22C55E] bg-[#16A34A]/15 px-2 py-0.5 rounded-full">
                  {historyCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenAnalytics}
              className="px-3 py-2 rounded-xl text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9] hover:bg-[#161E1B]/80 transition-colors inline-flex items-center gap-2"
              title={t.v4.navAnalytics}
            >
              <BarChart3 className="h-4 w-4 text-[#94A3B8]" />
              <span className="hidden md:inline">{t.v4.navAnalytics}</span>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="px-3 py-2 rounded-xl text-sm font-medium text-[#CBD5E1] hover:text-[#F1F5F9] hover:bg-[#161E1B]/80 transition-colors inline-flex items-center gap-2"
              aria-label={t.topBar.settings}
              title={t.topBar.settings}
            >
              <Settings className="h-4 w-4 text-[#94A3B8]" />
              <span className="hidden lg:inline">{t.topBar.settings}</span>
            </button>

            <button
              type="button"
              onClick={onNewCheck}
              className="px-3.5 py-2 rounded-xl text-sm font-medium text-[#F1F5F9] bg-[#161E1B]/85 hover:bg-[#1E2925] transition-colors inline-flex items-center gap-2"
              title={t.v5.newTestBtn}
            >
              <RotateCcw className="h-4 w-4 text-[#22C55E]" />
              <span className="hidden sm:inline">{t.v5.newTestBtn}</span>
            </button>
          </div>
        </div>

        {/* Second Row: Prominent 3-Step Stepper (Center) + Language Switcher (Right) */}
        <div className="pb-3 pt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="hidden xl:block w-28" />

          <nav
            aria-label="Workflow steps"
            className="mx-auto flex items-center gap-1.5 sm:gap-2.5 bg-[#121816]/80 px-2 py-1.5 rounded-full overflow-x-auto max-w-full"
          >
            {steps.map((s, idx) => {
              const isActive = activeStep === s.id;
              const isUnlocked = s.id <= maxUnlockedStep;
              const isDone = s.id < activeStep;
              return (
                <React.Fragment key={s.id}>
                  <button
                    type="button"
                    disabled={!isUnlocked}
                    onClick={() => isUnlocked && onSelectStep(s.id)}
                    className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold tracking-wide transition-all duration-300 inline-flex items-center gap-2 whitespace-nowrap ${
                      isActive
                        ? "bg-[#1C2723] text-[#F1F5F9] shadow-sm"
                        : isUnlocked
                          ? "text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                          : "text-[#475569] cursor-not-allowed"
                    }`}
                  >
                    {isDone && (
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-[#16A34A]/25 text-[#22C55E]">
                        <Check className="h-3 w-3 stroke-[2.5]" />
                      </span>
                    )}
                    <span>{s.label}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-[#475569] shrink-0 hidden sm:block" />
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Language Switcher RU | KZ | EN */}
          <div className="flex items-center gap-1 bg-[#121816]/80 px-1.5 py-1 rounded-full shrink-0 ml-auto xl:ml-0">
            {(["ru", "kk", "en"] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`px-2.5 py-1 text-xs font-bold uppercase rounded-full transition-all ${
                  lang === code
                    ? "bg-[#16A34A] text-white"
                    : "text-[#94A3B8] hover:text-[#F1F5F9]"
                }`}
              >
                {code === "kk" ? "KZ" : code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
};
