import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/core/lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 font-medium select-none transition-all duration-200 ease-apple active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg whitespace-nowrap",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-white hover:bg-brand-600 shadow-soft hover:shadow-card",
        secondary:
          "bg-surface text-ink border border-border hover:bg-elevated hover:border-ink-subtle/40 shadow-soft",
        ghost: "text-ink hover:bg-border/50",
        subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
        danger:
          "bg-danger text-white hover:bg-danger/90 shadow-soft",
        outline: "border border-border text-ink hover:bg-border/30",
      },
      size: {
        sm: "h-8 px-3 text-[13px] rounded-[10px]",
        md: "h-10 px-4 text-sm rounded-[12px]",
        lg: "h-12 px-5 text-[15px] rounded-[14px]",
        icon: "h-9 w-9 rounded-[10px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
