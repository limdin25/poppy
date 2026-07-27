// Which channels a message can actually go out on, and — when it can't — why.
//
// Hugo 2026-07-27: "you put a note this video is gonna be sent by SMS and then
// a button next to it change where you can drop down menu and change to email
// or whatever if it's available... if you don't have WhatsApp connected is
// inactive."
//
// Two DIFFERENT reasons a channel is unusable, and the agent needs to know
// which one they're looking at:
//   - the workspace isn't connected to it   → nothing they can do; don't tease
//   - this lead has no address for it       → they can fix it with the pencil
// A single greyed-out button teaches neither. Pure module: no react, no
// supabase, so the rules are testable on their own.

export type SendChannel = 'sms' | 'whatsapp' | 'email';

/** "Text", not "SMS" — the same word the funnel drawer's composer uses. */
export const SEND_CHANNEL_LABEL: Record<SendChannel, string> = {
  sms: 'Text',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

/** Text first: it is the default and the one that actually works today. */
export const SEND_CHANNELS: SendChannel[] = ['sms', 'whatsapp', 'email'];

/** What the WORKSPACE can send on at all, independent of any one lead. */
export interface WorkspaceChannels {
  /** An active, sms_enabled wk_numbers row exists. */
  sms: boolean;
  /** A connected Unipile WhatsApp account exists. */
  whatsapp: boolean;
  /** Resend is a platform service rather than a paired channel — effectively
   *  always true, but kept explicit so a future outage can switch it off. */
  email: boolean;
}

export interface LeadAddresses {
  phone?: string | null;
  email?: string | null;
}

export interface ChannelOption {
  channel: SendChannel;
  label: string;
  usable: boolean;
  /** The address it would go to. Null when unusable. */
  to: string | null;
  /** Why not, in words an agent can act on. Null when usable. */
  reason: string | null;
}

const WORKSPACE_REASON: Record<SendChannel, string> = {
  sms: 'No text number is connected — ask Hugo to add one in Settings → Channels.',
  whatsapp: 'WhatsApp isn’t connected — ask Hugo to connect it in Settings → Channels.',
  email: 'Email sending is off right now.',
};

const LEAD_REASON: Record<SendChannel, string> = {
  sms: 'No mobile number on this lead — add one with the pencil.',
  whatsapp: 'No mobile number on this lead — add one with the pencil.',
  email: 'No email address on this lead — add one with the pencil.',
};

const clean = (v: string | null | undefined): string => (v ?? '').trim();

export function channelOptions(
  workspace: WorkspaceChannels,
  lead: LeadAddresses,
): ChannelOption[] {
  return SEND_CHANNELS.map((channel) => {
    const label = SEND_CHANNEL_LABEL[channel];
    // Workspace first: when WhatsApp isn't connected, "add a mobile number"
    // would send the agent off to fix something that changes nothing.
    if (!workspace[channel]) {
      return { channel, label, usable: false, to: null, reason: WORKSPACE_REASON[channel] };
    }
    const to = channel === 'email' ? clean(lead.email) : clean(lead.phone);
    if (!to) {
      return { channel, label, usable: false, to: null, reason: LEAD_REASON[channel] };
    }
    return { channel, label, usable: true, to, reason: null };
  });
}

/** Text whenever text works — Hugo: "keep text as default". Otherwise the first
 *  channel that does. Falls back to text so an all-blocked panel explains
 *  itself on the channel the agent expected, rather than jumping elsewhere. */
export function defaultChannel(options: ChannelOption[]): SendChannel {
  const sms = options.find((o) => o.channel === 'sms');
  if (sms?.usable) return 'sms';
  return options.find((o) => o.usable)?.channel ?? 'sms';
}
