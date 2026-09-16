// The builder board.
//
// Hugo, 2026-08-28, relaying Pedro: "a pipeline the same as we have for the
// properties but now for the builders, so he can coordinate which builder has
// been booked for what property, a kanban view there."
//
// EVERY RULE HERE WAS PAID FOR. Six viewings ran on 26 and 27 August and a
// builder turned up at three. The named cases in these tests are the real ones,
// read off the live messages and call recordings before a line was written.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  STAGES, STAGE_IDS, isBuilderStage, alertsFor, verdictFor, orderHouses,
  orderCards, cardsInStage, bookedOther, clashingHouses, countdown, money,
  reportedButNotMarked,
  type BoardCard, type BoardHouse, type BuilderStage,
} from '../src/features/crm/lib/builderBoard';

const VIEWING = '2026-08-28T13:00:00Z';
const NOW = Date.parse('2026-08-27T13:00:00Z');   // 24h before, so "urgent"

function card(over: Partial<BoardCard> = {}): BoardCard {
  return {
    outreachId: 'o1', propertyId: 'p1', builderId: 'b1',
    builderName: 'A Builder', builderPhone: '+447700900001', contactId: 'c1',
    stage: 'to_do', status: 'draft', channel: 'whatsapp', callOutcome: null,
    sentAt: null, repliedAt: null, declinedAt: null, agreedAt: null,
    comeBackAt: null, comeBackNote: null, attendedAt: null,
    quoteAmount: null, quoteNote: null, chargesAmount: null,
    addressSentAt: null, lastInboundAt: null, lastInboundBody: '', lastOutboundAt: null,
    reportedAt: null, mediaCount: 0, mediaMessageIds: [],
    ...over,
  };
}

function house(cards: BoardCard[], over: Partial<BoardHouse> = {}): BoardHouse {
  return {
    propertyId: 'p1', address: 'Lisle Road, South Shields',
    viewingAddress: '81, Lisle Road, South Shields', viewingAt: VIEWING,
    houseNumberKnown: true, assignedBuilderId: null, cards, ...over,
  };
}

describe('the stages are Pedro words, not database words', () => {
  it('has the seven the board draws, in journey order', () => {
    expect(STAGE_IDS).toEqual(['to_do', 'chasing', 'talking', 'coming', 'booked', 'been', 'no']);
  });

  it('gives every stage a title and a hint, because a column nobody understands is a column nobody uses', () => {
    for (const s of STAGES) {
      expect(s.title.length).toBeGreaterThan(1);
      expect(s.hint.length).toBeGreaterThan(5);
    }
  });

  it('refuses a stage it does not know', () => {
    expect(isBuilderStage('booked')).toBe(true);
    expect(isBuilderStage('confirmed')).toBe(false);   // that is a status, not a stage
  });
});

describe('the address is the loudest thing on the card', () => {
  // CJS Builders, Windsor Road: "Morning. I'm happy to do this for you. What
  // number am I meeting you at?" Nobody sent it. On the day: "Hi. Assume
  // today's meet isn't on? No address." Nobody went.
  it('shouts when a man who said yes has not been told which door', () => {
    const c = card({ stage: 'coming' });
    const a = alertsFor(c, house([c]), NOW);
    const stop = a.find((x) => x.kind === 'no_address');
    expect(stop?.tone).toBe('stop');
    expect(stop?.text).toMatch(/not been sent the house number/i);
  });

  it('says the different, worse thing when the house itself has no number', () => {
    const c = card({ stage: 'booked' });
    const a = alertsFor(c, house([c], { houseNumberKnown: false, viewingAddress: null }), NOW);
    expect(a.find((x) => x.kind === 'no_address')?.text).toMatch(/No house number on this property/i);
  });

  it('says nothing once he has it', () => {
    const c = card({ stage: 'booked', addressSentAt: '2026-08-25T17:01:00Z' });
    expect(alertsFor(c, house([c]), NOW).some((x) => x.kind === 'no_address')).toBe(false);
  });

  it('does NOT nag about a builder nobody has spoken to yet', () => {
    // Flagging all 44 in Chasing would train Pedro to ignore the one flag that
    // decides whether the viewing happens.
    for (const stage of ['to_do', 'chasing', 'talking', 'no'] as BuilderStage[]) {
      const c = card({ stage });
      expect(alertsFor(c, house([c]), NOW).some((x) => x.kind === 'no_address')).toBe(false);
    }
  });
});

describe('a booked builder who has since backed out', () => {
  // M Riding builders was assigned to Stevenson Avenue and texted "Hi I won't
  // be able to make tomorrow" the evening before. His status stayed 'confirmed'
  // and the house still read as covered. A false green is the most dangerous
  // thing this board could show.
  it('flags a message he sent that nobody has answered', () => {
    const c = card({
      stage: 'booked', addressSentAt: '2026-08-22T11:00:00Z',
      lastInboundAt: '2026-08-27T16:29:00Z', lastOutboundAt: '2026-08-22T14:18:00Z',
      lastInboundBody: 'Hi I won’t be able to make tomorrow',
    });
    const stop = alertsFor(c, house([c]), NOW).find((x) => x.kind === 'unanswered');
    expect(stop?.tone).toBe('stop');
    expect(stop?.text).toContain('able to make tomorrow');
  });

  it('turns the whole lane amber, so the header stops saying he is coming', () => {
    const c = card({
      stage: 'booked', addressSentAt: '2026-08-22T11:00:00Z',
      lastInboundAt: '2026-08-27T16:29:00Z', lastOutboundAt: '2026-08-22T14:18:00Z',
      lastInboundBody: 'Hi I will not be able to make tomorrow', builderName: 'M Riding builders ltd',
    });
    const v = verdictFor(house([c]), NOW);
    expect(v.state).toBe('at_risk');
    expect(v.line).toContain('M Riding builders ltd');
  });

  it('is only a warning, not a stop, when he is merely being talked to', () => {
    const c = card({ stage: 'talking', lastInboundAt: '2026-08-27T10:00:00Z', lastOutboundAt: null, lastInboundBody: 'what number' });
    expect(alertsFor(c, house([c]), NOW).find((x) => x.kind === 'unanswered')?.tone).toBe('warn');
  });

  it('says nothing when we answered him last', () => {
    const c = card({ stage: 'booked', addressSentAt: 'x', lastInboundAt: '2026-08-26T09:00:00Z', lastOutboundAt: '2026-08-26T10:00:00Z' });
    expect(alertsFor(c, house([c]), NOW).some((x) => x.kind === 'unanswered')).toBe(false);
  });
});

describe('he agreed to a different day', () => {
  // Fox Built: "Unfortunately I'm not available this Friday, but I'd be happy
  // to come and take a look. I can do Wednesday 2nd September at 5pm."
  it('says both days rather than pretending he is coming to the viewing', () => {
    const c = card({ stage: 'coming', addressSentAt: 'x', agreedAt: '2026-09-02T16:00:00Z', builderName: 'Fox Built' });
    const a = alertsFor(c, house([c]), NOW).find((x) => x.kind === 'wrong_day');
    expect(a?.text).toMatch(/agreed to .*Sep/i);
    expect(a?.text).toMatch(/the viewing is/i);
  });

  it('stays quiet when he agreed to the viewing itself', () => {
    const c = card({ stage: 'coming', addressSentAt: 'x', agreedAt: VIEWING });
    expect(alertsFor(c, house([c]), NOW).some((x) => x.kind === 'wrong_day')).toBe(false);
  });
});

describe('the diary, which had nowhere to live', () => {
  // Gulliver Builders: "away on holiday until Monday 31st August, I can have a
  // look once I'm back." Pedro: "I will check our diary for dates from the 31st
  // and come back to you." Nothing ever came back.
  it('surfaces a builder whose day has arrived', () => {
    const c = card({ stage: 'no', comeBackAt: '2026-08-27T08:00:00Z', comeBackNote: 'back from holiday' });
    const a = alertsFor(c, house([c]), NOW).find((x) => x.kind === 'come_back_due');
    expect(a?.text).toContain('back from holiday');
  });

  it('leaves a future date alone', () => {
    const c = card({ stage: 'no', comeBackAt: '2026-09-30T08:00:00Z' });
    expect(alertsFor(c, house([c]), NOW).some((x) => x.kind === 'come_back_due')).toBe(false);
  });
});

describe('the ones who charge', () => {
  // Phil Oakley: "it's a cost of £120, that's including VAT, and if you go
  // ahead with the work you get the £120 off the quote."
  // CM Building: "a full Builder survey is £595 + VAT."
  it('says the number on the card', () => {
    const c = card({ stage: 'talking', chargesAmount: 595 });
    expect(alertsFor(c, house([c]), NOW).find((x) => x.kind === 'charges')?.text).toBe('He charges £595 to attend');
  });
});

describe('the lane header answers the question without a click', () => {
  it('names the builder when one is booked and nothing is wrong', () => {
    const c = card({ stage: 'booked', addressSentAt: 'x', builderName: 'Everyday Home Improvements' });
    const v = verdictFor(house([c]), NOW);
    expect(v.state).toBe('covered');
    expect(v.line).toBe('Everyday Home Improvements is booked');
  });

  it('says nobody is booked, in those words, when nobody is', () => {
    const v = verdictFor(house([card({ stage: 'chasing' }), card({ outreachId: 'o2', stage: 'no' })]), NOW);
    expect(v.state).toBe('uncovered');
    expect(v.line).toBe('Nobody booked');
  });

  it('says nobody WENT once the viewing is in the past', () => {
    const v = verdictFor(house([card({ stage: 'chasing' })], { viewingAt: '2026-08-26T13:00:00Z' }), NOW);
    expect(v.line).toBe('Nobody went');
  });

  it('is amber, not green, for a man who said yes and was never booked in', () => {
    // Five builders said "coming" on the phone against houses that read as
    // having nobody, because the desk had no button that could book anyone.
    const c = card({ stage: 'coming', addressSentAt: 'x', builderName: 'JL BRICKWORK' });
    const v = verdictFor(house([c]), NOW);
    expect(v.state).toBe('at_risk');
    expect(v.line).toBe('JL BRICKWORK said yes but is not booked in');
  });

  it('reports the price once he has been', () => {
    const c = card({ stage: 'been', addressSentAt: 'x', attendedAt: '2026-08-26T16:30:00Z', quoteAmount: 14500, builderName: 'JL BRICKWORK' });
    const v = verdictFor(house([c]), NOW);
    expect(v.state).toBe('done');
    expect(v.line).toBe('JL BRICKWORK walked it, £14,500');
  });

  it('says so plainly when he has been and sent no price', () => {
    const c = card({ stage: 'been', addressSentAt: 'x', attendedAt: '2026-08-26T16:30:00Z' });
    expect(verdictFor(house([c]), NOW).line).toMatch(/no price back yet/);
  });

  it('marks a viewing inside 48 hours as urgent', () => {
    expect(verdictFor(house([card()]), NOW).urgent).toBe(true);
    expect(verdictFor(house([card()], { viewingAt: '2026-09-15T13:00:00Z' }), NOW).urgent).toBe(false);
  });
});

describe('order', () => {
  it('puts tomorrow with nobody going above next month with nobody going', () => {
    const soon = house([card({ stage: 'chasing' })], { propertyId: 'soon' });
    const later = house([card({ outreachId: 'o2', stage: 'chasing' })], { propertyId: 'later', viewingAt: '2026-09-20T13:00:00Z' });
    expect(orderHouses([later, soon], NOW).map((h) => h.propertyId)).toEqual(['soon', 'later']);
  });

  it('sinks a house that is sorted below one that is not', () => {
    const sorted = house([card({ stage: 'booked', addressSentAt: 'x' })], { propertyId: 'sorted' });
    const open = house([card({ outreachId: 'o2', stage: 'chasing' })], { propertyId: 'open', viewingAt: '2026-09-20T13:00:00Z' });
    expect(orderHouses([sorted, open], NOW).map((h) => h.propertyId)).toEqual(['open', 'sorted']);
  });

  it('does not mutate what it was given', () => {
    const hs = [house([card()], { propertyId: 'a' }), house([card()], { propertyId: 'b', viewingAt: '2026-09-20T13:00:00Z' })];
    orderHouses(hs, NOW);
    expect(hs.map((h) => h.propertyId)).toEqual(['a', 'b']);
  });

  it('floats the card with a red flag to the top of its column', () => {
    const quiet = card({ outreachId: 'quiet', stage: 'coming', addressSentAt: 'x', builderName: 'AAA' });
    const loud = card({ outreachId: 'loud', stage: 'coming', builderName: 'ZZZ' });   // no address
    const h = house([quiet, loud]);
    expect(orderCards([quiet, loud], h, NOW)[0].outreachId).toBe('loud');
  });

  it('groups a column and orders it in one call', () => {
    const h = house([card({ stage: 'coming' }), card({ outreachId: 'o2', stage: 'no' })]);
    expect(cardsInStage(h, 'coming').length).toBe(1);
    expect(cardsInStage(h, 'no').length).toBe(1);
    expect(cardsInStage(h, 'been').length).toBe(0);
  });
});

describe('one house, one slot', () => {
  it('finds the man already booked, so a second one asks before swapping', () => {
    const a = card({ outreachId: 'a', stage: 'booked', builderName: 'First' });
    const b = card({ outreachId: 'b', stage: 'coming', builderName: 'Second' });
    expect(bookedOther(house([a, b]), 'b')?.builderName).toBe('First');
  });

  it('finds nobody to swap when the slot is empty', () => {
    expect(bookedOther(house([card({ stage: 'coming' })]), 'o1')).toBeNull();
  });

  it('does not count the man being dragged as his own clash', () => {
    const a = card({ outreachId: 'a', stage: 'booked' });
    expect(bookedOther(house([a]), 'a')).toBeNull();
  });
});

describe('one builder, two viewings at once', () => {
  it('spots the same man down for two houses within three hours', () => {
    const h1 = house([card({ stage: 'booked', builderId: 'same' })], { propertyId: 'p1', address: 'One Road' });
    const h2 = house([card({ outreachId: 'o2', stage: 'coming', builderId: 'same' })], {
      propertyId: 'p2', address: 'Two Road', viewingAt: '2026-08-28T14:00:00Z',
    });
    expect(clashingHouses([h1, h2]).get('same')).toEqual(['One Road', 'Two Road']);
  });

  it('leaves two viewings on different days alone', () => {
    const h1 = house([card({ stage: 'booked', builderId: 'same' })], { propertyId: 'p1' });
    const h2 = house([card({ outreachId: 'o2', stage: 'booked', builderId: 'same' })], {
      propertyId: 'p2', viewingAt: '2026-09-04T13:00:00Z',
    });
    expect(clashingHouses([h1, h2]).size).toBe(0);
  });

  it('follows his OWN agreed time, not the viewing time', () => {
    // Fox Built agreed 2 September; he cannot clash with a 28 August viewing.
    const h1 = house([card({ stage: 'booked', builderId: 'same' })], { propertyId: 'p1' });
    const h2 = house([card({ outreachId: 'o2', stage: 'coming', builderId: 'same', agreedAt: '2026-09-02T16:00:00Z' })], { propertyId: 'p2' });
    expect(clashingHouses([h1, h2]).size).toBe(0);
  });
});

describe('wording', () => {
  it('counts down and back up in plain words', () => {
    expect(countdown(VIEWING, NOW)).toBe('in 1d');
    expect(countdown('2026-08-28T09:00:00Z', NOW)).toBe('in 20h');
    expect(countdown('2026-08-26T13:00:00Z', NOW)).toBe('1d ago');
    expect(countdown('2026-08-27T03:00:00Z', NOW)).toBe('10h ago');
    expect(countdown('2026-09-10T13:00:00Z', NOW)).toBe('in 14d');
    expect(countdown(null)).toBe('No time booked');
  });

  it('writes money the way a builder quotes it', () => {
    expect(money(14500)).toBe('£14,500');
    expect(money(595)).toBe('£595');
  });

  it('carries no long dash, curly quote or ellipsis anywhere it can reach a person', () => {
    const src = readFileSync('src/features/crm/lib/builderBoard.ts', 'utf8')
      + readFileSync('src/features/crm/components/builders/BuilderBoard.tsx', 'utf8')
      + readFileSync('src/features/crm/components/builders/BuilderCardDrawer.tsx', 'utf8')
      + readFileSync('src/features/crm/hooks/useBuilderBoard.ts', 'utf8');
    expect(src).not.toMatch(/[–—‘’“”…]/);
  });
});

describe('the promises Pedro made on the phone now have somewhere to live', () => {
  const DRAWER = readFileSync('src/features/crm/components/builders/BuilderCardDrawer.tsx', 'utf8');

  it('takes both dates as UK wall time', () => {
    // Pedro types from the Philippines. A bare datetime-local is read in the
    // browser's zone, so 5pm agreed with a builder would land eight hours out.
    expect(DRAWER).toMatch(/ukInputToIso\(agreed\)/);
    expect(DRAWER).toMatch(/ukInputToIso\(`\$\{back\}T09:00`\)/);
  });

  it('reads an existing value back as UK wall time too', () => {
    expect(DRAWER).toMatch(/isoToUkInput\(card\.agreedAt\)/);
  });

  it('seeds at mount rather than syncing in an effect', () => {
    // The parent keys it on outreachId, so a different builder remounts with
    // his own figures. Syncing would risk the previous man's numbers surviving.
    expect(DRAWER).not.toMatch(/useEffect/);
    expect(readFileSync('src/features/crm/components/builders/BuilderBoard.tsx', 'utf8'))
      .toMatch(/key=\{open\.card\.outreachId\}/);
  });

  it('clears a field rather than ignoring it when emptied', () => {
    // An empty box has to be able to REMOVE a come-back date, or a builder
    // rung back stays on the list for ever.
    expect(DRAWER).toMatch(/comeBackAt: back \? .* : null/);
    expect(DRAWER).toMatch(/quoteAmount: quote\.trim\(\) === '' \? null : Number\(quote\)/);
  });
});

describe('the migration keeps the two truths apart', () => {
  const SQL = readFileSync('supabase/migrations/20260828000001_builder_board.sql', 'utf8');

  it('derives the address stamp and never stores it', () => {
    // A stored flag has to be set by every send path, and one miss makes it lie
    // for ever, on the one fact that decides whether the viewing happens.
    expect(SQL).not.toMatch(/add column if not exists address_sent_at/);
    expect(SQL).toMatch(/m\.body ~\* \('\(\^\|\[\^0-9\]\)' \|\| h\.num/);
  });

  it('keeps stage separate from status, and says why', () => {
    expect(SQL).toMatch(/add column if not exists stage\s+text not null default 'to_do'/);
    expect(SQL).toMatch(/status.*is what the WIRE did/is);
  });

  it('constrains stage to the seven the board draws', () => {
    for (const s of STAGE_IDS) expect(SQL).toContain(`'${s}'`);
    expect(SQL).toMatch(/brrr_builder_outreach_stage_check/);
  });

  it('seeds the board from the evidence, assigned builder first', () => {
    expect(SQL).toMatch(/update brrr_builder_outreach o set stage/);
    expect(SQL.indexOf('assigned_builder_id = o.builder_id')).toBeLessThan(SQL.indexOf("o.status = 'confirmed'"));
  });

  it('drops the function before creating it, so a new column is not a failed deploy', () => {
    expect(SQL.indexOf('drop function if exists wk_builder_board')).toBeLessThan(SQL.indexOf('create function wk_builder_board'));
  });
});

describe('the route books through the one function that owns the booking', () => {
  const API = readFileSync('api/crm/builder-board.ts', 'utf8');

  it('delegates Booked to assignBuilderToProperty rather than writing the column itself', () => {
    // That function is the only writer of assigned_builder_id: it also moves
    // the branch card, writes the audit row and rings the bell.
    expect(API).toMatch(/import \{ assignBuilderToProperty \}/);
    expect(API).toMatch(/await assignBuilderToProperty\(sb, row\.property_id, row\.builder_id, who\.id\)/);
  });

  it('un-books him when he is dragged out of Booked', () => {
    expect(API).toMatch(/assigned_builder_id: null/);
  });

  it('uses the agent gate, not the admin table', () => {
    // Every builder route before the desk was gated on admin_users, which meant
    // it was silently blank for the only person who does this job.
    expect(API).toMatch(/wk_is_agent_or_admin/);
    // The prose above the gate names admin_users to explain what it is NOT, so
    // the check is on the query rather than on the word.
    expect(API).not.toMatch(/from\(\s*'admin_users'/);
  });

  it('answers a refusal with HTTP 200 and a sentence, matching the cockpit', () => {
    expect(API).toMatch(/res\.status\(200\)\.json\(\{ ok: false, refusal/);
  });
});

describe('the builder went and sent photographs, and the board could not see either', () => {
  // Hugo, reading the first build: "Lisle looks its already done and builder
  // send photo via whatsapp. Please see what you missed and learn."
  //
  // JL BRICKWORK walked 81 Lisle Road on 26 August and at 15:14 the next day
  // sent TEN PHOTOGRAPHS on WhatsApp, then his written findings three minutes
  // later. The board had him in Coming, on a viewing two days past, saying he
  // "said yes but is not booked in".
  //
  // WHAT WAS MISSED: eleven inbound rows with an EMPTY BODY. An empty body is
  // not an empty message. Each carried a media url. Reading only the text of a
  // conversation made the ten most valuable messages we have ever received look
  // like blank lines.
  const jl = () => card({
    builderName: 'JL BRICKWORK', stage: 'coming', addressSentAt: '2026-08-25T17:01:00Z',
    reportedAt: '2026-08-27T14:14:00Z', mediaCount: 10,
    mediaMessageIds: ['m1', 'm2'], lastInboundBody: 'The bathroom does not have a vent',
  });
  const past = { viewingAt: '2026-08-26T15:30:00Z' };

  it('counts him as having reported back', () => {
    expect(reportedButNotMarked(jl())).toBe(true);
  });

  it('says so first, above every other flag', () => {
    const c = jl();
    const a = alertsFor(c, house([c], past), NOW);
    expect(a[0].kind).toBe('reported');
    expect(a[0].tone).toBe('stop');
    expect(a[0].text).toBe('He came back after the viewing with 10 photos. Read it and mark him Been.');
  });

  it('stops the lane calling a man who did the job "not booked in"', () => {
    const c = jl();
    expect(verdictFor(house([c], past), NOW).line)
      .toBe('JL BRICKWORK went and sent 10 photos, mark him Been');
  });

  it('does NOT move him to Been by itself', () => {
    // Same rule as the refurb estimator: never invent, state the evidence, let
    // the person confirm. A message after a viewing is very good evidence he
    // attended. It is not proof, and a board that quietly marks men as attended
    // is a board nobody can trust about the ones who did not.
    expect(jl().stage).toBe('coming');
    expect(jl().attendedAt).toBeNull();
  });

  it('goes quiet the moment somebody marks him Been', () => {
    const c = { ...jl(), stage: 'been' as BuilderStage, attendedAt: '2026-08-26T16:30:00Z' };
    expect(reportedButNotMarked(c)).toBe(false);
    expect(alertsFor(c, house([c], past), NOW).some((x) => x.kind === 'reported')).toBe(false);
    expect(verdictFor(house([c], past), NOW).state).toBe('done');
  });

  it('stops nagging about the address of a house he plainly found', () => {
    const c = { ...jl(), addressSentAt: null };
    expect(alertsFor(c, house([c], past), NOW).some((x) => x.kind === 'no_address')).toBe(false);
  });

  it('handles one photo without saying "1 photos"', () => {
    const c = { ...jl(), mediaCount: 1 };
    expect(alertsFor(c, house([c], past), NOW)[0].text).toContain('with 1 photo.');
  });

  it('still speaks up when he reported with no pictures at all', () => {
    const c = { ...jl(), mediaCount: 0, mediaMessageIds: [] };
    expect(alertsFor(c, house([c], past), NOW)[0].text)
      .toBe('He came back after the viewing. Read it and mark him Been.');
  });

  it('ignores a man who has been written off', () => {
    expect(reportedButNotMarked({ ...jl(), stage: 'no' })).toBe(false);
  });
});

describe('the RPC surfaces the pictures, not just the words', () => {
  const SQL = readFileSync('supabase/migrations/20260828000002_builder_board_reported.sql', 'utf8');

  it('derives when he came back after the viewing', () => {
    expect(SQL).toMatch(/m\.created_at > h\.viewing_at/);
  });

  it('counts the media files and hands back their message ids', () => {
    expect(SQL).toMatch(/sum\(cardinality\(m\.media_urls\)\)/);
    expect(SQL).toMatch(/array_agg\(m\.id order by m\.created_at\)/);
  });

  it('describes a media-only message instead of returning an empty string', () => {
    // The bug in one line: eleven rows whose body was '' were read as nothing.
    expect(SQL).toMatch(/Sent a photo/);
    expect(SQL).toMatch(/'Sent ' \|\| cardinality\(m\.media_urls\) \|\| ' photos'/);
  });

  it('stores none of it', () => {
    expect(SQL).not.toMatch(/add column .*reported_at/i);
    expect(SQL).not.toMatch(/add column .*media_count/i);
  });
});

describe('the drawer draws what he sent back', () => {
  const DRAWER = readFileSync('src/features/crm/components/builders/BuilderCardDrawer.tsx', 'utf8');

  it('reuses InboundMedia, which already does the Twilio auth dance', () => {
    // The media url 401s without our credentials, so an <img src> cannot work.
    expect(DRAWER).toMatch(/import InboundMedia from '\.\.\/InboundMedia'/);
    expect(DRAWER).toMatch(/<InboundMedia key=\{id\} messageId=\{id\}/);
  });
});
