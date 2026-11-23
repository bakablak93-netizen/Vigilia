import React, { createContext, useContext, useEffect, useState } from "react";
import { Language, translations } from "../i18n/translations";

interface DefaultSimParams {
  transaction_count: number;
  customer_count: number;
  risk_ratio: number;
  seed: number;
}

interface LabContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (typeof translations)["ru"];
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  bgAnimationEnabled: boolean;
  setBgAnimationEnabled: (enabled: boolean) => void;
  selectedDatasetId: number | null;
  setSelectedDatasetId: (id: number | null) => void;
  selectedExperimentId: number | null;
  setSelectedExperimentId: (id: number | null) => void;
  defaultSimParams: DefaultSimParams;
  setDefaultSimParams: (params: DefaultSimParams) => void;
  scenarioLabel: (key: string) => string;
  ruleLabel: (key: string) => string;
  verdictLabel: (key: string) => string;
  formatKzt: (amount: number) => string;
}

const LabContext = createContext<LabContextValue | null>(null);

const BG_ANIMATION_STORAGE_KEY = "vigilia_bg_animation_enabled";

export const LabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>("ru");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [bgAnimationEnabled, setBgAnimationEnabledState] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(BG_ANIMATION_STORAGE_KEY);
      return saved === null ? true : saved !== "false";
    } catch {
      return true;
    }
  });
  const setBgAnimationEnabled = (enabled: boolean) => {
    setBgAnimationEnabledState(enabled);
    try {
      window.localStorage.setItem(BG_ANIMATION_STORAGE_KEY, String(enabled));
    } catch {
      // ignore storage failure
    }
  };
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<number | null>(null);
  const [defaultSimParams, setDefaultSimParams] = useState<DefaultSimParams>({
    transaction_count: 1000,
    customer_count: 100,
    risk_ratio: 0.05,
    seed: 42,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const t = translations[lang] as (typeof translations)["ru"];

  const scenarioLabel = (key: string): string => {
    const map = t.scenarios as Record<string, string>;
    return map[key] || key;
  };

  const ruleLabel = (key: string): string => {
    const map = t.rules as Record<string, string>;
    return map[key] || key;
  };

  const verdictLabel = (key: string): string => {
    const map = t.verdicts as Record<string, string>;
    return map[key] || key;
  };

  const formatKzt = (amount: number): string => {
    const locale = lang === "en" ? "en-US" : "ru-KZ";
    return `${new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(Math.round(amount))} ₸`;
  };

  return (
    <LabContext.Provider
      value={{
        lang,
        setLang,
        t,
        theme,
        setTheme,
        bgAnimationEnabled,
        setBgAnimationEnabled,
        selectedDatasetId,
        setSelectedDatasetId,
        selectedExperimentId,
        setSelectedExperimentId,
        defaultSimParams,
        setDefaultSimParams,
        scenarioLabel,
        ruleLabel,
        verdictLabel,
        formatKzt,
      }}
    >
      {children}
    </LabContext.Provider>
  );
};

export function useLab(): LabContextValue {
  const ctx = useContext(LabContext);
  if (!ctx) {
    throw new Error("useLab must be used inside LabProvider");
  }
  return ctx;
}
