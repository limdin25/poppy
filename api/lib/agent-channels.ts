import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const CHANNELS = ['voice', 'whatsapp', 'sms', 'email'] as const;
export type ChannelKey = typeof CHANNELS[number];

const CHANNEL_NAME: Record<ChannelKey, string> = {
  voice: 'Calls', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email',
};

// Columns that identify a row or belong to a specific channel/provider — never copied.
const NON_SETTINGS = new Set([
  'id', 'business_id', 'agent_type', 'is_default', 'status', 'name', 'description',
  'retell_agent_id', 'retell_llm_id', 'sort_order', 'created_at', 'updated_at',
]);

type AgentRow = Record<string, unknown> & { id: string; agent_type: string };

/** Strip identity/provider columns, leaving just the editable settings. */
function settingsOnly(agent: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(agent)) if (!NON_SETTINGS.has(k)) out[k] = v;
  return out;
}

/** Replace the target agent's services + FAQs with copies of the source agent's. */
async function copyResources(businessId: string, fromAgentId: string, toAgentId: string): Promise<void> {
  for (const table of ['services', 'faqs'] as const) {
    const { data: rows } = await supabase.from(table).select('*').eq('agent_id', fromAgentId).eq('business_id', businessId);
    await supabase.from(table).delete().eq('agent_id', toAgentId).eq('business_id', businessId);
    if (rows?.length) {
      await supabase.from(table).insert(rows.map((r) => {
        const { id, created_at, updated_at, ...rest } = r as Record<string, unknown>;
        return { ...rest, agent_id: toAgentId, business_id: businessId };
      }));
    }
  }
}

/**
 * Make sure the business has exactly one agent per channel (voice/whatsapp/sms/
 * email), creating any missing ones seeded from the default agent, and pointing
 * each connected channel row at its channel's agent. Returns {channelKey: agent}.
 */
export async function ensureChannelAgents(businessId: string): Promise<Record<ChannelKey, AgentRow>> {
  const { data: agentsData } = await supabase.from('agents').select('*').eq('business_id', businessId);
  const agents = (agentsData || []) as AgentRow[];

  const byType: Partial<Record<string, AgentRow>> = {};
  for (const a of agents) if (!byType[a.agent_type]) byType[a.agent_type] = a;

  const seed = agents.find((a) => a.is_default) || agents[0] || null;
  const result = {} as Record<ChannelKey, AgentRow>;

  for (const ch of CHANNELS) {
    if (byType[ch]) { result[ch] = byType[ch]!; continue; }
    const row: Record<string, unknown> = {
      business_id: businessId,
      agent_type: ch,
      is_default: false,
      name: CHANNEL_NAME[ch],
      status: 'active',
      ...(seed ? settingsOnly(seed) : {}),
    };
    const { data: created } = await supabase.from('agents').insert(row).select('*').single();
    if (created) {
      result[ch] = created as AgentRow;
      if (seed) await copyResources(businessId, seed.id, (created as AgentRow).id);
    }
  }

  // Link only channels that don't yet have an agent. NEVER overwrite an existing
  // link — multi-number lines each have their own agent (a number = an agent),
  // and clobbering them here would point every number at one agent.
  const { data: channels } = await supabase.from('channels').select('id, type, agent_id').eq('business_id', businessId);
  for (const c of (channels || []) as { id: string; type: string; agent_id: string | null }[]) {
    if (c.agent_id) continue;
    const key: ChannelKey | null =
      c.type === 'voice' ? 'voice'
      : c.type === 'whatsapp' ? 'whatsapp'
      : c.type.startsWith('email') ? 'email'
      : c.type === 'sms' ? 'sms'
      : null;
    if (key && result[key]) {
      await supabase.from('channels').update({ agent_id: result[key].id }).eq('id', c.id);
    }
  }

  return result;
}

/** Copy ALL settings (+ services + FAQs) from one channel's agent to another. */
export async function copyAgentSettings(businessId: string, fromAgentId: string, toAgentId: string): Promise<void> {
  const { data: from } = await supabase.from('agents').select('*').eq('id', fromAgentId).eq('business_id', businessId).single();
  if (!from) throw new Error('Source agent not found');

  await supabase.from('agents').update(settingsOnly(from)).eq('id', toAgentId).eq('business_id', businessId);
  await copyResources(businessId, fromAgentId, toAgentId);
}
