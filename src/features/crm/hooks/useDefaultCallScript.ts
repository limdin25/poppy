// useDefaultCallScript — load + save the wk_call_scripts row flagged as
// is_default = true. Powers:
//   - Settings AI tab → Default call script editor (admin write)
//   - CallScriptPane on the live-call screen (agent read, item B2)
//
// Single row, identified by is_default = true (partial unique index in
// 20260426_smsv2_terminology_and_script.sql guarantees only one).

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface DefaultCallScript {
  id: string | null;
  name: string;
  body_md: string;
}

const EMPTY: DefaultCallScript = {
  id: null,
  name: 'Default script',
  body_md: '',
};

type ScriptRow = { id: string; name: string; body_md: string };

type ScriptsTable = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: boolean) => {
        maybeSingle: () => Promise<{ data: ScriptRow | null; error: { message: string } | null }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
    insert: (v: Record<string, unknown>) => {
      select: (c: string) => {
        single: () => Promise<{ data: ScriptRow | null; error: { message: string } | null }>;
      };
    };
  };
};

export function useDefaultCallScript() {
  const [script, setScript] = useState<DefaultCallScript>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await (supabase as unknown as ScriptsTable)
          .from('wk_call_scripts')
          .select('id, name, body_md')
          .eq('is_default', true)
          .maybeSingle();
        if (cancelled) return;
        if (e) setError(e.message);
        else if (data) setScript({ id: data.id, name: data.name, body_md: data.body_md });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = useCallback(
    <K extends keyof DefaultCallScript>(k: K, v: DefaultCallScript[K]) => {
      setScript((s) => ({ ...s, [k]: v }));
      setSaved(false);
    },
    []
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const client = supabase as unknown as ScriptsTable;
      if (script.id) {
        const { error: e } = await client
          .from('wk_call_scripts')
          .update({ name: script.name, body_md: script.body_md })
          .eq('id', script.id);
        if (e) setError(e.message);
        else setSaved(true);
      } else {
        // No default exists yet (migration not applied / row deleted) —
        // create one with is_default flagged.
        const { data, error: e } = await client
          .from('wk_call_scripts')
          .insert({ name: script.name, body_md: script.body_md, is_default: true })
          .select('id, name, body_md')
          .single();
        if (e) setError(e.message);
        else if (data) {
          setScript({ id: data.id, name: data.name, body_md: data.body_md });
          setSaved(true);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [script]);

  return { script, loading, saving, saved, error, setField, save };
}
