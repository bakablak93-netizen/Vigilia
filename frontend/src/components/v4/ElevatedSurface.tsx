import React from "react";

interface ElevatedSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  tier?: "base" | "elevated" | "inset";
  children: React.ReactNode;
}

export const ElevatedSurface: React.FC<ElevatedSurfaceProps> = ({
  tier = "base",
  className = "",
  children,
  ...rest
}) => {
  const tierClass =
    tier === "elevated"
      ? "v4-surface-elevated"
      : tier === "inset"
        ? "v4-surface-inset"
        : "v4-surface";
  return (
    <div className={`${tierClass} ${className}`} {...rest}>
      {children}
    </div>
  );
};
