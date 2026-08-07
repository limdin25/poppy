import type { Brand } from "@/types/database";

export const BRANDS: Brand[] = [
  {
    id: "brand-1",
    name: "ScanPlates",
    logo_url: null,
    description: "App de nutrição — R$59,99/mês por assinante",
    target_sectors: ["saude-bem-estar", "alimentacao", "esporte-fitness"],
    is_active: true,
    created_at: "2026-05-18T00:00:00Z",
  },
];

export const FUTURE_BRANDS: Brand[] = [
  {
    id: "brand-2",
    name: "FitTrack",
    logo_url: null,
    description: "App de treino personalizado",
    target_sectors: ["esporte-fitness", "saude-bem-estar"],
    is_active: false,
    created_at: "2026-05-18T00:00:00Z",
  },
  {
    id: "brand-3",
    name: "GlowUp",
    logo_url: null,
    description: "Cosméticos naturais",
    target_sectors: ["beleza-cosmeticos"],
    is_active: false,
    created_at: "2026-05-18T00:00:00Z",
  },
];
