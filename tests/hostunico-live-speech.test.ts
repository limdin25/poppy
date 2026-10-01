import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hostunicoSpeechLines, hostunicoSpokenWords, mergeHostunicoSpeech, type HostunicoLiveSpeech } from '../src/features/crm/lib/hostunicoSpeech';
import HostunicoCoachView from '../src/features/crm/components/live-call/HostunicoCoachView';
import HostunicoScriptPane from '../src/features/crm/components/live-call/HostunicoScriptPane';
import { hostunicoJevAnswer, hostunicoJevRequest, raceHostunicoCoach } from '../supabase/functions/_shared/hostunico-jev';
import { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from '../supabase/functions/_shared/hostunico-answer-bank';

const speech = (body: string, sequence = 1, speaker = 'caller', is_final = false): HostunicoLiveSpeech => ({ id: `turn-${speaker}`, utterance_id: `turn-${speaker}`, call_id: 'call-a', body, speaker, sequence, is_final, ts: `2026-10-01T12:00:0${sequence}.000Z` });
const base = { active: true, offline: false, connected: true, opener: 'Hi, this is Pedro here.', country: 'GB' };
const renderCoach = (line: HostunicoLiveSpeech, card: any, extra: HostunicoLiveSpeech[] = []) => renderToStaticMarkup(createElement(HostunicoCoachView, { ...base, lines: [line, ...extra], speech: [line, ...extra], cards: card ? [card] : [] }));
const current = (html: string) => html.split('data-testid="hostunico-current-answer"')[1].split('</section>')[0];

describe('live partials and corrected speech', () => {
  it('keeps one current line per speaker, rejects late partials, and does not repeat final lines', () => {
    const first = speech('How do guests');
    const second = speech('How do guests get in?', 2, 'caller', true);
    let live = mergeHostunicoSpeech([], first);
    live = mergeHostunicoSpeech(live, second);
    live = mergeHostunicoSpeech(live, first);
    expect(live).toHaveLength(1);
    expect(live[0].body).toBe(second.body);
    live = mergeHostunicoSpeech(live, speech('Guests use a lockbox.', 3, 'agent'));
    expect(live).toHaveLength(2);
    const finals = [{ ...second, id: 'archived' }];
    expect(hostunicoSpeechLines(finals, live).map((row) => row.id)).toEqual(['archived', 'turn-agent']);
  });
  it('shows a useful answer and a live one-line caption before the question is finished', () => {
    const line = speech('How do guests get in');
    const html = renderCoach(line, null);
    expect(current(html)).toContain('Early suggestion');
    expect(current(html)).toMatch(/lockbox/);
    expect(html).toContain('Lead: How do guests get in');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Give them a moment to finish');
  });
  it('revises an access guess when the caller corrects to guest messages, without keeping the old answer', () => {
    const early = speech('How do guests get in');
    const card = { id: 'same-card', ts: early.ts, status: 'final', body: 'SAY: Guests use a lockbox.\nASK:', meta: { source_sequence: 1, utterance_id: early.utterance_id, source_text: early.body, provisional: true } };
    const revised = speech('How do guests get in, actually I mean who answers their messages?', 2);
    expect(current(renderCoach(revised, card))).not.toContain('Guests use a lockbox.');
    const next = { ...card, body: 'SAY: Our team handles guest messages.\nASK:', meta: { ...card.meta, source_sequence: 2, source_text: revised.body } };
    expect(current(renderCoach(revised, next))).toContain('Our team handles guest messages.');
  });
  it('rejects a coach card from a different utterance even when it arrives later', () => {
    const line = speech('Tell me about that issue');
    const old = { id: 'old', ts: '2026-10-01T12:00:09.000Z', body: 'SAY: Wrong old response.\nASK:', meta: { source_sequence: 9, utterance_id: 'previous-turn', source_text: line.body } };
    expect(current(renderCoach(line, old))).not.toContain('Wrong old response');
  });
});

describe('read-along progress', () => {
  it('highlights the words actually spoken, including an unfinished answer', () => {
    const text = 'Guests use a lockbox near the entrance. We send arrival instructions.';
    const covered = hostunicoSpokenWords(text, 'Guests use a lockbox near the entrance');
    expect([...covered]).toEqual([0,1,2,3,4,5,6]);
    expect(hostunicoSpokenWords(text, 'Yes, I think so.').size).toBe(0);
    expect(hostunicoSpokenWords(text, 'The cleaner sends photos.').size).toBe(0);
  });
  it('only Pedro can turn the coach words green, and a corrected partial can remove the highlight', () => {
    const caller = speech('Tell me about the access', 1);
    const card = { id: 'card', ts: caller.ts, body: 'SAY: Guests use a lockbox near the entrance.\nASK:', meta: { source_sequence: 1, utterance_id: caller.utterance_id, source_text: caller.body } };
    expect(current(renderCoach(caller, card))).not.toContain('data-spoken');
    const speaking = speech('Guests use a lockbox', 2, 'agent');
    expect(current(renderCoach(caller, card, [speaking]))).toContain('text-green-800');
    expect(current(renderCoach(caller, card, [{ ...speaking, body: 'Let me understand your question' }]))).not.toContain('data-spoken');
  });
  it('colors script words dark green and starts a fresh script with no covered words', () => {
    const props = { listing: null, agentName: 'Pedro', onOpener: () => {} };
    const read = renderToStaticMarkup(createElement(HostunicoScriptPane, { ...props, agentSpeech: 'Hi, this is Pedro here' }));
    expect(read).toContain('text-green-800');
    expect(renderToStaticMarkup(createElement(HostunicoScriptPane, props))).not.toContain('data-spoken');
  });
});

describe('brief early answers', () => {
  it('keeps every prepared answer concise without clipping sentences or price details', () => {
    for (const answer of HOSTUNICO_ANSWERS) {
      const text = hostunicoAnswerCopy(answer);
      expect(text.split(/\s+/).length, answer.key).toBeLessThanOrEqual(40);
    }
  });
  it('allows a provisional Jev prediction while retaining the stricter completed-question threshold', () => {
    const payload = { answers: { approved_answer: { type: 'choice', choice: 'guest-comms', confidence: 0.8, probabilities: { 'guest-comms': 0.85 } } } };
    expect(hostunicoJevAnswer(payload, 'GB', true)).toContain('guest messages');
    expect(hostunicoJevAnswer(payload, 'GB')).toBeNull();
    expect(hostunicoJevRequest('Who handles guest', [], 'GB', true).questions.approved_answer.instructions).toContain('STILL SPEAKING');
  });
  it('does not let a format prefix beat a ready Jev answer', async () => {
    const chunks: string[] = [];
    const result = await raceHostunicoCoach({ fast: async () => 'SAY: Guests let themselves in.\nASK:', generate: async (write, signal) => { write('SAY:', true); return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null))); }, onChunk: (text) => chunks.push(text), isAborted: () => false });
    expect(result?.source).toBe('jev');
    expect(chunks).toEqual(['SAY: Guests let themselves in.\nASK:']);
  });
});
