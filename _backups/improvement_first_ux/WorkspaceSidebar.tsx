import React from "react";
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  History,
  LayoutDashboard,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useLab } from "../../context/LabContext";
import type { Language } from "../../i18n/translations";
import { VigiliaPixelLogo } from "./VigiliaPixelLogo";

export type WorkspaceNavSectionId =
  | "sec-overview"
  | "sec-weaknesses"
  | "sec-proposals"
  | "sec-verify"
  | "sec-comparison"
  | "sec-analytics"
  | "sec-history";

export interface SidebarStatusFlags {
  checked: boolean;
  hasProblems: boolean;
  hasProposals: boolean;
  verifiedImprovements: boolean;
  isBlackBox: boolean;
}

interface WorkspaceSidebarProps {
  activeSection: WorkspaceNavSectionId;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onNavigate: (section: WorkspaceNavSectionId) => void;
  onNewCheck: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  historyCount: number;
  apiOnline: boolean;
  engineLabel: string;
  versionLabel: string;
  flags: SidebarStatusFlags;
}

/**
 * Floating detached fixed Left Sidebar for Frame 13 Workspace.
 * Has outer spacing top/left/bottom, houses the official pixel VIGILIA logo,
 * engine context, navigation 01-07, RU/KZ/EN, History, Settings, and New Check.
 */
export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  activeSection,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onNavigate,
  onNewCheck,
  onOpenHistory,
  onOpenSettings,
  historyCount,
  apiOnline,
  engineLabel,
  versionLabel,
  flags,
}) => {
  const { t, lang, setLang } = useLab();

  const items: Array<{
    id: WorkspaceNavSectionId;
    num: string;
    label: string;
    tone: "green" | "amber" | "muted";
    icon: React.ReactNode;
  }> = [
    {
      id: "sec-overview",
      num: "01",
      label: t.v4.navOverview,
      tone: flags.checked ? "green" : "muted",
      icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
    },
    {
      id: "sec-weaknesses",
      num: "02",
      label: t.v4.navWeaknesses,
      tone: flags.hasProblems ? "amber" : "green",
      icon: <AlertTriangle className="h-4 w-4 shrink-0" />,
    },
    {
      id: "sec-proposals",
      num: "03",
      label: t.v4.navProposals,
      tone: flags.hasProposals ? "green" : "muted",
      icon: <Sparkles className="h-4 w-4 shrink-0" />,
    },
    {
      id: "sec-verify",
      num: "04",
      label: t.v4.navVerify,
      tone: flags.verifiedImprovements ? "green" : "muted",
      icon: <ShieldCheck className="h-4 w-4 shrink-0" />,
    },
    {
      id: "sec-comparison",
      num: "05",
      label: t.v4.navComparison,
      tone: flags.verifiedImprovements ? "green" : "muted",
      icon: <GitCompareArrows className="h-4 w-4 shrink-0" />,
    },
    {
      id: "sec-analytics",
      num: "06",
      label: t.v4.navAnalytics,
      tone: flags.checked ? "green" : "muted",
      icon: <BarChart3 className="h-4 w-4 shrink-0" />,
    },
    {
      id: "sec-history",
      num: "07",
      label: t.v4.navHistoryReports,
      tone: flags.checked ? "green" : "muted",
      icon: <History className="h-4 w-4 shrink-0" />,
    },
  ];

  const toneDot: Record<"green" | "amber" | "muted", string> = {
    green: "bg-[#43D17A]",
    amber: "bg-[#E3AD56]",
    muted: "bg-[#55605A]",
  };

  const renderSidebarBody = (isMobileDrawer: boolean) => {
    const isNarrow = collapsed && !isMobileDrawer;

    return (
      <div className="flex flex-col h-full">
        {/* Brand + Official Pixel Logo + Context */}
        <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            {isNarrow ? (
              <div className="mx-auto">
                <VigiliaPixelLogo variant="mark" />
              </div>
            ) : (
              <VigiliaPixelLogo variant="sidebar" />
            )}

            {isMobileDrawer ? (
              <button
                type="button"
                onClick={onCloseMobile}
                className="btn-subtle p-2 rounded-xl"
                aria-label={t.settings.close}
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              !isNarrow && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  title={t.v4.collapseSidebar}
                  className="btn-subtle p-2 rounded-xl shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )
            )}
          </div>

          {isNarrow && !isMobileDrawer && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={t.v4.expandSidebar}
              className="btn-subtle p-2 rounded-xl mx-auto"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {!isNarrow && (
            <div className="v4-surface-inset px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-[#F4F6F4] truncate">
                  {engineLabel}
                </div>
                <div className="text-[10px] font-mono text-[#77837C] truncate">
                  {versionLabel}
                </div>
              </div>
              <span
                title={apiOnline ? t.envStatus.online : t.envStatus.offline}
                className={`h-2 w-2 rounded-full shrink-0 ${
                  apiOnline
                    ? "bg-[#43D17A] shadow-[0_0_8px_rgba(67,209,122,0.55)]"
                    : "bg-[#F16B6B]"
                }`}
              />
            </div>
          )}
        </div>

        {/* Navigation 01-07 */}
        <nav className="flex-1 px-2.5 py-1.5 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  if (isMobileDrawer) onCloseMobile();
                }}
                title={isNarrow ? item.label : undefined}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition-all duration-200 flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00B846] ${
                  isActive
                    ? "text-[#F4F6F4] shadow-[inset_0_1px_0_rgba(67,209,122,0.3),0_8px_20px_rgba(0,184,70,0.24)]"
                    : "text-[#A1ABA4] hover:text-[#F4F6F4] hover:bg-[#1D2420]/70"
                }`}
                style={
                  isActive
                    ? {
                        background:
                          "linear-gradient(135deg, rgba(0,184,70,0.30) 0%, rgba(21,26,23,0.95) 100%)",
                      }
                    : undefined
                }
              >
                <span className={isActive ? "text-[#43D17A]" : "text-[#77837C]"}>
                  {item.icon}
                </span>

                {!isNarrow && (
                  <>
                    <span className="text-xs font-semibold truncate flex-1">
                      <span className="font-mono text-[10px] text-[#77837C] mr-1.5">
                        {item.num}
                      </span>
                      {item.label}
                    </span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${toneDot[item.tone]}`}
                    />
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Utilities (Language + History + Settings + New Check — replacing TopBar!) */}
        <div className="p-3 space-y-2.5">
          {!isNarrow && (
            <div className="v4-surface-inset p-1 rounded-xl flex items-center justify-between gap-1">
              {(["ru", "kk", "en"] as Language[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`flex-1 py-1.5 text-[11px] font-bold uppercase rounded-lg transition-all ${
                    lang === code
                      ? "bg-[#00B846] text-[#F4F6F4] shadow-[0_3px_10px_rgba(0,184,70,0.38)]"
                      : "text-[#77837C] hover:text-[#F4F6F4]"
                  }`}
                >
                  {code === "kk" ? "KZ" : code.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {!isNarrow && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onOpenHistory();
                  if (isMobileDrawer) onCloseMobile();
                }}
                className="btn-subtle py-2 px-2.5 text-[11px] justify-center"
              >
                <History className="h-3.5 w-3.5 text-[#43D17A]" />
                <span>{t.topBar.history}</span>
                {historyCount > 0 && (
                  <span className="font-mono text-[10px] text-[#43D17A]">
                    {historyCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenSettings();
                  if (isMobileDrawer) onCloseMobile();
                }}
                className="btn-subtle py-2 px-2.5 text-[11px] justify-center"
              >
                <Settings className="h-3.5 w-3.5 text-[#A1ABA4]" />
                <span>{t.topBar.settings}</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onNewCheck();
              if (isMobileDrawer) onCloseMobile();
            }}
            title={t.focus.newCheckLink}
            className="btn-primary w-full py-2.5 px-3 text-xs justify-center"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            {!isNarrow && <span>{t.focus.newCheckLink}</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Fixed Detached Floating Desktop/Tablet Sidebar (top/left/bottom margins) */}
      <aside
        className={`hidden md:flex flex-col fixed top-4 left-4 bottom-4 z-30 v4-sidebar rounded-3xl sidebar-enter transition-all duration-300 ${
          collapsed ? "w-[74px]" : "w-[252px]"
        }`}
      >
        {renderSidebarBody(false)}
      </aside>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex p-3">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 w-[272px] max-w-[85vw] h-full v4-sidebar rounded-3xl sidebar-enter">
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}
    </>
  );
};
