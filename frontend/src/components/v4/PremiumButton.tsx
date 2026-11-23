import React from "react";

interface PremiumButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "subtle";
  children: React.ReactNode;
}

export const PremiumButton: React.FC<PremiumButtonProps> = ({
  variant = "primary",
  className = "",
  children,
  ...rest
}) => {
  const cls = variant === "primary" ? "btn-primary" : "btn-subtle";
  return (
    <button className={`${cls} ${className}`} {...rest}>
      {children}
    </button>
  );
};
