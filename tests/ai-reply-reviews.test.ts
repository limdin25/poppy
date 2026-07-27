import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Hugo 2026-07-27, looking at a live AI draft in the inbox: "the text is like
// selling something that we are not selling anymore... the auto replies should
// be in regards to the review."
//
// The draft he was reading pitched the AI RECEPTIONIST — missed calls, $149 a
// month, a 15-minute onboarding with Rod. That is the old US product. Every
// call, every video and every landing page now sells HeyElsie Reviews at
// £99/£179/£279 with £1 for the first 10 days. The AI was answering leads with
// an offer no one on the team would have made.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const mig = read('supabase/migrations/20260727000011_ai_reply_reviews_prompt.sql');
const route = read('api/crm/ai-reply.ts');

describe('the AI reply prompt', () => {
  it('sells reviews and Google ranking', () => {
    expect(mig).toMatch(/review/i);
    expect(mig).toMatch(/Google/);
  });

  it('drops every trace of the retired receptionist pitch', () => {
    const prompt = mig.split('$prompt$')[1] ?? '';
    expect(prompt.length).toBeGreaterThan(200); // guard: the split actually found it
    expect(prompt).not.toMatch(/missed call/i);
    expect(prompt).not.toMatch(/receptionist/i);
    expect(prompt).not.toMatch(/\$149/);
    expect(prompt).not.toMatch(/\bRod\b/);
  });

  it('quotes the prices that are actually live, in pounds', () => {
    const prompt = mig.split('$prompt$')[1] ?? '';
    expect(prompt).toMatch(/£99/);
    expect(prompt).toMatch(/£1\b/);
    expect(prompt).not.toMatch(/\$\d/);
  });

  it('keeps the honesty rules — it must still admit it is an AI', () => {
    const prompt = mig.split('$prompt$')[1] ?? '';
    expect(prompt).toMatch(/\bAI\b/);
    expect(prompt).toMatch(/never invent|Never invent/);
  });

  it('never promises review gating — that is illegal in the UK', () => {
    const prompt = mig.split('$prompt$')[1] ?? '';
    expect(prompt).not.toMatch(/only.*happy customers|filter.*bad review|gate/i);
    expect(prompt).toMatch(/every customer|all customers|everyone/i);
  });

  it('updates the row rather than inserting a second settings row', () => {
    expect(mig).toMatch(/update wk_ai_reply_settings/i);
    expect(mig).toMatch(/where id = 'default'/i);
  });

  it('keeps the old prompt so it can be put back', () => {
    expect(mig).toMatch(/REVERT/i);
  });
});

describe('the [number] hole', () => {
  it('gives the model the real reply-to number instead of leaving a placeholder', () => {
    // The live draft read "call us back at [number]" — the prompt told it to ask
    // for a callback without ever telling it which number it was texting from,
    // so the model wrote a placeholder and the agent nearly sent it.
    expect(route).toMatch(/replyFrom/);
    expect(route).toMatch(/systemPrompt \+=[\s\S]{0,200}\$\{replyFrom\}/);
  });

  it('tells the model to leave the callback out when there is no number', () => {
    expect(route).toMatch(/never invent a number|do not invent a number|no number/i);
  });
});

describe('who the AI thinks it is talking to', () => {
  // Hugo 2026-07-27, live mid-conversation: our opener correctly greeted Ryan
  // at "James brothers plumbing and property renovation", he replied "We have
  // loads of reviews. Who is this?", and the AI answered "Sorry for the
  // confusion James!". `wk_contacts.name` is the COMPANY. The person lives in
  // custom_fields.owner_name. Taking the first word of the company name puts a
  // stranger's name in a real lead's phone.
  it('greets the OWNER, not the first word of the company name', () => {
    expect(route).toMatch(/custom_fields/);
    expect(route).toMatch(/owner_name/);
    // Owner wins, company is only the fallback.
    expect(route).toMatch(/ownerName \|\| \(c\.name \|\| ''\)/);
  });

  it('selects custom_fields, or owner_name is never on the row to read', () => {
    const select = route.match(/\.select\('id, name, phone[^']*'\)/)?.[0] ?? '';
    expect(select).toMatch(/custom_fields/);
  });

  it('never goes back to reading the first name straight off the company', () => {
    expect(route).not.toMatch(/const firstName = \(c\.name \|\| ''\)/);
  });
});
