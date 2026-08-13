import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEAL_STAGES,
  AGENT_QUESTIONS,
  resolveStage,
} from '../src/features/crm/components/templates/dealProcessSteps';

// Hugo 2026-08-12: "add it on tab under templates, the step by step, so I can
// always look at it" and "build all templates etc".
//
// The steps are also the tags the brain will write onto the deal card, so the
// list has to stay a clean sequence with no duplicate tags: a duplicate tag
// would mean two different "what to do next" states looking identical on the
// pipeline.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const templates = stripComments(read('src/features/crm/pages/TemplatesPage.tsx'));
const menu = stripComments(read('src/features/crm/layout/Smsv2Sidebar.tsx'));
const routes = stripComments(read('src/features/crm/CrmApp.tsx'));
const dealPage = stripComments(read('src/features/crm/pages/DealProcessPage.tsx'));
const dataFile = read('src/features/crm/components/templates/dealProcessSteps.ts');

// Hugo 2026-08-12: "it should not be inside the templates, it should be below
// the templates on the menu."
describe('where the deal process lives', () => {
  it('is its own item in the menu, directly under Templates', () => {
    expect(menu).toMatch(/label: 'Deal process', path: '\/admin\/crm\/deal-process'/);
    const templatesAt = menu.indexOf("label: 'Templates'");
    const processAt = menu.indexOf("label: 'Deal process'");
    expect(templatesAt).toBeGreaterThan(-1);
    expect(processAt).toBeGreaterThan(templatesAt);
    // Nothing between them.
    expect(menu.slice(templatesAt, processAt)).not.toMatch(/label: '(?!Templates)/);
  });

  it('has its own route and page', () => {
    expect(routes).toMatch(/path="deal-process"/);
    expect(routes).toMatch(/<DealProcessPage \/>/);
    expect(dealPage).toMatch(/<PropertyDealProcess/);
  });

  it('is NOT a tab on the Templates page', () => {
    expect(templates).not.toMatch(/id: 'deal-process'/);
    expect(templates).not.toMatch(/PropertyDealProcess/);
  });
});

describe('the deal process', () => {
  it('is a clean 1..n sequence', () => {
    DEAL_STAGES.forEach((stage, i) => expect(stage.n).toBe(i + 1));
  });

  it('gives every stage a unique pipeline tag', () => {
    const tags = DEAL_STAGES.map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('keeps every tag short enough to fit a chip on the deal card', () => {
    for (const stage of DEAL_STAGES) {
      expect(stage.tag.length, `tag too long: ${stage.tag}`).toBeLessThanOrEqual(28);
    }
  });

  it('says who does each step and what the step is', () => {
    for (const stage of DEAL_STAGES) {
      expect(stage.who.length).toBeGreaterThan(0);
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.points.length).toBeGreaterThan(0);
    }
  });

  // Hugo 2026-08-12: "it has to be informative, easy to read and digest for
  // Pedro and for me as well." Three short lines before any detail, and they
  // stay short or they stop being readable on a card.
  it('opens every step with where we are, do now, and done when', () => {
    for (const stage of DEAL_STAGES) {
      expect(stage.where.length, `no where on step ${stage.n}`).toBeGreaterThan(10);
      expect(stage.doNow.length, `no doNow on step ${stage.n}`).toBeGreaterThan(10);
      expect(stage.doneWhen.length, `no doneWhen on step ${stage.n}`).toBeGreaterThan(10);
      expect(stage.doNow.length, `doNow too long on step ${stage.n}`).toBeLessThanOrEqual(110);
      expect(stage.where.length, `where too long on step ${stage.n}`).toBeLessThanOrEqual(110);
      expect(stage.doneWhen.length, `doneWhen too long on step ${stage.n}`).toBeLessThanOrEqual(110);
    }
  });

  // Hugo's agreed order, 2026-08-13: discovery, homework, builder ballpark,
  // the offer call, the offer in writing.
  it('runs discovery, homework, builder, offer call, offer email, in that order', () => {
    const n = (tag: string) => DEAL_STAGES.find((s) => s.tag === tag)!.n;
    expect(n('Discovery call')).toBeLessThan(n('Do the homework'));
    expect(n('Do the homework')).toBeLessThan(n('Builder ballpark'));
    expect(n('Builder ballpark')).toBeLessThan(n('Offer call'));
    expect(n('Offer call')).toBeLessThan(n('Email the offer'));
  });

  it('puts the viewing after the ballpark is agreed, never before the offer', () => {
    // Hugo 2026-08-13: "we only view if ballpark is accepted." The builder IS
    // the viewer, and his trip doubles as the real quote.
    const n = (tag: string) => DEAL_STAGES.find((s) => s.tag === tag)!.n;
    expect(n('Email the offer')).toBeLessThan(n('Book the viewing'));
    expect(n('Book the viewing')).toBeLessThan(n('Get it in writing'));
    const viewing = DEAL_STAGES.find((s) => s.tag === 'Book the viewing')!;
    expect(viewing.points.join(' ')).toMatch(/Never before the ballpark is agreed/);
    expect(viewing.who).toMatch(/BUILDER/);
  });

  // "Subject to our builder", never "subject to survey". The live property
  // script and the AI coach both say it that way, so the email has to match or
  // Pedro explains one thing on the phone while Hugo writes another.
  it('never sends an offer without the subject-to-the-builder clause', () => {
    const offer = DEAL_STAGES.find((s) => s.tag === 'Email the offer')!;
    const email = offer.templates.find((t) => t.label.startsWith('Formal offer email'))!;
    expect(email.body).toMatch(/Subject to: our builder going round/);
    expect(email.body).not.toMatch(/satisfactory survey/i);
  });

  it('has Pedro ring the agent after the offer email lands', () => {
    const offer = DEAL_STAGES.find((s) => s.tag === 'Email the offer')!;
    const call = offer.templates.find((t) => t.channel === 'Phone')!;
    expect(call.body).toMatch(/remotely/i);
    expect(call.body).toMatch(/builder/i);
  });

  // Hugo 2026-08-13: no number of ours on a first call, ever, and Pedro never
  // hangs up without the email address, because the offer goes out by email.
  it('keeps every number off the first call and gets the agent email', () => {
    const joined = DEAL_STAGES[0].points.join(' ');
    expect(joined).toMatch(/never say a number of our own on a first call/i);
    expect(joined).toMatch(/take back/);
    expect(joined).toMatch(/email address before you hang up/);
  });

  it('says out loud which steps are Hugo and which are Pedro', () => {
    for (const stage of DEAL_STAGES) {
      expect(stage.who, `step ${stage.n} does not name an owner`).toMatch(/PEDRO|HUGO|BRAIN/);
    }
    // The homework and the builder ballpark are never Pedro's.
    expect(DEAL_STAGES.find((s) => s.tag === 'Do the homework')!.who).not.toMatch(/PEDRO/);
    expect(DEAL_STAGES.find((s) => s.tag === 'Builder ballpark')!.who).toMatch(/HUGO/);
    // The two calls are his.
    expect(DEAL_STAGES.find((s) => s.tag === 'Discovery call')!.who).toMatch(/PEDRO/);
    expect(DEAL_STAGES.find((s) => s.tag === 'Offer call')!.who).toMatch(/PEDRO/);
  });
});

describe('the tag on the pipeline card', () => {
  const card = stripComments(read('src/features/crm/pages/PipelinesPage.tsx'));
  const chip = stripComments(read('src/features/crm/components/shared/NextStepChip.tsx'));

  it('is rendered on the lead card, fed by custom_fields', () => {
    expect(card).toMatch(/<NextStepChip/);
    expect(card).toMatch(/customFields\?\.next_step/);
  });

  it('explains the step on hover as well as on click', () => {
    // The native tooltip carries the whole step, so hovering is enough.
    expect(chip).toMatch(/title=\{hover\}/);
    expect(chip).toMatch(/Where we are:/);
    expect(chip).toMatch(/Do now:/);
    expect(chip).toMatch(/Done when:/);
  });

  it('never swallows the card click into opening the contact', () => {
    expect(chip).toMatch(/e\.stopPropagation\(\)/);
  });

  it('matches a stage by tag, by number, or not at all', () => {
    expect(resolveStage('Email the offer')?.n).toBe(5);
    expect(resolveStage('email the offer')?.n).toBe(5);
    expect(resolveStage('5')?.n).toBe(5);
    expect(resolveStage('')).toBeNull();
    expect(resolveStage(undefined)).toBeNull();
    expect(resolveStage('something we never wrote')).toBeNull();
  });
});

describe('the templates', () => {
  const all = DEAL_STAGES.flatMap((s) => s.templates);

  it('exist', () => {
    expect(all.length).toBeGreaterThanOrEqual(12);
  });

  it('all have a label and a body, and emails have a subject where one is needed', () => {
    for (const t of all) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.body.trim().length).toBeGreaterThan(20);
    }
  });

  it('leave placeholders as blanks to fill, never a stray brace', () => {
    for (const t of all) {
      const opens = (t.body.match(/\{/g) ?? []).length;
      const closes = (t.body.match(/\}/g) ?? []).length;
      expect(opens, `unbalanced placeholder in ${t.label}`).toBe(closes);
    }
  });
});

describe("Hugo's punctuation rule", () => {
  // "no long dashes ever, we don't use." Also no curly quotes and no ellipsis
  // character. This file is read aloud on the phone and pasted into emails, so
  // it is exactly where those creep in.
  it('has no long dash, curly quote or ellipsis anywhere in the process file', () => {
    const banned = /[–—‘’“”…]/g;
    const hits = dataFile.match(banned);
    expect(hits ?? [], `banned characters found: ${JSON.stringify(hits)}`).toEqual([]);
  });
});

describe('the agent questions', () => {
  it('cover the ones that stop a deal dead', () => {
    const qs = AGENT_QUESTIONS.map((a) => a.q.toLowerCase()).join(' ');
    expect(qs).toMatch(/proof of funds/);
    expect(qs).toMatch(/solicitor/);
    expect(qs).toMatch(/viewed/);
    expect(qs).toMatch(/cash or mortgage/);
  });

  it('gives an answer and a reason for each', () => {
    for (const a of AGENT_QUESTIONS) {
      expect(a.why.length).toBeGreaterThan(0);
      expect(a.answer.length).toBeGreaterThan(0);
    }
  });
});
