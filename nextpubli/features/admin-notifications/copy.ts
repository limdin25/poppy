export const copy = {
  title: "Notifications",
  filterLabel: "Filter notifications",
  filterAll: "All",
  filterUnread: "Unread only",
  markAllRead: "Mark all as read",
  markRead: "Mark as read",
  unreadBadge: "Unread",
  empty: "No notifications.",
  addToCampaign: "Add to campaign",
  unreadCount: (n: number) => (n === 1 ? "1 unread" : `${n} unread`),
} as const;
