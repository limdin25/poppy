import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/core/lib/cn";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-10 w-full rounded-[12px] bg-surface border border-border px-3 pr-9 text-sm text-ink",
      "transition-all duration-200 ease-apple appearance-none",
      "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2356647A%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22></polyline></svg>')] bg-no-repeat bg-[right_0.75rem_center]",
      "focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
