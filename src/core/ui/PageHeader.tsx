import type { ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 pb-5 sm:pb-6 border-b border-border mb-5 sm:mb-6",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[20px] sm:text-[22px] font-semibold text-ink tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 sm:shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}
