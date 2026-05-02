import type { ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-6",
        className
      )}
    >
      {icon && (
        <div className="h-14 w-14 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-ink tracking-tight">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-ink-muted mt-1.5 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
