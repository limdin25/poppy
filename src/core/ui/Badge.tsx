import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/core/lib/cn";

const badge = cva(
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border",
  {
    variants: {
      tone: {
        neutral: "bg-border/30 text-ink-muted border-border",
        brand: "bg-brand-50 text-brand-700 border-brand-100",
        success: "bg-success/10 text-success border-success/20",
        warning: "bg-warning/10 text-warning border-warning/20",
        danger: "bg-danger/10 text-danger border-danger/20",
        outline: "bg-transparent text-ink-muted border-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} {...props}>
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", {
            "bg-ink-muted": tone === "neutral" || tone === "outline",
            "bg-brand": tone === "brand",
            "bg-success": tone === "success",
            "bg-warning": tone === "warning",
            "bg-danger": tone === "danger",
          })}
        />
      )}
      {children}
    </span>
  );
}
