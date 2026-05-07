import { createClient } from '@supabase/supabase-js';

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

    const timezone = business?.timezone || 'Europe/London';
    const delaySeconds = business?.takeover_delay_seconds ?? 1200;
    const afterHoursDelay = business?.after_hours_delay_seconds ?? 0;
    const workStart = business?.working_hours_start ?? 8;
    const workEnd = business?.working_hours_end ?? 18;
    const workDays = business?.working_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

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
