// The client's own website editor, on go.heyelsie.com.
//
// Built for a plumber in a van on a phone: one screen, plain English labels,
// a live preview, one big Save. No hex codes, no markdown, no jargon.
//
// The preview renders the SAME renderSite() the public page uses, into an
// iframe srcDoc, so there is exactly one source of truth for the markup and
// what they see here cannot drift from what a customer sees.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/core/hooks/useSupabaseQuery';
import { renderSite } from '@/core/site-demo/render';
import type { SiteContent } from '@/core/site-demo/types';

/** Named swatches, not a colour picker. Nobody should be typing hex codes. */
const SWATCHES: Array<{ name: string; accent: string; blue: string }> = [
  { name: 'Classic blue', accent: '#C2452D', blue: '#1D4E89' },
  { name: 'Deep navy', accent: '#B8892B', blue: '#14315C' },
  { name: 'Forest', accent: '#B8892B', blue: '#24564A' },
  { name: 'Slate', accent: '#C2452D', blue: '#3A4A5C' },
  { name: 'Burgundy', accent: '#B8892B', blue: '#6B2740' },
];

interface Loaded {
  page_id: string;
  slug: string;
  url: string;
  content: SiteContent;
  chat_prompt: string | null;
}

export default function SiteEditorPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<SiteContent | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authed = useCallback(async (path: string, init?: RequestInit) => {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    return fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authed('/api/site-demo/site');
        if (res.status === 404) {
          if (!cancelled) setStatus('none');
          return;
        }
        if (!res.ok) throw new Error(`Could not load your website (${res.status})`);
        const body = (await res.json()) as Loaded;
        if (cancelled) return;
        setData(body);
        setDraft(body.content);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authed]);

  const preview = useMemo(() => {
    if (!draft || !data) return '';
    return renderSite(draft, {
      slug: data.slug,
      pageId: 'preview',
      // No token and staff:true, so the preview can never log an open or
      // burn anything on the real page's numbers.
      beaconToken: '',
      staff: true,
      canonicalUrl: data.url,
      chatEnabled: false,
      checkoutEnabled: false,
    });
  }, [draft, data]);

  const set = <K extends keyof SiteContent>(key: K, value: SiteContent[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authed('/api/site-demo/site', {
        method: 'PATCH',
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      const body = await res.json();
      setDraft(body.content);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading') {
    return <p className="p-6 text-sm text-ink-soft">Loading your website...</p>;
  }
  if (status === 'none') {
    return (
      <div className="p-6 max-w-lg" data-testid="site-editor-empty">
        <h1 className="text-xl font-black text-ink">Your website</h1>
        <p className="mt-2 text-sm text-ink-soft">
          There is no website on this account yet. If you have just signed up, give it a minute and
          refresh.
        </p>
      </div>
    );
  }
  if (status === 'error' || !draft || !data) {
    return <p className="p-6 text-sm text-red-600">{error || 'Something went wrong.'}</p>;
  }

  const field = 'w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-ink';
  const label = 'block text-xs font-semibold text-ink mb-1';

  return (
    <div className="p-4 sm:p-6" data-testid="site-editor">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-black text-ink">Your website</h1>
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[#3C5A87] underline break-all"
          >
            {data.url}
          </a>
        </div>
        <button
          data-testid="site-editor-save"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[#3C5A87] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {saving ? 'Saving' : 'Save changes'}
        </button>
      </div>
      {saved && (
        <p data-testid="site-editor-saved" className="mt-2 text-xs font-semibold text-[#166534]">
          Saved. Your website is updated already.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <div>
            <label className={label} htmlFor="ed-name">Business name</label>
            <input id="ed-name" className={field} value={draft.businessName}
              onChange={(e) => set('businessName', e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="ed-tagline">The line under your name</label>
            <input id="ed-tagline" className={field} value={draft.tagline}
              onChange={(e) => set('tagline', e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="ed-phone">Phone number people see</label>
            <input id="ed-phone" className={field} value={draft.phoneDisplay}
              onChange={(e) => set('phoneDisplay', e.target.value)} />
            <p className="mt-1 text-[11px] text-ink-soft">
              Change this to your own number when you are ready. Until you do, calls go to the AI
              receptionist.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="ed-address">Address (leave blank to hide it)</label>
            <input id="ed-address" className={field} value={draft.address || ''}
              onChange={(e) => set('address', e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="ed-about">About your business</label>
            <textarea id="ed-about" className={field} rows={5} value={draft.about}
              onChange={(e) => set('about', e.target.value)} />
          </div>

          <div>
            <span className={label}>What you do</span>
            {draft.services.map((s, i) => (
              <input
                key={i}
                className={`${field} mb-2`}
                value={s}
                aria-label={`Service ${i + 1}`}
                onChange={(e) => {
                  const next = draft.services.slice();
                  next[i] = e.target.value;
                  set('services', next);
                }}
              />
            ))}
            <button
              className="text-xs font-semibold text-[#3C5A87] underline"
              onClick={() => set('services', [...draft.services, ''])}
            >
              Add another
            </button>
          </div>

          <div>
            <span className={label}>Colours</span>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((s) => (
                <button
                  key={s.name}
                  onClick={() => set('colours', { accent: s.accent, blue: s.blue })}
                  aria-label={s.name}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    draft.colours.blue === s.blue ? 'border-[#3C5A87] font-bold' : 'border-[#E5E7EB]'
                  }`}
                >
                  <span className="inline-block h-4 w-4 rounded" style={{ background: s.blue }} />
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="ed-greeting">What the chat says first</label>
            <textarea id="ed-greeting" className={field} rows={2} value={draft.chatGreeting}
              onChange={(e) => set('chatGreeting', e.target.value)} />
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold text-ink">Preview</p>
          <iframe
            data-testid="site-editor-preview"
            title="Website preview"
            srcDoc={preview}
            className="h-[70vh] w-full rounded-xl border border-[#E5E7EB] bg-white"
          />
        </div>
      </div>
    </div>
  );
}
