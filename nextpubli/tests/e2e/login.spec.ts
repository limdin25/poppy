import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// E2E coverage for the three login paths (magic-link button page, 8-digit code,
// password). Test users are created/deleted through the Supabase admin API —
// no real emails are sent: `generate_link` returns the token + code directly.

function loadEnv(): Record<string, string> {
  const raw = readFileSync(join(__dirname, "../../.env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function adminFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function createUser(email: string, password: string): Promise<string> {
  const res = await adminFetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string; msg?: string };
  if (!body.id) throw new Error(`createUser failed: ${JSON.stringify(body)}`);
  return body.id;
}

async function deleteUser(id: string): Promise<void> {
  await adminFetch(`/admin/users/${id}`, { method: "DELETE" }).catch(() => {});
}

async function generateMagicLink(
  email: string,
): Promise<{ tokenHash: string; emailOtp: string }> {
  const res = await adminFetch("/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const body = (await res.json()) as { hashed_token?: string; email_otp?: string };
  if (!body.hashed_token || !body.email_otp) {
    throw new Error(`generate_link failed: ${JSON.stringify(body)}`);
  }
  return { tokenHash: body.hashed_token, emailOtp: body.email_otp };
}

test.describe("login — password mode (/login?modo=senha)", () => {
  const email = "e2e-login-pw@nextpubli-e2e.test";
  const password = "E2e-Senha-Forte-123";
  let userId: string;

  test.beforeAll(async () => {
    userId = await createUser(email, password);
  });
  test.afterAll(async () => deleteUser(userId));

  test("logs in with email + password and lands on the dashboard", async ({ page }) => {
    await page.goto("/login?modo=senha");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: /^entrar$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test("shows a PT-BR error on a wrong password", async ({ page }) => {
    await page.goto("/login?modo=senha");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha").fill("senha-errada");
    await page.getByRole("button", { name: /^entrar$/i }).click();
    await expect(page.getByText("Email ou senha incorretos.")).toBeVisible();
  });
});

test.describe("login — 8-digit code", () => {
  const email = "e2e-login-code@nextpubli-e2e.test";
  let userId: string;

  test.beforeAll(async () => {
    userId = await createUser(email, "E2e-Senha-Forte-123");
  });
  test.afterAll(async () => deleteUser(userId));

  test("logs in by typing the emailed code", async ({ page }) => {
    const { emailOtp } = await generateMagicLink(email);

    await page.goto("/login");
    await page.getByRole("button", { name: /já recebeu um código/i }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel(/código de 8 dígitos/i).fill(emailOtp);
    await page.getByRole("button", { name: /entrar com código/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test("shows a PT-BR error for a wrong code", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /já recebeu um código/i }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel(/código de 8 dígitos/i).fill("00000000");
    await page.getByRole("button", { name: /entrar com código/i }).click();
    await expect(page.getByText(/código inválido ou expirado/i)).toBeVisible();
  });
});

test.describe("login — magic-link confirm page (/auth/confirm)", () => {
  const email = "e2e-login-link@nextpubli-e2e.test";
  let userId: string;

  test.beforeAll(async () => {
    userId = await createUser(email, "E2e-Senha-Forte-123");
  });
  test.afterAll(async () => deleteUser(userId));

  test("GET shows the button without consuming the token; clicking logs in", async ({
    page,
  }) => {
    const { tokenHash } = await generateMagicLink(email);

    // Simulate an email scanner prefetching the link — token must survive.
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=magiclink`);
    await page.reload();

    const button = page.getByRole("button", { name: /entrar no nextpubli/i });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test("a stale token shows the PT-BR error on the login page", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=token-invalido&type=magiclink");
    await page.getByRole("button", { name: /entrar no nextpubli/i }).click();
    await expect(page).toHaveURL(/\/login\?erro=/);
    await expect(page.getByText(/link inválido ou expirado/i)).toBeVisible();
  });
});
