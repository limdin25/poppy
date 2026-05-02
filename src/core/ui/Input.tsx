import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/core/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-[12px] bg-surface border border-border px-3.5 text-sm text-ink placeholder:text-ink-subtle",
        "transition-all duration-200 ease-apple",
        "focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-[12px] bg-surface border border-border px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle",
        "transition-all duration-200 ease-apple resize-y min-h-[88px]",
        "focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export function Label({
  children,
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium text-ink block mb-1.5", className)}
      {...props}
    >
      {children}
    </label>
  );
}
