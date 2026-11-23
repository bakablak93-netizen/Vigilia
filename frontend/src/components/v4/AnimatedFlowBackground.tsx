import React from "react";

interface AnimatedFlowBackgroundProps {
  compact?: boolean;
  paused?: boolean;
  enabled?: boolean;
  variant?: "page" | "modal";
}

/**
 * Dynamic borderless-dark animated emerald wave background (#0A0E0D).
 * Covers upper (5-25%), middle (35-65%), and lower (75-95%) viewport bands uniformly,
 * and supports `variant="modal"` for delicate animated wave layering inside overlay modals.
 */
export const AnimatedFlowBackground: React.FC<AnimatedFlowBackgroundProps> = ({
  enabled = true,
  variant = "page",
}) => {
  const isModal = variant === "modal";

  return (
    <div
      aria-hidden="true"
      className={
        isModal
          ? "pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-25"
          : "pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0A0E0D]"
      }
    >
      {/* Soft top-center ambient emerald glow */}
      {!isModal && (
        <div
          className="absolute -top-44 left-1/2 -translate-x-1/2 w-[1200px] h-[540px] rounded-full blur-3xl opacity-25"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(16, 185, 129, 0.28) 0%, rgba(5, 150, 105, 0.08) 55%, rgba(10, 14, 13, 0) 80%)",
          }}
        />
      )}

      {enabled && (
        <svg
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          className="w-full h-full"
          style={{ filter: "drop-shadow(0 0 8px rgba(16, 185, 129, 0.30))" }}
        >
          <defs>
            <linearGradient id={`waveE1-${variant}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.10" />
              <stop offset="30%" stopColor="#10B981" stopOpacity="0.40" />
              <stop offset="70%" stopColor="#34D399" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.10" />
            </linearGradient>
            <linearGradient id={`waveE2-${variant}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#047857" stopOpacity="0.08" />
              <stop offset="45%" stopColor="#10B981" stopOpacity="0.32" />
              <stop offset="85%" stopColor="#34D399" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Upper Band (5-25% height): under navbar & stepper */}
          <g className="v5-wave-2">
            <path
              d="M -450 95 C -90 210, 260 15, 630 125 C 1000 235, 1330 25, 1700 135 C 1980 215, 2140 55, 2320 110"
              fill="none"
              stroke={`url(#waveE2-${variant})`}
              strokeWidth="1.7"
            />
            <path
              d="M -450 185 C -60 75, 290 250, 660 155 C 1030 60, 1360 240, 1720 150 C 1980 85, 2140 210, 2320 165"
              fill="none"
              stroke={`url(#waveE1-${variant})`}
              strokeWidth="1.5"
            />
          </g>

          {/* Middle Band (35-65% height) */}
          <g className="v5-wave-1">
            <path
              d="M -450 420 C -80 280, 290 560, 670 400 C 1050 240, 1380 540, 1740 390 C 1990 290, 2150 480, 2320 400"
              fill="none"
              stroke={`url(#waveE1-${variant})`}
              strokeWidth="1.9"
            />
            <path
              d="M -450 515 C -100 615, 250 375, 620 495 C 990 615, 1320 390, 1690 505 C 1960 590, 2130 430, 2320 485"
              fill="none"
              stroke={`url(#waveE2-${variant})`}
              strokeWidth="1.6"
            />
          </g>

          {/* Lower Band (75-95% height): under cards & bottom bar */}
          <g className="v5-wave-1">
            <path
              d="M -450 715 C -110 585, 230 840, 590 700 C 950 560, 1290 830, 1650 690 C 1930 580, 2130 775, 2320 680"
              fill="none"
              stroke={`url(#waveE1-${variant})`}
              strokeWidth="2.0"
            />
            <path
              d="M -450 810 C -70 700, 270 885, 640 785 C 1010 685, 1340 875, 1700 775 C 1970 700, 2150 845, 2320 770"
              fill="none"
              stroke={`url(#waveE2-${variant})`}
              strokeWidth="1.7"
            />
          </g>
        </svg>
      )}
    </div>
  );
};
