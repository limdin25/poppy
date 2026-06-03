export const config = { runtime: 'edge' };

/**
 * Lightweight health probe. Returns 200 with a small JSON payload so we can
 * verify a deployment (and that key env vars are present) without auth.
 */
export default async function handler(): Promise<Response> {
  const env = {
    APP_URL: Boolean(process.env.APP_URL),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
    UNIPILE_TOKEN: Boolean(process.env.UNIPILE_TOKEN),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID),
  };
  return new Response(
    JSON.stringify({ ok: true, ts: new Date().toISOString(), env }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
