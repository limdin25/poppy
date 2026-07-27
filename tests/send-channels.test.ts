import { describe, it, expect } from 'vitest';
import {
  SEND_CHANNEL_LABEL,
  channelOptions,
  defaultChannel,
  type WorkspaceChannels,
} from '../src/features/crm/lib/sendChannels';

// Hugo 2026-07-27: "you put a note this video is gonna be sent by SMS and then a
// button next to it change where you can drop down menu and change to email or
// whatever if it's available... if you don't have WhatsApp connected is
// inactive."
//
// Two separate reasons a channel can be unusable, and the agent must be told
// WHICH: the workspace isn't connected to it (nothing they can do), or this
// lead has no address for it (they can fix that with the pencil, right there).

const ALL_ON: WorkspaceChannels = { sms: true, whatsapp: true, email: true };
const NO_WA: WorkspaceChannels = { sms: true, whatsapp: false, email: true };

const byKey = (ws: WorkspaceChannels, lead: { phone?: string | null; email?: string | null }) =>
  Object.fromEntries(channelOptions(ws, lead).map((o) => [o.channel, o]));

describe('channelOptions', () => {
  it('offers all three when the workspace and the lead both have what they need', () => {
    const o = byKey(ALL_ON, { phone: '+447538188659', email: 'jon@carters.co.uk' });
    expect(o.sms.usable).toBe(true);
    expect(o.whatsapp.usable).toBe(true);
    expect(o.email.usable).toBe(true);
    expect(o.sms.reason).toBeNull();
  });

  it('shows the address each channel would actually go to', () => {
    const o = byKey(ALL_ON, { phone: '+447538188659', email: 'jon@carters.co.uk' });
    expect(o.sms.to).toBe('+447538188659');
    expect(o.whatsapp.to).toBe('+447538188659'); // same number as the text
    expect(o.email.to).toBe('jon@carters.co.uk');
  });

  it('greys WhatsApp out with the connect reason, even when the lead has a phone', () => {
    const o = byKey(NO_WA, { phone: '+447538188659', email: 'jon@carters.co.uk' });
    expect(o.whatsapp.usable).toBe(false);
    expect(o.whatsapp.reason).toMatch(/isn’t connected|isn't connected/);
    expect(o.whatsapp.to).toBeNull();
  });

  it('blames the workspace before the lead — adding an address would not help', () => {
    const o = byKey(NO_WA, { phone: null, email: null });
    expect(o.whatsapp.reason).toMatch(/connected/);
    expect(o.whatsapp.reason).not.toMatch(/on this lead/);
  });

  it('names the missing field when it is the lead that is short', () => {
    const o = byKey(ALL_ON, { phone: '+447538188659', email: null });
    expect(o.email.usable).toBe(false);
    expect(o.email.reason).toMatch(/No email address on this lead/);
    const p = byKey(ALL_ON, { phone: '', email: 'jon@carters.co.uk' });
    expect(p.sms.usable).toBe(false);
    expect(p.sms.reason).toMatch(/No mobile number on this lead/);
  });

  it('treats whitespace as no address, not as an address', () => {
    const o = byKey(ALL_ON, { phone: '   ', email: '  ' });
    expect(o.sms.usable).toBe(false);
    expect(o.email.usable).toBe(false);
  });

  it('always returns the three channels in text-first order', () => {
    expect(channelOptions(NO_WA, {}).map((o) => o.channel)).toEqual(['sms', 'whatsapp', 'email']);
  });

  it('labels text as "Text" — the same word the funnel drawer uses', () => {
    expect(SEND_CHANNEL_LABEL.sms).toBe('Text');
    expect(SEND_CHANNEL_LABEL.whatsapp).toBe('WhatsApp');
    expect(SEND_CHANNEL_LABEL.email).toBe('Email');
  });
});

describe('defaultChannel', () => {
  it('is text whenever text works — Hugo: "keep text as default"', () => {
    expect(defaultChannel(channelOptions(ALL_ON, { phone: '+447538188659', email: 'a@b.co' }))).toBe('sms');
  });

  it('falls to the first channel that does work', () => {
    expect(defaultChannel(channelOptions(ALL_ON, { phone: null, email: 'a@b.co' }))).toBe('email');
  });

  it('stays on text when nothing works, so the panel explains rather than jumps', () => {
    expect(defaultChannel(channelOptions(NO_WA, {}))).toBe('sms');
  });
});
