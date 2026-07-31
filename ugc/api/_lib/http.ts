// Shared handler plumbing for the ugc serverless routes. Node handler style
// (IncomingMessage/ServerResponse), the shape proven to deploy in this stack.

import type { IncomingMessage, ServerResponse } from 'http';

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req);
  try {
    return JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw new Error('Bad JSON');
  }
}

// Verify the caller's Supabase JWT against the ugc project and return the
// user id. The anon key is enough: /auth/v1/user validates the bearer token.
export async function requireUser(req: IncomingMessage): Promise<{ userId: string; email: string | null } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) throw new Error('Supabase env not set');
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: serviceKey },
  });
  if (!r.ok) return null;
  const user = (await r.json()) as { id?: string; email?: string };
  if (!user.id) return null;
  return { userId: user.id, email: user.email ?? null };
}

// Call a SECURITY DEFINER RPC with the service role.
export async function serviceRpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) throw new Error('Supabase env not set');
  return fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
}
