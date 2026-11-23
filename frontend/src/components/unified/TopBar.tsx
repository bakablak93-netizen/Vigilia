import React from "react";
import { History, Menu, Settings } from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { Language } from "../../i18n/translations";
import { VigiliaPixelLogo } from "../v4/VigiliaPixelLogo";

interface TopBarProps {
  apiOnline: boolean;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  historyCount: number;
  showMobileNavToggle?: boolean;
  onOpenMobileNav?: () => void;
  wideLayout?: boolean;
}

export const VigiliaLogo: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <VigiliaPixelLogo variant="mark" size={size} />
);

export const TopBar: React.FC<TopBarProps> = ({
  apiOnline,
  onOpenHistory,
  onOpenSettings,
  historyCount,
  showMobileNavToggle = false,
  onOpenMobileNav,
  wideLayout = false,
}) => {
  const { t, lang, setLang } = useLab();
  const statusTooltip = `${t.envStatus.sandbox} · ${
    apiOnline ? t.envStatus.online : t.envStatus.offline
  }`;

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{
        background:
          "linear-gradient(180deg, rgba(8,10,9,0.92) 0%, rgba(11,15,13,0.86) 100%)",
        boxShadow:
          "inset 0 -1px 0 rgba(255,255,255,0.045), 0 8px 24px rgba(0,0,0,0.42)",
      }}
    >
      <div
        className={`${
          wideLayout ? "px-4 sm:px-6" : "max-w-6xl mx-auto px-4 sm:px-6"
        } h-14 flex items-center justify-between gap-3`}
      >
        {/* Left: Optional mobile nav button + Pixel Brand + discreet API dot */}
        <div className="flex items-center gap-2.5 min-w-0">
          {showMobileNavToggle && onOpenMobileNav && (
            <button
              type="button"
              onClick={onOpenMobileNav}
              className="md:hidden btn-subtle p-2 rounded-xl"
              aria-label="Menu"
            >
              <Menu className="h-4 w-4 text-[#43D17A]" />
            </button>
          )}
          <div className="flex items-center gap-2.5 min-w-0" title={statusTooltip}>
            <VigiliaPixelLogo variant="mark" size={24} />
            <span className="text-base font-bold tracking-tight text-[#F4F6F4]">
              {t.appTitle}
            </span>
            <span
              aria-label={statusTooltip}
              className={`h-2 w-2 rounded-full shrink-0 ${
                apiOnline
                  ? "bg-[#43D17A] shadow-[0_0_8px_rgba(67,209,122,0.55)]"
                  : "bg-[#F16B6B]"
              }`}
            />
          </div>
        </div>

        {/* Right: RU / KZ / EN, History, Settings (no fake profile label) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="v4-surface-inset flex items-center gap-0.5 p-0.5 rounded-xl">
            {(["ru", "kk", "en"] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`px-2.5 py-1 text-[11px] font-semibold uppercase rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846] ${
                  lang === code
                    ? "bg-[#00B846] text-[#F4F6F4] shadow-[0_2px_10px_rgba(0,184,70,0.35)]"
                    : "text-[#77837C] hover:text-[#F4F6F4]"
                }`}
              >
                {code === "kk" ? "KZ" : code.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenHistory}
            className="btn-subtle py-1.5 px-3 text-xs"
            aria-label={t.topBar.history}
            title={t.topBar.history}
          >
            <History className="h-3.5 w-3.5 text-[#43D17A]" />
            <span className="hidden sm:inline">{t.topBar.history}</span>
            {historyCount > 0 && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-[#00B846]/20 text-[#43D17A]">
                {historyCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-subtle py-1.5 px-2.5 text-xs"
            aria-label={t.topBar.settings}
            title={t.topBar.settings}
          >
            <Settings className="h-3.5 w-3.5 text-[#A1ABA4]" />
            <span className="hidden sm:inline">{t.topBar.settings}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
