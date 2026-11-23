import React, { useEffect } from "react";
import { X } from "lucide-react";
import { AnimatedFlowBackground } from "./AnimatedFlowBackground";

interface DetailOverlayModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Unified borderless-dark glassmorphic detail modal with animated emerald waves inside.
 * Closes on backdrop click or Escape key.
 */
export const DetailOverlayModal: React.FC<DetailOverlayModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#050807]/75 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative overflow-hidden bg-[#0E1412]/88 backdrop-blur-xl rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-[0_32px_80px_-16px_rgba(0,0,0,0.85)] v5-modal-enter"
      >
        <AnimatedFlowBackground variant="modal" enabled />

        {/* Header */}
        <div className="relative z-10 px-6 sm:px-8 pt-6 pb-4 flex items-start justify-between gap-4 shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1F5F9]">
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p className="text-sm text-[#94A3B8] leading-relaxed">{subtitle}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl bg-[#161E1B]/85 hover:bg-[#1E2925] text-[#94A3B8] hover:text-[#F1F5F9] transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="relative z-10 px-6 sm:px-8 pb-7 pt-1 overflow-y-auto space-y-5">
          {children}
        </div>
      </div>
    </div>
  );
};
