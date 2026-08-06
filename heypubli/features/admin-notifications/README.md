# admin-notifications

## What it does

Admin in-app notifications page: lists notifications newest first with unread indicators, an All/Unread only filter, per-row and bulk mark-as-read, and an "Add to campaign" link for `account_connected` notifications.

## Files

- `AdminNotifications.tsx` - main component
- `AdminNotifications.test.tsx` - Vitest tests
- `copy.ts` - UI strings
- `mock.ts` - test/mock data
- `index.ts` - public exports

## Route

`/(admin)/admin/notifications`

## Dependencies

- `lib/actions/notifications` - `markNotificationRead`, `markAllNotificationsRead`
- `lib/timezone` - `formatSaoPaulo` for timestamps
- `types/database` - `AppNotification`
