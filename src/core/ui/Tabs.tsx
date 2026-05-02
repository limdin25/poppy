import { useState, type ReactNode } from "react";
import { cn } from "@/core/lib/cn";

interface Tab {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
  disabledReason?: string;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  variant?: "underline" | "pills";
  className?: string;
}

export function Tabs({ tabs, active, onChange, variant = "underline", className }: TabsProps) {
  if (variant === "pills") {
    return (
      <div className={cn("inline-flex gap-1 p-1 bg-border/40 rounded-[12px]", className)}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "px-3 h-8 rounded-[10px] text-sm font-medium transition-all duration-150 ease-apple",
              tab.disabled && "opacity-40 cursor-not-allowed",
              active === tab.id
                ? "bg-surface text-ink shadow-soft"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-ink-subtle">{tab.count}</span>
            )}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={cn("flex gap-1 border-b border-border", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          disabled={tab.disabled}
          title={tab.disabled ? tab.disabledReason : undefined}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative px-3.5 h-10 text-sm font-medium transition-colors duration-150",
            tab.disabled && "opacity-40 cursor-not-allowed",
            active === tab.id ? "text-ink" : "text-ink-muted hover:text-ink"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                "ml-1.5 text-xs",
                active === tab.id ? "text-brand" : "text-ink-subtle"
              )}
            >
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <span className="absolute -bottom-px left-2 right-2 h-0.5 bg-brand rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ children, when, id }: { children: ReactNode; when: string; id: string }) {
  if (when !== id) return null;
  return <div>{children}</div>;
}

export function useTabs(initial: string) {
  const [active, setActive] = useState(initial);
  return { active, setActive };
}
