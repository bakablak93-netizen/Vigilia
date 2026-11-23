import React, { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  durationMs?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  formatter?: (val: number) => string;
  className?: string;
}

/**
 * Semantic color helper for Recall percentage (0..100):
 * - < 50%   -> red/coral (text-rose-400)
 * - 50..75% -> amber/yellow (text-amber-400)
 * - >= 75%  -> signature emerald (text-[#43D17A])
 */
export function getRecallColorClass(recallPct: number): string {
  if (recallPct < 50) return "text-[#EF4444]";
  if (recallPct < 75) return "text-[#F59E0B]";
  return "text-[#22C55E]";
}

/**
 * Lightweight count-up number component powered by requestAnimationFrame (~680ms, cubic ease-out).
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  durationMs = 680,
  decimals = 0,
  prefix = "",
  suffix = "",
  formatter,
  className,
}) => {
  const safeTarget = Number.isFinite(value) ? value : 0;
  const [displayValue, setDisplayValue] = useState<number>(0);
  const prevValueRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || durationMs <= 0) {
      setDisplayValue(safeTarget);
      prevValueRef.current = safeTarget;
      return;
    }

    const startValue = prevValueRef.current;
    const delta = safeTarget - startValue;
    if (Math.abs(delta) < 1e-6) {
      setDisplayValue(safeTarget);
      return;
    }

    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + delta * eased;
      prevValueRef.current = current;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        setDisplayValue(safeTarget);
        prevValueRef.current = safeTarget;
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [safeTarget, durationMs]);

  const formatted = formatter
    ? formatter(displayValue)
    : displayValue.toFixed(decimals);

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
