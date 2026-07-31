export const copy = {
  title: "Notificações",
  filterLabel: "Filtrar notificações",
  filterAll: "Todas",
  filterUnread: "Não lidas",
  markAllRead: "Marcar todas como lidas",
  markRead: "Marcar como lida",
  unreadBadge: "Não lida",
  empty: "Nenhuma notificação.",
  addToCampaign: "Adicionar à campanha",
  unreadCount: (n: number) => (n === 1 ? "1 não lida" : `${n} não lidas`),
} as const;
