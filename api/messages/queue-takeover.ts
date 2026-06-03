import { createClient } from '@supabase/supabase-js';
import { notifyBusinessOwner } from '../lib/notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { business_id, conversation_id, message_id, channel, received_at } = await req.json() as {
      business_id: string;
      conversation_id: string;
      message_id: string;
      channel: string;
      received_at: string;
    };

    if (!business_id || !conversation_id || !message_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const { data: existing } = await supabase
      .from('ai_takeover_queue')
      .select('id')
      .eq('conversation_id', conversation_id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ ok: true, note: 'already_queued' }), { status: 200 });
    }

    const now = new Date();
    const receivedAt = received_at ? new Date(received_at) : now;

    const { data: business } = await supabase
      .from('businesses')
      .select('timezone, takeover_delay_seconds, after_hours_delay_seconds, working_hours_start, working_hours_end, working_days')
      .eq('id', business_id)
      .single();

    const { data: conv } = await supabase
      .from('conversations')
      .select('agent_id, contact_id')
      .eq('id', conversation_id)
      .single();

    // ── Per-lead AI pause: if this contact is paused, never queue an AI reply ──
    if (conv?.contact_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('ai_paused')
        .eq('id', conv.contact_id)
        .maybeSingle();
      if (contact?.ai_paused) {
        return new Response(JSON.stringify({ ok: true, note: 'ai_paused', skipped: true }), { status: 200 });
      }
    }

    let agentTiming: Record<string, unknown> | null = null;
    let agentHandoff: { handoff_enabled?: boolean; handoff_keywords?: string[]; handoff_message?: string | null } | null = null;
    if (conv?.agent_id) {
      const { data: agent } = await supabase
        .from('agents')
        .select('takeover_delay_seconds, after_hours_delay_seconds, working_hours_start, working_hours_end, working_days, handoff_enabled, handoff_keywords, handoff_message')
        .eq('id', conv.agent_id)
        .single();
      agentTiming = agent;
      agentHandoff = agent;
    }

    // ── Human handoff: if the inbound message hits a handoff keyword, flag the
    //    conversation for a human, pause AI, notify the owner, and don't queue. ──
    if (agentHandoff?.handoff_enabled && Array.isArray(agentHandoff.handoff_keywords) && agentHandoff.handoff_keywords.length) {
      const { data: trigMsg } = await supabase
        .from('messages')
        .select('body')
        .eq('id', message_id)
        .maybeSingle();
      const text = (trigMsg?.body || '').toLowerCase();
      const hit = text && agentHandoff.handoff_keywords.some((k) => k && text.includes(k.toLowerCase()));
      if (hit) {
        await supabase
          .from('conversations')
          .update({ status: 'needs_handoff', ai_handling: false })
          .eq('id', conversation_id);
        try {
          await notifyBusinessOwner(business_id, 'message', {
            title: 'Handoff requested',
            body: 'A customer asked for a human — open the inbox to take over.',
          });
        } catch (err) {
          console.error('[queue-takeover] handoff notify failed:', err);
        }
        return new Response(JSON.stringify({ ok: true, note: 'handoff_triggered', skipped: true }), { status: 200 });
      }
    }

    const timezone = business?.timezone || 'Europe/London';
    const delaySeconds = (agentTiming?.takeover_delay_seconds as number) ?? business?.takeover_delay_seconds ?? 1200;
    const afterHoursDelay = (agentTiming?.after_hours_delay_seconds as number) ?? business?.after_hours_delay_seconds ?? 0;
    const workStart = (agentTiming?.working_hours_start as number) ?? business?.working_hours_start ?? 8;
    const workEnd = (agentTiming?.working_hours_end as number) ?? business?.working_hours_end ?? 18;
    const workDays = (agentTiming?.working_days as string[]) || business?.working_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    const afterHours = checkAfterHours(timezone, workStart, workEnd, workDays);

    let takeoverAt: Date;
    if (afterHours) {
      takeoverAt = new Date(now.getTime() + afterHoursDelay * 1000);
    } else if (delaySeconds === 0) {
      takeoverAt = now;
    } else {
      takeoverAt = new Date(receivedAt.getTime() + delaySeconds * 1000);
    }

    await supabase.from('ai_takeover_queue').insert({
      business_id,
      conversation_id,
      trigger_message_id: message_id,
      channel,
      message_received_at: receivedAt.toISOString(),
      takeover_at: takeoverAt.toISOString(),
      status: 'pending',
    });

    // Update last_inbound_at for inactive account tracking
    await supabase.from('businesses').update({ last_inbound_at: now.toISOString() }).eq('id', business_id);

    return new Response(JSON.stringify({ ok: true, takeover_at: takeoverAt.toISOString() }), { status: 200 });
  } catch (err: any) {
    console.error('[queue-takeover] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

function checkAfterHours(timezone: string, workStart: number, workEnd: number, workDays: string[]): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const day = dayFormatter.format(now);

    if (!workDays.includes(day)) return true;
    return hour < workStart || hour >= workEnd;
  } catch {
    return false;
  }
}
