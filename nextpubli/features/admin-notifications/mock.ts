import type { AppNotification } from "@/types/database";

// Newest first, like getNotifications() returns.
export const mockNotifications: AppNotification[] = [
  {
    id: "n1",
    type: "account_connected",
    profile_id: "p1",
    title: "Nova conta conectada: @ana.silva",
    body: "Ana Silva conectou o Instagram e ainda não está na campanha.",
    read_at: null,
    // 20:00 UTC = 17:00 in São Paulo
    created_at: "2026-06-12T20:00:00.000Z",
  },
  {
    id: "n2",
    type: "generic",
    profile_id: null,
    title: "Aviso do sistema",
    body: "Manutenção programada para o fim de semana.",
    read_at: "2026-06-11T15:00:00.000Z",
    created_at: "2026-06-11T12:00:00.000Z",
  },
  {
    id: "n3",
    type: "generic",
    profile_id: null,
    title: "Relatório semanal disponível",
    body: null,
    read_at: null,
    created_at: "2026-06-10T12:00:00.000Z",
  },
];
