// The cockpit's screen, checked by reading it.
//
// Written 2026-08-15. Nothing under src/features/crm is in the vitest run
// (vitest.config.ts excludes the whole folder: the ported CRM tests need
// @testing-library/react and jsdom, which are not wired). So the cockpit's
// components are checked the way the rest of this repo checks structure, by
// reading the source, and the only things imported for real are the two pure
// modules that were written flat precisely so they could be.
//
// What these hold:
//   1. the page exists, is reachable, and is NOT admin only
//   2. nothing it was built beside was replaced
//   3. the lifts are lifts and not copies
//   4. the two vocabularies map onto each other completely
//   5. exactly one component can commit anything
//   6. house style: light mode, mobile first, no long dashes

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIONS_BY_STAGE, UNIVERSAL_ACTIONS, FLAGS } from '../api/lib/deal-manager-contract';
import { COCKPIT_ACTIONS as SERVER_ACTIONS } from '../api/lib/deal-stress-test';
import { FLAG_LABEL, sortFlags, attentionTone, hoursAgo } from '../src/features/crm/lib/dealDay';
import {
  COCKPIT_ACTIONS, PRIMARY_BUTTON_FOR, primaryButtonFor, buttonsFor, confirmSentence,
} from '../src/features/crm/components/cockpit/cockpitActions';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const COCKPIT_DIR = 'src/features/crm/components/cockpit';
const cockpitFiles = readdirSync(resolve(root, COCKPIT_DIR))
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .map((f) => [`${COCKPIT_DIR}/${f}`, read(`${COCKPIT_DIR}/${f}`)] as const);

const PAGE = read('src/features/crm/pages/DealCockpitPage.tsx');
const APP = read('src/features/crm/CrmApp.tsx');
const SIDEBAR = read('src/features/crm/layout/Smsv2Sidebar.tsx');
const TODAY = read('src/features/crm/components/deals/TodayPanel.tsx');
const PROPS_PANE = read('src/features/crm/components/live-call/PropertiesPane.tsx');
const PANEL = read(`${COCKPIT_DIR}/CockpitCommandPanel.tsx`);
const BAR_AND_PANEL = PANEL;
const DIALOG = read(`${COCKPIT_DIR}/ActionConfirmDialog.tsx`);

const allCockpitSource = [PAGE, ...cockpitFiles.map(([, s]) => s)].join('\n');

describe('the page is wired up', () => {
  it('has a route, lazily loaded like every other CRM page', () => {
    expect(APP).toMatch(/const DealCockpitPage = lazy\(\(\) => import\('\.\/pages\/DealCockpitPage'\)\)/);
    expect(APP).toMatch(/<Route path="cockpit" element=\{<DealCockpitPage \/>\} \/>/);
  });

  it('is in the sidebar and is NOT admin only', () => {
    // Pedro is a first-class user of the cockpit. Hugo's escalation lane is
    // kept off his screen by RLS on wk_deal_manager_log, not by hiding a page.
    const item = SIDEBAR.match(/\{ label: 'Cockpit'[^}]*\}/)?.[0] ?? '';
    expect(item).toContain("path: '/admin/crm/cockpit'");
    expect(item).not.toContain('adminOnly');
  });

  it('is on the mobile tab bar, because it is where the day starts', () => {
    expect(SIDEBAR).toMatch(/\['Cockpit',/);
  });
});

describe('nothing it was built beside was replaced', () => {
  it('leaves the pipeline board mounting TodayPanel', () => {
    expect(read('src/features/crm/pages/PipelinesPage.tsx')).toContain('<TodayPanel');
  });

  it('leaves the dialer, the inbox and the board routed', () => {
    for (const path of ['dialer-pro', 'inbox', 'pipelines', 'deal-process']) {
      expect(APP).toContain(`path="${path}"`);
    }
  });
});

describe('the lifts are lifts, not copies', () => {
  it('TodayPanel imports the day vocabulary rather than declaring it', () => {
    expect(TODAY).toMatch(/from '\.\.\/\.\.\/lib\/dealDay'/);
    expect(TODAY).not.toMatch(/const FLAG_LABEL/);
    expect(TODAY).not.toMatch(/const FLAG_TONE/);
    expect(TODAY).not.toMatch(/function hours\(/);
  });

  it('no cockpit file declares its own copy either', () => {
    for (const [name, src] of cockpitFiles) {
      expect(src, name).not.toMatch(/const FLAG_LABEL/);
      expect(src, name).not.toMatch(/const FLAG_TONE/);
    }
  });

  it('PropertiesPane imports the lifted CompGroup rather than defining one', () => {
    expect(PROPS_PANE).toMatch(/import CompGroup from '\.\.\/shared\/CompGroup'/);
    expect(PROPS_PANE).not.toMatch(/function CompGroup/);
  });

  it('the day vocabulary still behaves the way both screens expect', () => {
    // Imported for real, not read as text: this is the one part of the cockpit
    // whose logic vitest can actually execute.
    expect(attentionTone(95)).toContain('DC2626');
    expect(attentionTone(50)).toContain('C2410C');
    expect(attentionTone(10)).toContain('6B7280');
    expect(hoursAgo(null)).toBe('never touched');
    expect(hoursAgo(0.5)).toBe('just now');
    expect(hoursAgo(5)).toBe('5h ago');
    expect(hoursAgo(72)).toBe('3d ago');
  });

  it('puts the branch that wrote to us at the front of the flags', () => {
    // That is the one that was actually costing money: Lexi's rejection sat
    // unread for seven hours while a fresh offer was about to go out blind.
    expect(sortFlags(['stale_no_touch', 'reply_unread'])[0]).toBe('reply_unread');
    expect(sortFlags(['pack_incomplete', 'blocked_needs_hugo'])[0]).toBe('blocked_needs_hugo');
  });
});

describe('the two vocabularies map onto each other completely', () => {
  // The contract holds what the AI INTENDS; the cockpit holds what a BUTTON
  // EXECUTES. If a new action is added to the contract and nobody maps it, the
  // build fails here instead of Pedro seeing `chase_written_acceptance`.
  const everyContractAction = [
    ...new Set([...Object.values(ACTIONS_BY_STAGE).flat(), ...UNIVERSAL_ACTIONS]),
  ];

  it('every action the AI can choose has a button', () => {
    for (const a of everyContractAction) {
      expect(PRIMARY_BUTTON_FOR[a], `${a} has no button`).toBeTruthy();
    }
  });

  it('every button it maps to is a real one', () => {
    for (const [intent, button] of Object.entries(PRIMARY_BUTTON_FOR)) {
      expect(COCKPIT_ACTIONS[button], `${intent} maps to unknown ${button}`).toBeTruthy();
    }
  });

  it('the client\'s button list matches the server\'s exactly', () => {
    expect(Object.keys(COCKPIT_ACTIONS).sort()).toEqual([...SERVER_ACTIONS].sort());
  });

  it('every flag the contract can raise has plain English for it', () => {
    for (const f of FLAGS) expect(FLAG_LABEL[f], `${f} has no label`).toBeTruthy();
    expect(Object.keys(FLAG_LABEL).sort()).toEqual([...FLAGS].sort());
  });

  it('never renders a raw code, even for an action it has never heard of', () => {
    expect(primaryButtonFor('something_invented_later')).toBe('hold');
    expect(primaryButtonFor(null)).toBe('hold');
  });

  it('always offers looking and writing a note, because neither can be wrong', () => {
    const buttons = buttonsFor({ action: 'make_offer_call', allowedActions: ['make_offer_call'] });
    expect(buttons).toContain('compare_comps');
    expect(buttons).toContain('add_note');
    expect(buttons[0]).toBe('call_branch');
  });

  it('says what is about to happen in the present tense', () => {
    const deal = {
      address: '12 Welwyn Park Road', contactName: 'Zest Hull',
      branchEmail: 'lucy@example.co.uk', branchPhone: '01482 251703',
    };
    expect(confirmSentence('send_email', deal)).toBe(
      'Send this email to lucy@example.co.uk about 12 Welwyn Park Road.',
    );
    expect(confirmSentence('call_branch', deal)).toContain('Ring Zest Hull on 01482 251703');
    // Never a past tense that implies it already happened.
    for (const a of Object.keys(COCKPIT_ACTIONS) as Array<keyof typeof COCKPIT_ACTIONS>) {
      expect(confirmSentence(a, deal)).not.toMatch(/\b(sent|rang|booked|has been)\b/i);
    }
  });
});

describe('exactly one component can commit anything', () => {
  it('the action bar only asks, it never does', () => {
    // The bar lives inside the command panel and calls onRequest(action).
    // Everything that can actually happen goes through the gate.
    expect(BAR_AND_PANEL).not.toMatch(/\bfetch\(/);
    expect(BAR_AND_PANEL).not.toMatch(/wk-email-send/);
    expect(BAR_AND_PANEL).toMatch(/onRequest\(a\)/);
  });

  it('only the gate sends an email', () => {
    for (const [name, src] of cockpitFiles) {
      if (name.endsWith('ActionConfirmDialog.tsx')) continue;
      expect(src, name).not.toMatch(/wk-email-send/);
    }
    expect(DIALOG).toMatch(/functions\.invoke\('wk-email-send'/);
  });

  it('the gate re-runs the checks on open rather than trusting the list', () => {
    // The checks that came down with the queue could be twenty minutes old.
    // The one that matters is the one true right now.
    expect(DIALOG).toMatch(/phase: 'check'/);
  });

  it('a blocking check disables the button and prints its reason verbatim', () => {
    expect(DIALOG).toMatch(/const blocked = report \? !report\.ok : false/);
    expect(DIALOG).toMatch(/canCommit = .*!blocked/);
    expect(DIALOG).toMatch(/\{firstBlock\.detail\}/);
    // Not a tooltip and not a code.
    expect(DIALOG).toMatch(/data-testid="cockpit-confirm-blocked"/);
  });

  it('a warning asks rather than blocks, because judgement stays with the human', () => {
    // commitVerbFor, not spec.commitVerb, since 17 Aug: "Send it to Hugo"
    // reads as nonsense to Hugo, so an admin sees "Put it on my list". Only
    // the words change; the same press does the same thing.
    expect(DIALOG).toMatch(/warned && !blocked \? `\$\{commitVerbFor\(action, isAdmin\)\} anyway`/);
    expect(DIALOG).toMatch(/acknowledged/);
  });

  it('guards a double press and never autofocuses the commit button', () => {
    expect(DIALOG).toMatch(/requestId/);
    expect(DIALOG).not.toMatch(/autoFocus/);
  });

  it('a late draft never overwrites what somebody has started typing', () => {
    expect(DIALOG).toMatch(/touched\.current/);
  });
});

describe('the client never re-derives a deal, and never moves a card', () => {
  it('normalises the engine\'s deal shape in exactly one place', () => {
    expect(PANEL).toMatch(/usePropertyListings/);
    for (const [name, src] of cockpitFiles) {
      expect(src, name).not.toMatch(/deal\.cmv/);
      expect(src, name).not.toMatch(/offerRange\(/);
      expect(src, name).not.toMatch(/compText\(/);
    }
  });

  it('borrows the brief, the money and the comps rather than redrawing them', () => {
    expect(PANEL).toMatch(/import NextStepCard from '@\/core\/property\/NextStepCard'/);
    expect(PANEL).toMatch(/import OfferStrip from '\.\.\/live-call\/OfferStrip'/);
    expect(PANEL).toMatch(/import CompGroup from '\.\.\/shared\/CompGroup'/);
  });

  it('holds no stage map of its own: the server says what is allowed', () => {
    // On the IMPORT and the DECLARATION, not the word: cockpitActions.ts names
    // ACTIONS_BY_STAGE in a comment explaining which test keeps the mapping
    // total, and documenting where the authority lives is the opposite of
    // taking it.
    expect(allCockpitSource).not.toMatch(/import[\s\S]{0,120}?ACTIONS_BY_STAGE/);
    expect(allCockpitSource).not.toMatch(/(const|let)\s+ACTIONS_BY_STAGE/);
    // No board column name as a string anywhere: the moment one appears, the
    // client has started deciding what a stage allows.
    for (const col of [
      'Ready for call 2', 'Ballpark agreed', 'Viewing booked',
      'Offer sent', 'Offer accepted', 'Sent to investor',
    ]) {
      expect(allCockpitSource, col).not.toContain(`'${col}'`);
    }
    // The buttons on offer come from what the SERVER said this stage allows.
    expect(read(`${COCKPIT_DIR}/cockpitActions.ts`)).toMatch(/deal\.allowedActions/);
    expect(PANEL).toMatch(/buttonsFor\(deal\)/);
  });

  it('never writes a pipeline column', () => {
    expect(allCockpitSource).not.toMatch(/pipeline_column_id/);
  });
});

describe('house style', () => {
  it('is light mode only, like the whole app', () => {
    expect(allCockpitSource).not.toMatch(/\bdark:/);
  });

  it('is mobile first: the single column comes before any breakpoint', () => {
    const grid = PAGE.match(/data-testid="cockpit-grid"[\s\S]*?"\s*\/?>/)?.[0] ?? PAGE;
    expect(grid.indexOf('grid-cols-1')).toBeGreaterThan(-1);
    expect(grid.indexOf('grid-cols-1')).toBeLessThan(grid.indexOf('md:grid-cols-'));
    expect(grid.indexOf('md:grid-cols-')).toBeLessThan(grid.indexOf('xl:grid-cols-'));
  });

  it('THE FLEX CHAIN IS UNBROKEN, which is what made the page unusable', () => {
    // 2026-08-16, Hugo: "I cannot click anything, I cannot scroll down, I
    // cannot make calls from the cockpit."
    //
    // MEASURED on the live page at a 700px viewport: the command panel was
    // 1220px tall inside a 586px box and could NOT scroll, so the action bar
    // rendered at y=1393, eight hundred pixels below the bottom of the screen,
    // with nothing able to reach it. Every button existed. None was reachable.
    //
    // The cause was one word. The wrapper around the panel was a BLOCK div,
    // and the panel's root is `flex-1`. flex-1 inside a block parent is inert,
    // so the panel's height fell back to its content and the inner scroller
    // never got a bounded height to scroll within.
    //
    // Every ancestor of a scroller has to be a flex column that can shrink.
    // This test walks that chain, because a screenshot at a tall viewport hid
    // it and the e2e only ever asserted the columns were VISIBLE.
    const wrapper = PAGE.match(/<div className="flex min-h-0 flex-1 flex-col overflow-hidden">/);
    expect(wrapper, 'the panel wrapper must be a flex column, not a block').toBeTruthy();

    // The grid row is constrained too, or a grid item sizes to its content.
    expect(PAGE).toContain('md:grid-rows-[minmax(0,1fr)]');

    // And the panel's own root still expects to be a flex child.
    expect(PANEL).toMatch(/<div className="flex min-h-0 flex-1 flex-col">/);
    // with its scroller and its action bar as siblings, so the bar never
    // scrolls away and never falls off the bottom.
    expect(PANEL).toMatch(/min-h-0 flex-1 overflow-y-auto[\s\S]*?data-testid="cockpit-command"/);
    expect(PANEL).toMatch(/flex-shrink-0[\s\S]*?data-testid="cockpit-actions"/);
  });

  it('offers the things a person may do about ANY deal, not only what the AI named', () => {
    // The second half of the same complaint: ringing a branch only appeared
    // when the machine happened to suggest it, so on a deal whose instruction
    // was "chase the reply" there was no way to pick up the phone at all.
    const buttons = buttonsFor({ action: 'chase_email_reply', allowedActions: ['chase_email_reply'] });
    for (const always of ['call_branch', 'draft_follow_up_email', 'compare_comps', 'move_stage', 'book_followup', 'add_note']) {
      expect(buttons, always).toContain(always);
    }
  });

  it('carries min-h-0, without which the columns silently scroll the page', () => {
    expect(PAGE).toMatch(/grid min-h-0 flex-1/);
    expect(PAGE).toMatch(/flex min-h-0 flex-col overflow-hidden/);
    // minmax(0,1fr) on the centre: without it one long address blows the grid
    // out and the history column falls off the screen.
    expect(PAGE).toContain('minmax(0,1fr)');
  });

  it('has three columns at xl and hides the history below it', () => {
    expect(PAGE).toMatch(/xl:grid-cols-\[minmax\(300px,360px\)_minmax\(0,1fr\)_minmax\(320px,400px\)\]/);
    expect(PAGE).toMatch(/'hidden xl:flex'/);
    expect(PAGE).toMatch(/data-testid="cockpit-view-tabs"/);
  });

  it('degrades honestly when the brain is off', () => {
    expect(PAGE).toMatch(/managerEnabled \? BRAIN_ON_NOTE : BRAIN_OFF_NOTE/);
    expect(PAGE).toMatch(/NOTHING_WAITING/);
  });

  it('writes no long dashes and no curly punctuation anywhere', () => {
    for (const [name, src] of [...cockpitFiles, ['DealCockpitPage.tsx', PAGE] as const]) {
      expect(src, name).not.toMatch(/[–—‘’“”…]/);
    }
  });
});

describe('the brain runs the show: one order, one button, one card per branch', () => {
  // Hugo, 16 Aug: "there are only 15 deals pedro called on the pipeline but on
  // cockpit looks like there are 35 ... keep simple and to the point ... the
  // brain has to run the show". The order is the hero, the working folds away,
  // and a branch holding six houses is ONE card with a house switcher.

  it('leads with the order and puts the primary button right under it', () => {
    expect(PANEL).toMatch(/data-testid="cockpit-order"/);
    expect(PANEL).toMatch(/data-testid="cockpit-primary-action"/);
    // The hero renders before the detail fold in source order, so the first
    // thing on the panel is the order, not the working.
    expect(PANEL.indexOf('cockpit-order')).toBeLessThan(PANEL.indexOf('cockpit-detail-toggle'));
  });

  it('folds the working away, closed by default', () => {
    expect(PANEL).toMatch(/data-testid="cockpit-detail-toggle"/);
    expect(PANEL).toMatch(/const \[showDetail, setShowDetail\] = useState\(false\)/);
    // The brief, the money and the checklist all live INSIDE the fold.
    const fold = PANEL.slice(PANEL.indexOf('cockpit-detail-toggle'));
    for (const inner of ['NextStepCard', 'OfferStrip', 'checklist.missing', 'cockpit-comparisons-toggle']) {
      expect(fold, inner).toContain(inner);
    }
  });

  it('a reveal opens the fold instead of dying against the page filter', () => {
    expect(PANEL).toMatch(/kind === 'reveal'/);
    expect(PANEL).toMatch(/setShowDetail\(true\);\s*\n\s*setShowComps\(true\)/);
  });

  it('one card per branch: the row leads with the office and lists its houses', () => {
    const QUEUE = read(`${COCKPIT_DIR}/CockpitQueue.tsx`);
    expect(QUEUE).toMatch(/deal\.contactName \?\? deal\.address/);
    expect(QUEUE).toMatch(/more \{deal\.others!\.length === 1 \? 'house' : 'houses'\}/);
    // A switched-to sub-house still lights up its branch card.
    expect(QUEUE).toMatch(/\(d\.others \?\? \[\]\)\.some/);
  });

  it('the panel gets the house switcher and the page wires it', () => {
    expect(PANEL).toMatch(/data-testid="cockpit-house-switcher"/);
    expect(PAGE).toMatch(/houses=\{houses\}/);
    expect(PAGE).toMatch(/onSelectHouse=\{select\}/);
    // j/k and auto-advance index by CARD, not by house, or the keys strand on
    // a sub-house.
    expect(PAGE.match(/\(d\.others \?\? \[\]\)\.some\(\(o\) => o\.propertyId === selectedId\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });

  it('the footer counts branches, in words', () => {
    expect(PAGE).toMatch(/branches waiting to be rung/);
    expect(PAGE).toMatch(/taken off the board/);
  });
});
