import type { Brand } from "@/types/database";

export const BRANDS: Brand[] = [
  {
    id: "brand-1",
    name: "ScanPlates",
    logo_url: null,
    description: "App de nutrição — R$59,99/mês por assinante",
    hotmart_product_id: null,
    hotmart_product_url: null,
    share_base_url: "https://www.scanplates.com/",
    commission_rate: 0.2,
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
    hotmart_product_id: null,
    hotmart_product_url: null,
    share_base_url: null,
    commission_rate: 0.2,
    target_sectors: ["esporte-fitness", "saude-bem-estar"],
    is_active: false,
    created_at: "2026-05-18T00:00:00Z",
  },
  {
    id: "brand-3",
    name: "GlowUp",
    logo_url: null,
    description: "Cosméticos naturais",
    hotmart_product_id: null,
    hotmart_product_url: null,
    share_base_url: null,
    commission_rate: 0.2,
    target_sectors: ["beleza-cosmeticos"],
    is_active: false,
    created_at: "2026-05-18T00:00:00Z",
  },
];
