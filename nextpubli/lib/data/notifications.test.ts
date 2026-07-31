import { describe, it, expect, vi, beforeEach } from "vitest";

interface TableCfg {
  data?: unknown;
  count?: number;
}

let cfg: Record<string, TableCfg> = {};
const inserted: Record<string, unknown[]> = {};

function makeBuilder(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: () => b,
    insert: (row: unknown) => {
      (inserted[table] ??= []).push(row);
      return b;
    },
    update: () => b,
    eq: () => b,
    in: () => b,
    is: () => b,
    not: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () =>
      Promise.resolve({ data: (cfg[table]?.data as unknown[] | undefined)?.[0] ?? null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: cfg[table]?.data ?? [], count: cfg[table]?.count ?? 0 }),
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: makeBuilder }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: makeBuilder }),
}));

const sendEmailMock = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/integrations/resend", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import {
  createNotification,
  getUnreadNotificationCount,
  notifyAccountConnected,
} from "./notifications";

beforeEach(() => {
  cfg = {};
  for (const k of Object.keys(inserted)) delete inserted[k];
  sendEmailMock.mockClear();
});

describe("createNotification", () => {
  it("inserts the notification row", async () => {
    await createNotification({
      type: "account_connected",
      profile_id: "user-1",
      title: "Nova conta conectada",
      body: "@ana entrou",
    });
    expect(inserted.notifications).toHaveLength(1);
    expect(inserted.notifications[0]).toMatchObject({
      type: "account_connected",
      profile_id: "user-1",
      read_at: null,
    });
  });
});

describe("getUnreadNotificationCount", () => {
  it("returns the unread count", async () => {
    cfg = { notifications: { count: 3 } };
    expect(await getUnreadNotificationCount()).toBe(3);
  });
});

describe("notifyAccountConnected", () => {
  it("creates an in-app notification and emails every real admin", async () => {
    cfg = {
      profiles: {
        data: [
          { id: "adm-1", email: "hugo@example.com", is_admin: true },
          { id: "adm-2", email: "ig_x@instagram.heypubli.com", is_admin: true },
        ],
      },
    };
    await notifyAccountConnected({
      profileId: "user-1",
      igUsername: "ana.silva",
      name: "Ana Silva",
    });

    expect(inserted.notifications).toHaveLength(1);
    expect(inserted.notifications[0]).toMatchObject({ type: "account_connected" });

    // synthetic instagram.heypubli.com auth emails are not contactable → skipped
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = sendEmailMock.mock.calls[0][0] as { to: string; subject: string };
    expect(arg.to).toBe("hugo@example.com");
    expect(arg.subject).toContain("ana.silva");
  });

  it("never throws even when everything fails", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("boom"));
    cfg = { profiles: { data: [{ id: "a", email: "x@y.com", is_admin: true }] } };
    await expect(
      notifyAccountConnected({ profileId: "u", igUsername: "u", name: "U" }),
    ).resolves.toBeUndefined();
  });
});
