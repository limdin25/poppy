import type { TranscriptLine, CoachEvent } from '../types';

export const MOCK_TRANSCRIPT: TranscriptLine[] = [
  { id: 't-1', speaker: 'agent', text: 'Hi Sarah, this is Tom from Acme Sales. Have you got a quick few minutes?', ts: 4 },
  { id: 't-2', speaker: 'caller', text: 'Yeah, sure. I was actually about to message you.', ts: 12 },
  { id: 't-3', speaker: 'agent', text: 'Great timing. So I noticed you signed up for our landlord guide last week — what kind of property are you looking to let?', ts: 18 },
  { id: 't-4', speaker: 'caller', text: 'I\'ve got a 3-bed terrace in Croydon. Been thinking about rent-to-rent but the price quoted feels a bit high compared to what I saw on the listing site.', ts: 32 },
  { id: 't-5', speaker: 'agent', text: 'Can you tell me which property you compared it to?', ts: 56 },
  { id: 't-6', speaker: 'caller', text: 'A similar 3-bed two streets over — they were asking £1,800 a month.', ts: 64 },
  { id: 't-7', speaker: 'agent', text: 'Right. So what you\'re seeing on the listing site is gross — our number is net of management fees and void cover. Let me walk you through it…', ts: 80 },
  { id: 't-8', speaker: 'caller', text: 'OK, that makes sense actually. And what about the deposit — do you handle that?', ts: 110 },
  { id: 't-9', speaker: 'agent', text: 'Yes — we hold a 6-week deposit in a DPS account, you don\'t need to do anything.', ts: 124 },
  { id: 't-10', speaker: 'caller', text: 'Hmm. When could you start?', ts: 138 },
];

export const MOCK_COACH_EVENTS: CoachEvent[] = [
  {
    id: 'ce-1',
    kind: 'objection',
    title: 'Price concern',
    body: 'Caller compared Acme Sales net rate to the listing site gross. Reframe immediately.',
    ts: 38,
  },
  {
    id: 'ce-2',
    kind: 'suggestion',
    title: 'Suggested response',
    body: '"The listing site is gross — our figure is net of management fees and voids. On a like-for-like basis you\'re actually £200 ahead each month."',
    ts: 42,
  },
  {
    id: 'ce-3',
    kind: 'question',
    title: 'Ask next',
    body: '"What\'s your timeline for getting the deposit released from your current setup?"',
    ts: 130,
  },
  {
    id: 'ce-4',
    kind: 'warning',
    title: 'Talk ratio',
    body: 'You\'re at 62% talk time. Aim for ≤50%. Let her speak.',
    ts: 95,
  },
];
