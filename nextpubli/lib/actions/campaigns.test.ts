import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cfg: Record<string, any> = {};
let ops: { table: string; op: string; payload?: unknown; opts?: unknown }[] = [];

// requireAdmin() uses the server client: getUser + profiles.is_admin.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { is_admin: true } }) }),
      }),
    }),
  }),
}));

// All mutations + data-layer reads run on the service-role client.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        insert: (payload: unknown) => {
          ops.push({ table, op: "insert", payload });
          return b;
        },
        upsert: (payload: unknown, opts: unknown) => {
          ops.push({ table, op: "upsert", payload, opts });
          return b;
        },
        update: (payload: unknown) => {
          ops.push({ table, op: "update", payload });
          return b;
        },
        delete: () => {
          ops.push({ table, op: "delete" });
          return b;
        },
        eq: () => b,
        in: () => b,
        is: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: cfg[table]?.maybeSingle ?? null }),
        single: () => Promise.resolve({ data: cfg[table]?.single ?? null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: cfg[table]?.list ?? [], error: cfg[table]?.error ?? null }),
      };
      return b;
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createCampaignItem,
  updateCampaignItem,
  deleteCampaignItem,
  addMembersToCampaign,
  removeMemberFromCampaign,
} from "./campaigns";

const campaign = {
  id: "camp-1",
  name: "Campanha Principal",
  description: null,
  brand_id: "brand-1",
  is_default: true,
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const futureItem = {
  id: "item-1",
  campaign_id: "camp-1",
  brand_id: "brand-1",
  media_type: "story_image",
  media_url: "https://cdn.example.com/s.jpg",
  caption: "Oi",
  scheduled_at: "2099-06-12T20:00:00Z",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  cfg = {};
  ops = [];
  getUser.mockResolvedValue({ data: { user: { id: "admin1" } } });
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("createCampaignItem", () => {
  it("rejects a missing media URL", async () => {
    cfg = { campaigns: { maybeSingle: campaign } };
    const r = await createCampaignItem(
      form({
        campaign_id: "camp-1",
        media_type: "reel",
        media_url: "",
        caption: "x",
        scheduled_at: "2099-06-12T17:00",
      }),
    );
    expect(r).toEqual({ error: expect.stringMatching(/mídia/i) });
    expect(ops).toHaveLength(0);
  });

  it("converts São Paulo input to UTC, inserts the item, and materializes posts for members", async () => {
    cfg = {
      campaigns: { maybeSingle: campaign },
      campaign_items: { single: futureItem },
      campaign_members: {
        list: [{ id: "m1", campaign_id: "camp-1", profile_id: "user-1" }],
      },
      profiles: { list: [{ id: "user-1" }] },
      posting_settings: { single: { active_provider: "outstand" } },
    };
    const r = await createCampaignItem(
      form({
        campaign_id: "camp-1",
        media_type: "story_image",
        media_url: "https://cdn.example.com/s.jpg",
        caption: "Oi",
        scheduled_at: "2099-06-12T17:00",
      }),
    );
    expect(r).toMatchObject({ success: true, postsCreated: 1 });

    const insert = ops.find((o) => o.table === "campaign_items" && o.op === "insert");
    expect(insert?.payload).toMatchObject({ scheduled_at: "2099-06-12T20:00:00.000Z" });

    const posts = ops.find((o) => o.table === "scheduled_posts" && o.op === "upsert");
    expect(posts).toBeTruthy();
    expect((posts?.payload as unknown[]).length).toBe(1);
    expect((posts?.payload as Record<string, unknown>[])[0]).toMatchObject({
      profile_id: "user-1",
      campaign_item_id: "item-1",
      status: "pending",
    });
  });

  it("skips suspended members when materializing posts", async () => {
    cfg = {
      campaigns: { maybeSingle: campaign },
      campaign_items: { single: futureItem },
      campaign_members: {
        list: [
          { id: "m1", campaign_id: "camp-1", profile_id: "user-1" },
          { id: "m2", campaign_id: "camp-1", profile_id: "user-suspended" },
        ],
      },
      // Only user-1 comes back from the suspended_at-is-null query.
      profiles: { list: [{ id: "user-1" }] },
      posting_settings: { single: { active_provider: "outstand" } },
    };
    const r = await createCampaignItem(
      form({
        campaign_id: "camp-1",
        media_type: "story_image",
        media_url: "https://cdn.example.com/s.jpg",
        caption: "Oi",
        scheduled_at: "2099-06-12T17:00",
      }),
    );
    expect(r).toMatchObject({ success: true, postsCreated: 1 });
  });

  it("stores instagram options (collaborators, first comment) on the item", async () => {
    cfg = {
      campaigns: { maybeSingle: campaign },
      campaign_items: { single: futureItem },
      campaign_members: { list: [] },
      posting_settings: { single: { active_provider: "outstand" } },
    };
    const r = await createCampaignItem(
      form({
        campaign_id: "camp-1",
        media_type: "reel",
        media_url: "https://cdn.example.com/r.mp4",
        caption: "Oi",
        scheduled_at: "2099-06-12T17:00",
        collaborators: "@scanplates, @parceiro",
        first_comment: "Garanta o seu!",
        reel_cover_seconds: "2.5",
      }),
    );
    expect(r).toMatchObject({ success: true });

    const insert = ops.find((o) => o.table === "campaign_items" && o.op === "insert");
    expect(insert?.payload).toMatchObject({
      instagram_options: {
        collaborators: ["scanplates", "parceiro"],
        first_comment: "Garanta o seu!",
        reel_cover_seconds: 2.5,
      },
    });
  });
});

describe("updateCampaignItem", () => {
  it("updates the item and mirrors the change onto pending derived posts", async () => {
    cfg = {
      campaigns: { maybeSingle: campaign },
      campaign_items: { maybeSingle: futureItem, single: futureItem },
      campaign_members: { list: [] },
      posting_settings: { single: { active_provider: "outstand" } },
    };
    const r = await updateCampaignItem(
      "item-1",
      form({
        media_type: "reel",
        media_url: "https://cdn.example.com/r.mp4",
        caption: "Novo",
        scheduled_at: "2099-07-01T10:00",
      }),
    );
    expect(r).toEqual({ success: true });

    const itemUpdate = ops.find((o) => o.table === "campaign_items" && o.op === "update");
    expect(itemUpdate?.payload).toMatchObject({
      media_type: "reel",
      scheduled_at: "2099-07-01T13:00:00.000Z",
    });
    const postsUpdate = ops.find(
      (o) => o.table === "scheduled_posts" && o.op === "update",
    );
    expect(postsUpdate?.payload).toMatchObject({
      media_type: "reel",
      scheduled_at: "2099-07-01T13:00:00.000Z",
    });
  });
});

describe("deleteCampaignItem", () => {
  it("deletes pending derived posts before deleting the item", async () => {
    cfg = { campaign_items: { maybeSingle: futureItem } };
    const r = await deleteCampaignItem("item-1");
    expect(r).toEqual({ success: true });
    const postDelete = ops.findIndex((o) => o.table === "scheduled_posts");
    const itemDelete = ops.findIndex(
      (o) => o.table === "campaign_items" && o.op === "delete",
    );
    expect(postDelete).toBeGreaterThanOrEqual(0);
    expect(itemDelete).toBeGreaterThan(postDelete);
  });
});

describe("addMembersToCampaign", () => {
  it("adds members, materializes future posts, and clears their connect notifications", async () => {
    cfg = {
      campaigns: { maybeSingle: campaign },
      campaign_items: { list: [futureItem] },
      profiles: { list: [{ id: "user-1" }, { id: "user-2" }] },
      posting_settings: { single: { active_provider: "outstand" } },
    };
    const r = await addMembersToCampaign("camp-1", ["user-1", "user-2"], false);
    expect(r).toMatchObject({ success: true });

    const memberUpsert = ops.find(
      (o) => o.table === "campaign_members" && o.op === "upsert",
    );
    expect((memberUpsert?.payload as unknown[]).length).toBe(2);
    expect((memberUpsert?.payload as Record<string, unknown>[])[0]).toMatchObject({
      start_mode: "schedule",
      added_by: "admin1",
    });

    const postsUpsert = ops.find(
      (o) => o.table === "scheduled_posts" && o.op === "upsert",
    );
    expect((postsUpsert?.payload as unknown[]).length).toBe(2);

    const notifUpdate = ops.find((o) => o.table === "notifications" && o.op === "update");
    expect(notifUpdate?.payload).toMatchObject({ read_at: expect.any(String) });
  });

  it("start-now schedules the campaign's first item immediately", async () => {
    cfg = {
      campaigns: { maybeSingle: campaign },
      campaign_items: { list: [futureItem] },
      profiles: { list: [{ id: "user-1" }] },
      posting_settings: { single: { active_provider: "outstand" } },
    };
    const before = Date.now();
    const r = await addMembersToCampaign("camp-1", ["user-1"], true);
    expect(r).toMatchObject({ success: true });

    const postsUpsert = ops.find(
      (o) => o.table === "scheduled_posts" && o.op === "upsert",
    );
    const row = (postsUpsert?.payload as { scheduled_at: string }[])[0];
    const t = new Date(row.scheduled_at).getTime();
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("removeMemberFromCampaign", () => {
  it("deletes the member's pending campaign posts and the membership", async () => {
    const r = await removeMemberFromCampaign("camp-1", "user-1");
    expect(r).toEqual({ success: true });
    expect(ops.map((o) => `${o.table}:${o.op}`)).toEqual([
      "scheduled_posts:delete",
      "campaign_members:delete",
    ]);
  });
});
