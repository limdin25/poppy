// Curated voices plus the caller's clones, with signed audition URLs.
// Auditions are free on purpose: each preview is rendered once and stored,
// zero marginal cost per listen.

import type { IncomingMessage, ServerResponse } from 'http';
import { json, requireUser } from '../_lib/http.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'Sign in first' });

  const base = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const r = await fetch(
    `${base}/rest/v1/ugc_voices?or=(kind.eq.curated,user_id.eq.${user.userId})&select=id,name,kind,preview_path&order=kind.asc,created_at.desc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return json(res, 502, { error: await r.text() });
  const rows = (await r.json()) as Array<{ id: string; name: string; kind: string; preview_path: string | null }>;

  const voices = await Promise.all(
    rows.map(async (row) => {
      let previewUrl: string | undefined;
      if (row.preview_path) {
        const signed = await fetch(`${base}/storage/v1/object/sign/ugc-renders/${row.preview_path}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 3600 }),
        });
        if (signed.ok) {
          const body = (await signed.json()) as { signedURL?: string };
          if (body.signedURL) previewUrl = `${base}/storage/v1${body.signedURL}`;
        }
      }
      return { id: row.id, name: row.name, kind: row.kind, previewUrl };
    }),
  );

  return json(res, 200, { voices });
}
