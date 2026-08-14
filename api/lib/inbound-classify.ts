// What did the branch actually SAY, and does it change the deal?
//
// Hugo, 2026-08-14: "the templates is suggesting a follow up, but they already
// replied, so we don't have to ask for a follow up on the price offer because
// they replied already, but the system has not synchronized."
//
// He was right, and it had already cost a day. Lexi at DDM wrote at 08:38 on
// 2026-08-14 saying the vendor had REJECTED our offer and wanted nearer the
// asking price. The webhook filed the message and did nothing else: no
// classification, no figure pulled out, no notification, no change to the
// card. Seven hours later the board still read "Chase the agent, follow up
// until you get an answer" while the answer sat unread in the inbox.
//
// This module is the reading. It is deliberately split in two:
//
//   classifyByRules()  deterministic, free, instant, and always runs. It
//                      catches the shapes that matter most (a rejection, an
//                      acceptance, an out of office) on plain keywords.
//   the LLM pass       runs on top for the cases rules cannot judge, and its
//                      answer is VALIDATED against the same closed list.
//
// Rules first is not a cost saving. It is so that the most expensive mistake
// (treating a rejection as an ordinary chase) has an answer that cannot be
// rate-limited, cannot hallucinate and cannot be switched off.
//
// WHAT IT NEVER DOES: it never moves a card, never sends anything, and never
// decides a new offer. It reports what was said. Deciding what to do about it
// belongs to the Deal Manager's fences and to Hugo.

/** The closed list. Anything outside it is a validation failure. */
export const INBOUND_KINDS = [
  'rejection',            // the vendor said no to our offer
  'counter_offer',        // they named a figure they would take
  'acceptance',           // they said yes, in writing
  'question',             // they asked us something and are waiting
  'document_request',     // proof of funds, ID, a solicitor's details
  'viewing_response',     // about access, keys, a viewing slot
  'info_supplied',        // the video, the floor plan, the EPC, an answer
  'out_of_office',        // an autoreply, nobody has read anything
  'not_interested',       // stop contacting us, or the house is gone
  'other',
] as const;

export type InboundKind = (typeof INBOUND_KINDS)[number];

export interface InboundReading {
  kind: InboundKind;
  /** Figures the BRANCH named. Never ours, and never to be acted on directly:
   *  a number they said is a fact about them, not a new offer. */
  figuresMentioned: number[];
  /** True when this reply changes what we should do next. An out of office
   *  does not; a rejection does. */
  changesTheDeal: boolean;
  /** Plain one-line summary for the card and the notification. */
  summary: string;
  /** How the reading was reached, so a wrong one can be traced. */
  by: 'rules' | 'model';
  confidence: 'high' | 'medium' | 'low';
}

/** Kinds that mean the instruction on the card is now out of date. */
export const DEAL_CHANGING: InboundKind[] = [
  'rejection', 'counter_offer', 'acceptance', 'question',
  'document_request', 'viewing_response', 'not_interested',
  // They sent the thing we were waiting on, so "chase the video" is now the
  // wrong instruction. Supplying information changes the deal exactly as much
  // as refusing to.
  'info_supplied',
];

const RULES: Array<{ kind: InboundKind; re: RegExp; conf: 'high' | 'medium' }> = [
  // Out of office FIRST: an autoreply can quote the whole thread underneath
  // and would otherwise match every rule below it.
  { kind: 'out_of_office', conf: 'high', re: /\b(out of (the )?office|annual leave|on holiday|automatic reply|auto[- ]?reply|away from my desk|maternity leave|no longer works? (at|for))\b/i },
  { kind: 'acceptance', conf: 'high', re: /\b(have|has|they'?ve) accepted\b|\boffer (is )?accepted\b|\bagreed (to|at) (the|your) offer\b|\bvendor accepts\b/i },
  // "not accept" on its own is a legal disclaimer far more often than a
  // refusal, so it must be attached to the offer to count. stripDisclaimer
  // removes most footers; this is the second fence behind it.
  { kind: 'rejection', conf: 'high', re: /\b(rejected|declined|turned (it |your offer )?down|unable to accept|will not be accepting|(not|non) accept(ing|ed)? (your|the|our|this) offer)\b/i },
  { kind: 'not_interested', conf: 'high', re: /\b(not interested|no longer (available|on the market)|under offer|sold stc|withdrawn from the market|remove (us|me) from)\b/i },
  { kind: 'document_request', conf: 'high', re: /\b(proof of funds|evidence of funds|bank statement|id check|anti[- ]?money|solicitor'?s? details|memorandum of sale)\b/i },
  { kind: 'viewing_response', conf: 'medium', re: /\b(viewing|view the property|access|key ?s|meet you there|available to view)\b/i },
  { kind: 'info_supplied', conf: 'medium', re: /\b(please find attached|attached is|here is the (video|floor ?plan|epc)|as requested|i have attached)\b/i },
];

/** Cut the legal boilerplate off before reading anything.
 *
 *  FOUND ON LIVE DATA, 2026-08-14. Four inbound emails, including DDM's own,
 *  carry "does not accept liability" in the virus and confidentiality footer:
 *
 *    "...cannot guarantee that attachments are virus free or compatible with
 *     your systems and does not accept liability in respect of viruses..."
 *
 *  A rejection rule matching "not accept" reads that as the vendor turning us
 *  down, flips the card to Renegotiate and raises a false alarm on a perfectly
 *  ordinary email. The footer is noise on EVERY rule, not just that one, so it
 *  is removed once, up front, rather than worked around per pattern.
 *
 *  Cuts at the earliest marker found. If none is present the text is unchanged.
 */
export function stripDisclaimer(text: string): string {
  const markers = [
    /this e-?mail (and|&) any attachment/i,
    /this e-?mail (and|&) any files? transmitted/i,
    /does not accept (liability|any responsibility)/i,
    /cannot guarantee that attachments/i,
    /if you are not the intended recipient/i,
    /is confidential and may be privileged/i,
    /the (contents of this|sender) (e-?mail )?(message )?(is|are) confidential/i,
    /registered in england (and wales )?(no|number)/i,
    /please consider the environment before printing/i,
    /reserves the right to monitor all e-?mail/i,
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

/** Figures the branch named, in pounds. Small numbers and years are not money. */
export function figuresMentioned(text: string): number[] {
  const out: number[] = [];
  // MONEY IS CURRENCY-MARKED OR COMMA-GROUPED, never a bare run of digits.
  //
  // Found on Lexi's real email: her signature carries "01472 358671" and a
  // mobile, and a bare-digits rule read them as GBP 358,671 and GBP 3,844,565.
  // A phone number quoted back as a price in a notification is worse than
  // missing a figure, and the KIND of the reply (rejection, acceptance) is
  // classified on words rather than numbers, so nothing important rests on it.
  const re = /(?:GBP|£)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,9}(?:\.\d+)?)|(\d{1,3}(?:,\d{3})+(?:\.\d+)?)/gi;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1000) continue;
    out.push(n);
  }
  return [...new Set(out)];
}

/** The deterministic read. Always runs, cannot fail, cannot be switched off. */
export function classifyByRules(subject: string, body: string): InboundReading {
  const text = stripDisclaimer(`${subject ?? ''}\n${body ?? ''}`);
  const figures = figuresMentioned(text);

  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    let kind = rule.kind;
    // A rejection that also names a figure is a counter-offer, which is a
    // different conversation: one is a door closing, the other is a door
    // opening at a price.
    if (kind === 'rejection' && figures.length) kind = 'counter_offer';
    return {
      kind,
      figuresMentioned: figures,
      changesTheDeal: DEAL_CHANGING.includes(kind),
      summary: summarise(kind, figures),
      by: 'rules',
      confidence: rule.conf,
    };
  }

  // Somebody waiting on us. A question mark is the obvious signal, but branch
  // staff routinely write questions without one ("Can you confirm your
  // position on this one"), and treating that as noise is how a lead sits
  // unanswered.
  const asksSomething = /\?/.test(text)
    || /\b(can|could|would|will|do|does|are|is|have|has|did)\s+(you|we|they)\b/i.test(text)
    || /\b(please\s+(confirm|advise|let\s+me\s+know)|any\s+update|let\s+us\s+know)\b/i.test(text);
  if (asksSomething) {
    return {
      kind: 'question', figuresMentioned: figures, changesTheDeal: true,
      summary: summarise('question', figures), by: 'rules', confidence: 'medium',
    };
  }

  return {
    kind: 'other', figuresMentioned: figures, changesTheDeal: false,
    summary: 'They have written back.', by: 'rules', confidence: 'low',
  };
}

const gbp = (n: number) => `GBP ${Math.round(n).toLocaleString('en-GB')}`;

export function summarise(kind: InboundKind, figures: number[]): string {
  const most = figures.length ? Math.max(...figures) : null;
  switch (kind) {
    case 'rejection':
      return 'The offer has been rejected.';
    case 'counter_offer':
      return most
        ? `They have come back with a figure, ${gbp(most)}. Do not treat that as agreed.`
        : 'They have come back on price.';
    case 'acceptance':
      return 'They say the offer is accepted. Get it in writing with the address and the price.';
    case 'question':
      return 'They have asked us something and are waiting on an answer.';
    case 'document_request':
      return 'They are asking for a document before this can go further.';
    case 'viewing_response':
      return 'They have written about a viewing or access.';
    case 'info_supplied':
      return 'They have sent something over.';
    case 'out_of_office':
      return 'Automatic reply. Nobody has read it yet.';
    case 'not_interested':
      return 'They have closed the door on this one.';
    default:
      return 'They have written back.';
  }
}

/** Validate a model's reading against the closed list. Anything wrong falls
 *  back to the rules read, which is always available. */
export function validateReading(raw: unknown, fallback: InboundReading): InboundReading {
  if (!raw || typeof raw !== 'object') return fallback;
  const v = raw as Record<string, unknown>;
  const kind = String(v.kind ?? '') as InboundKind;
  if (!INBOUND_KINDS.includes(kind)) return fallback;

  const summary = String(v.summary ?? '').trim();
  if (!summary || summary.length > 300) return fallback;
  // Hugo's standing rule, enforced rather than remembered.
  if (/[–—]/.test(summary)) return fallback;

  return {
    kind,
    // The figures are taken from the TEXT, never from the model. A model that
    // mis-transcribes a price into a notification is worse than no reading.
    figuresMentioned: fallback.figuresMentioned,
    changesTheDeal: DEAL_CHANGING.includes(kind),
    summary,
    by: 'model',
    confidence: 'medium',
  };
}

/** What the card's next step becomes when a branch writes to us.
 *
 *  DELIBERATELY CONSERVATIVE. It only rewrites the instruction where the new
 *  instruction is obvious, and returns null everywhere else so the existing
 *  tag stands and a human decides. A wrong instruction is worse than a stale
 *  one: Pedro reads these out loud.
 *
 *  Every tag returned here must exist in
 *  src/features/crm/components/templates/dealProcessSteps.ts. A test pins it.
 *
 *  null = leave the tag alone.
 *  ''   = there is nothing to do next, this one is dead.
 */
export function stepForInbound(kind: InboundKind): string | null {
  switch (kind) {
    // They said no, with or without a figure. Either way the instruction is no
    // longer "chase the answer": we HAVE the answer, and what is needed now is
    // a decision about whether our ceiling can reach them.
    case 'rejection':
    case 'counter_offer':
      return 'Renegotiate';
    // Verbal is not a deal. Section 9 of the strategy: acceptance confirmed in
    // writing, with the address and the price.
    case 'acceptance':
      return 'Get it in writing';
    case 'not_interested':
      return '';
    // A question, a document request, a viewing reply or the video arriving all
    // change the deal, but not into one obvious next step. They raise the
    // card's attention and leave the tag to a human.
    default:
      return null;
  }
}
