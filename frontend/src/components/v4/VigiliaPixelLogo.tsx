import React from "react";

interface VigiliaPixelLogoProps {
  variant?: "hero" | "sidebar" | "mark";
  size?: number;
}

/**
 * Official VIGILIA pixel-art cyber-eye emblem and wordmark.
 * Uses transparent assets extracted from the approved green pixel logo.
 */
export const VigiliaPixelLogo: React.FC<VigiliaPixelLogoProps> = ({
  variant = "sidebar",
  size,
}) => {
  if (variant === "mark") {
    return (
      <img
        src="/vigilia-eye.png"
        alt="VIGILIA"
        style={size ? { height: `${size}px` } : undefined}
        className="h-8 w-auto object-contain select-none drop-shadow-[0_4px_12px_rgba(0,184,70,0.35)]"
        draggable={false}
      />
    );
  }

  if (variant === "sidebar") {
    return (
      <div className="relative inline-flex items-center justify-center">
        <img
          src="/vigilia-logo.png"
          alt="VIGILIA"
          className="h-14 w-auto object-contain select-none drop-shadow-[0_6px_18px_rgba(0,184,70,0.28)]"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Soft ambient green glow directly behind transparent pixel logo */}
      <div
        aria-hidden="true"
        className="absolute inset-x-4 inset-y-2 rounded-full blur-3xl opacity-55 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(0,184,70,0.42) 0%, rgba(0,127,48,0.14) 55%, rgba(8,10,9,0) 78%)",
        }}
      />
      <img
        src="/vigilia-logo.png"
        alt="VIGILIA"
        className="relative w-[220px] sm:w-[270px] h-auto object-contain select-none drop-shadow-[0_18px_40px_rgba(0,184,70,0.28)]"
        draggable={false}
      />
    </div>
  );
};
