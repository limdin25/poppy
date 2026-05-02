import type { ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface BannerProps {
  tone?: "info" | "warning" | "danger" | "success";
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

const toneStyles = {
  info: "bg-brand-50 border-brand-100 text-brand-700",
  warning: "bg-warning/10 border-warning/30 text-warning",
  danger: "bg-danger/10 border-danger/30 text-danger",
  success: "bg-success/10 border-success/30 text-success",
};

export function Banner({ tone = "info", title, description, action, className }: BannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-[14px] border",
        toneStyles[tone],
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-tight">{title}</div>
        {description && (
          <div className="text-xs opacity-90 mt-0.5">{description}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
