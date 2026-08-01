# admin-campaign

Admin screen for the standing campaign: a timeline of stories/reels (campaign items,
each with media + caption + absolute date/time in Sao Paulo time) and the accounts
(campaign members) that receive them.

## What it does

- **Schedule**: list/add/edit/delete campaign items, with type and upcoming/past
  filters. Adding an item schedules it for every member (future items only); editing
  mirrors onto pending posts; deleting cancels pending posts (published history stays).
- **Accounts**: list members with added-at timestamps and start mode, remove members,
  and add connected accounts that are not yet in the campaign, optionally with
  **Start now** (the campaign's first item publishes immediately).

## Public exports

- `AdminCampaign`: props are `campaign`, `items`, `members` (`CampaignMemberRow[]`),
  `candidates` (`ConnectedAccountRow[]`), `brands`.

## Data dependencies

- Server actions: `@/lib/actions/campaigns` (createCampaignItem, updateCampaignItem,
  deleteCampaignItem, addMembersToCampaign, removeMemberFromCampaign, updateCampaign).
- Display helpers: `formatSaoPaulo` / `utcIsoToSpLocal` from `@/lib/timezone`.
- Page data: `@/lib/data/campaigns` (fetched in `app/(admin)/admin/campaign/page.tsx`).
