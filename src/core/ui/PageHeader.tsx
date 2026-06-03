import type { ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Tiny uppercase eyebrow rendered as `// EYEBROW` above the title (waslo style). */
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
  /** No bottom border/extra margin — use when the page body is its own card. */
  bare?: boolean;
}

export function PageHeader({ title, description, eyebrow, actions, className, bare }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        bare ? "mb-5 sm:mb-6" : "mb-5 border-b border-border pb-5 sm:mb-6 sm:pb-6",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            // {eyebrow}
          </p>
        )}
        <h1 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[14px] text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
