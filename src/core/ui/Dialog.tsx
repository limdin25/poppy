import { useEffect, type ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  width?: "sm" | "md" | "lg" | "xl";
}

const widths = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function Dialog({ open, onClose, children, className, width = "md" }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative bg-surface rounded-2xl shadow-pop border border-border w-full overflow-hidden",
          widths[width],
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return (
    <div className="p-6 border-b border-border">
      <div className="text-base font-semibold text-ink tracking-tight">
        {children}
      </div>
    </div>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-6", className)}>{children}</div>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="p-4 border-t border-border bg-bg/40 flex items-center justify-end gap-2">
      {children}
    </div>
  );
}
