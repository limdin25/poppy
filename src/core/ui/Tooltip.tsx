import { useState, type ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const positions = {
    top: "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2",
    bottom: "top-[calc(100%+6px)] left-1/2 -translate-x-1/2",
    left: "right-[calc(100%+6px)] top-1/2 -translate-y-1/2",
    right: "left-[calc(100%+6px)] top-1/2 -translate-y-1/2",
  };
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 px-2.5 py-1.5 rounded-md bg-ink text-white text-[11px] font-medium whitespace-nowrap shadow-pop pointer-events-none",
            positions[side],
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
