"use client";

import type { Sector } from "@/types/database";

interface SectorGridProps {
  sectors: Sector[];
  selected: string[];
  onToggle: (sectorId: string) => void;
  min?: number;
  max?: number;
}

export function SectorGrid({
  sectors,
  selected,
  onToggle,
  min = 3,
  max = 8,
}: SectorGridProps) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sectors
          .filter((s) => s.is_active)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((sector) => {
            const isSelected = selected.includes(sector.id);
            const atMax = selected.length >= max && !isSelected;

            return (
              <button
                key={sector.id}
                type="button"
                data-selected={isSelected ? "true" : "false"}
                disabled={atMax}
                onClick={() => onToggle(sector.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  isSelected
                    ? "border-accent bg-accent/10 text-accent font-medium"
                    : "border-border bg-background text-foreground hover:border-accent/50"
                } ${atMax ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
              >
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    isSelected
                      ? "border-accent bg-accent"
                      : "border-foreground-secondary/30"
                  }`}
                >
                  {isSelected && (
                    <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                {sector.name}
              </button>
            );
          })}
      </div>
      <p className="mt-3 text-xs text-foreground-secondary">
        Selecione de {min} a {max} setores ({selected.length} selecionados)
      </p>
    </div>
  );
}
