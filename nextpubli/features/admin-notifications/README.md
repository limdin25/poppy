# admin-notifications

## What it does

Admin in-app notifications page: lists notifications newest first with unread indicators, a Todas/Não lidas filter, per-row and bulk mark-as-read, and an "Adicionar à campanha" link for `account_connected` notifications.

## Files

- `AdminNotifications.tsx` — main component
- `AdminNotifications.test.tsx` — Vitest tests
- `copy.ts` — PT-BR strings
- `mock.ts` — test/mock data
- `index.ts` — public exports

## Route

`/(admin)/admin/notificacoes`

## Dependencies

- `lib/actions/notifications` — `markNotificationRead`, `markAllNotificationsRead`
- `lib/timezone` — `formatSaoPaulo` for timestamps
- `types/database` — `AppNotification`
