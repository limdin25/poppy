import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// E2E for the admin management changes: scheduler lists only connected
// influencers, and suspended influencers are locked out of the app.
// Test users + connections are created/removed through the Supabase admin API.

function loadEnv(): Record<string, string> {
  const raw = readFileSync(join(__dirname, "../../.env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = env.E2E_ADMIN_PASSWORD;

function headers() {
  return {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    "Content-Type": "application/json",
  };
}

async function createUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error(`createUser failed: ${JSON.stringify(body)}`);
  return body.id;
}

async function deleteUser(id: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: headers(),
  }).catch(() => {});
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...headers(), Prefer: "return=minimal", ...init.headers },
  });
}

async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto("/login?modo=senha");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: /^entrar$/i }).click();
}

test.describe("admin password login", () => {
  test("the admin reaches /admin with email + password", async ({ page }) => {
    await loginWithPassword(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/admin/, { timeout: 20000 });
  });
});

test.describe("agendador — only connected influencers", () => {
  const connectedEmail = "e2e-agendador-conn@nextpubli-e2e.test";
  const unconnectedEmail = "e2e-agendador-noconn@nextpubli-e2e.test";
  let connectedId: string;
  let unconnectedId: string;

  test.beforeAll(async () => {
    connectedId = await createUser(connectedEmail, "E2e-Senha-Forte-123");
    unconnectedId = await createUser(unconnectedEmail, "E2e-Senha-Forte-123");
    // Give names so we can tell them apart in the UI.
    await rest(`/profiles?id=eq.${connectedId}`, {
      method: "PATCH",
      body: JSON.stringify({ first_name: "E2eConn", last_name: "Conectada" }),
    });
    await rest(`/profiles?id=eq.${unconnectedId}`, {
      method: "PATCH",
      body: JSON.stringify({ first_name: "E2eSem", last_name: "Instagram" }),
    });
    const res = await rest("/outstand_connections", {
      method: "POST",
      body: JSON.stringify({
        profile_id: connectedId,
        outstand_social_account_id: "e2e-test-acc",
        ig_username: "e2e.conn",
        is_connected: true,
      }),
    });
    if (!res.ok) throw new Error(`connection insert failed: ${await res.text()}`);
  });

  test.afterAll(async () => {
    await rest(`/outstand_connections?profile_id=eq.${connectedId}`, {
      method: "DELETE",
    });
    await deleteUser(connectedId);
    await deleteUser(unconnectedId);
  });

  test("lists the connected account and hides the one without Instagram", async ({
    page,
  }) => {
    await loginWithPassword(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/admin/, { timeout: 20000 });

    await page.goto("/admin/agendador");
    await expect(page.getByText("E2eConn Conectada")).toBeVisible();
    await expect(page.getByText("@e2e.conn")).toBeVisible();
    await expect(page.getByText("E2eSem Instagram")).toHaveCount(0);
  });
});

test.describe("suspended influencer lockout", () => {
  const email = "e2e-suspensa@nextpubli-e2e.test";
  const password = "E2e-Senha-Forte-123";
  let userId: string;

  test.beforeAll(async () => {
    userId = await createUser(email, password);
    await rest(`/profiles?id=eq.${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ suspended_at: new Date().toISOString() }),
    });
  });

  test.afterAll(async () => deleteUser(userId));

  test("logging in lands on the 'Conta suspensa' page, not the dashboard", async ({
    page,
  }) => {
    await loginWithPassword(page, email, password);
    // Server-action redirects keep the action URL in the bar; the content is
    // what matters — and a direct hit on /dashboard must bounce to /suspenso.
    await expect(page.getByRole("heading", { name: "Conta suspensa" })).toBeVisible({
      timeout: 20000,
    });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/suspenso/);
    await expect(page.getByRole("heading", { name: "Conta suspensa" })).toBeVisible();
  });
});
