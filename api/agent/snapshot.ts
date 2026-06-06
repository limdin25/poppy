import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

// The changeable agent settings a backup captures. DB fields live on the agents
// row (pushed to Retell by sync-prompt); RETELL fields live only on Retell and
// must be pushed directly on restore.
const DB_FIELDS = [
  'greeting', 'tone', 'ai_system_prompt', 'ai_model', 'voice_id', 'voice_speed', 'language',
  'interruption_sensitivity', 'responsiveness', 'max_call_duration_seconds', 'post_call_analysis_model',
  'start_speaker', 'ambient_sound', 'backchannel_enabled', 'backchannel_frequency', 'begin_delay_ms',
  'end_silence_seconds', 'voicemail_hangup', 'allow_keypad', 'pronunciation_notes', 'working_days',
  'reminder_trigger_seconds', 'reminder_max_count',
  'voice_model', 'voice_emotion', 'volume', 'enable_dynamic_voice_speed',
];
// Retell-only fields the app doesn't store as agent columns (still captured on backup).
const RETELL_FIELDS = [
  'voice_temperature', 'backchannel_words', 'ambient_sound_volume',
  'enable_dynamic_responsiveness',
];

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json() as { action?: string; agentId?: string; snapshotId?: string; label?: string };
    const action = body.action;

    // List backups for an agent (newest first).
    if (action === 'list') {
      if (!body.agentId) return new Response(JSON.stringify({ error: 'agentId required' }), { status: 400 });
      const { data } = await supabase
        .from('agent_snapshots')
        .select('id, label, created_at')
        .eq('business_id', auth.businessId)
        .eq('agent_id', body.agentId)
        .order('created_at', { ascending: false });
      return new Response(JSON.stringify({ ok: true, snapshots: data || [] }), { status: 200 });
    }

    // Save the agent's current settings as a new backup.
    if (action === 'save') {
      if (!body.agentId) return new Response(JSON.stringify({ error: 'agentId required' }), { status: 400 });
      const label = (body.label || 'Backup').trim().slice(0, 80) || 'Backup';

      const { data: agent } = await supabase
        .from('agents')
        .select(`id, retell_agent_id, ${DB_FIELDS.join(', ')}`)
        .eq('id', body.agentId)
        .eq('business_id', auth.businessId)
        .single();
      if (!agent) return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });

      const dbCfg: Record<string, unknown> = {};
      for (const f of DB_FIELDS) dbCfg[f] = (agent as Record<string, unknown>)[f];

      const retellCfg: Record<string, unknown> = {};
      if ((agent as Record<string, unknown>).retell_agent_id) {
        const r = await fetch(`https://api.retellai.com/get-agent/${(agent as Record<string, unknown>).retell_agent_id}`, {
          headers: { Authorization: `Bearer ${RETELL_API_KEY}` },
        });
        if (r.ok) {
          const ra = await r.json() as Record<string, unknown>;
          for (const f of RETELL_FIELDS) retellCfg[f] = ra[f];
        }
      }

      const { error } = await supabase.from('agent_snapshots').insert({
        agent_id: body.agentId,
        business_id: auth.businessId,
        label,
        config: { db: dbCfg, retell: retellCfg },
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Restore a backup: write DB fields, push to Retell (sync), then push Retell-only fields.
    if (action === 'restore') {
      if (!body.snapshotId) return new Response(JSON.stringify({ error: 'snapshotId required' }), { status: 400 });
      const { data: snap } = await supabase
        .from('agent_snapshots')
        .select('id, agent_id, config')
        .eq('id', body.snapshotId)
        .eq('business_id', auth.businessId)
        .single();
      if (!snap) return new Response(JSON.stringify({ error: 'Backup not found' }), { status: 404 });

      const { data: agent } = await supabase
        .from('agents')
        .select('id, agent_type, retell_agent_id')
        .eq('id', snap.agent_id)
        .eq('business_id', auth.businessId)
        .single();
      if (!agent) return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });

      const cfg = snap.config as { db?: Record<string, unknown>; retell?: Record<string, unknown> };

      // 1) Write the DB fields back onto the agent row.
      if (cfg.db && Object.keys(cfg.db).length) {
        const patch: Record<string, unknown> = {};
        for (const f of DB_FIELDS) if (f in cfg.db) patch[f] = cfg.db[f];
        await supabase.from('agents').update(patch).eq('id', snap.agent_id).eq('business_id', auth.businessId);
      }

      // 2) Push the prompt/voice/behaviour to Retell (also publishes).
      const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
      const toolSecret = process.env.TOOL_SECRET || '';
      await fetch(`${appUrl}/api/agent/sync-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tool-secret': toolSecret },
        body: JSON.stringify({ businessId: auth.businessId, agentId: snap.agent_id }),
      }).catch(() => {});

      // 3) Push the Retell-only fields (not handled by sync) and publish.
      if (agent.agent_type === 'voice' && agent.retell_agent_id && cfg.retell && Object.keys(cfg.retell).length) {
        const rPatch: Record<string, unknown> = {};
        for (const f of RETELL_FIELDS) if (f in cfg.retell && cfg.retell[f] !== null && cfg.retell[f] !== undefined) rPatch[f] = cfg.retell[f];
        if (Object.keys(rPatch).length) {
          const ur = await fetch(`https://api.retellai.com/update-agent/${agent.retell_agent_id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(rPatch),
          });
          const updated = ur.ok ? await ur.json().catch(() => ({})) as { version?: number } : {};
          await fetch(`https://api.retellai.com/publish-agent/${agent.retell_agent_id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(updated.version != null ? { version: updated.version } : {}),
          }).catch(() => {});
        }
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Delete a backup.
    if (action === 'delete') {
      if (!body.snapshotId) return new Response(JSON.stringify({ error: 'snapshotId required' }), { status: 400 });
      await supabase.from('agent_snapshots').delete().eq('id', body.snapshotId).eq('business_id', auth.businessId);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
