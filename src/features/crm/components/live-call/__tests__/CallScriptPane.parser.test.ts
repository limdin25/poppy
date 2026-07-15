// Unit tests for the CallScriptPane Markdown parser. Locks the
// IF-branch detection introduced in PR 3 so a future edit can't
// silently strip the orange-pill behaviour.

import { describe, it, expect } from 'vitest';
import { parseBlocks } from '../../../lib/scriptParser';

describe('CallScriptPane parseBlocks', () => {
  it('parses headings, paragraphs, hr, blockquotes', () => {
    const blocks = parseBlocks(
      '# H1\n## H2\n### H3\n\nParagraph line.\n\n---\n\n> Quote line.'
    );
    expect(blocks).toEqual([
      { type: 'h', level: 1, text: 'H1' },
      { type: 'h', level: 2, text: 'H2' },
      { type: 'h', level: 3, text: 'H3' },
      { type: 'p', text: 'Paragraph line.' },
      { type: 'hr' },
      { type: 'q', text: 'Quote line.' },
    ]);
  });

  it('parses regular list items as plain', () => {
    const blocks = parseBlocks('- One\n- Two\n* Three');
    expect(blocks).toEqual([
      {
        type: 'ul',
        items: [
          { kind: 'plain', text: 'One' },
          { kind: 'plain', text: 'Two' },
          { kind: 'plain', text: 'Three' },
        ],
      },
    ]);
  });

  it('detects IF-branch list items and extracts condition + body', () => {
    const blocks = parseBlocks(
      "- If they're busy: \"No problem — when's a better time?\"\n- If active: probe budget + timeline.\n- Plain bullet"
    );
    expect(blocks).toEqual([
      {
        type: 'ul',
        items: [
          {
            kind: 'if',
            condition: "they're busy",
            text: '"No problem — when\'s a better time?"',
          },
          {
            kind: 'if',
            condition: 'active',
            text: 'probe budget + timeline.',
          },
          { kind: 'plain', text: 'Plain bullet' },
        ],
      },
    ]);
  });

  it('matches all six IF-branches in the seed default script', () => {
    // Mirrors supabase/migrations/20260426000001_smsv2_terminology_and_script.sql
    // Hugo seed — pinned here so a script edit doesn't silently break the
    // orange-pill rendering.
    const seedScript = [
      '## 1. Open',
      '- "Hi {{first_name}}…"',
      "- If they're busy: \"No problem — when's a better time later today, morning or afternoon?\"",
      '',
      '## 2. Qualify',
      '- "Are you actively looking?"',
      '- If active: probe budget + timeline.',
      '- If watching: build interest before pitching.',
      '',
      '## 6. SMS-close',
      '- "What\'s best — shall I send the breakdown?"',
      '- If they refuse SMS: bend → give the spoken breakdown.',
      '',
      '## Cheat-sheet',
      '- "Where are you based?" → "Manchester."',
      '- If asked about office: "online only".',
      '- If asked about visit: "yes, can arrange".',
    ].join('\n');

    const blocks = parseBlocks(seedScript);
    const ifItems = blocks
      .filter((b): b is Extract<typeof blocks[number], { type: 'ul' }> => b.type === 'ul')
      .flatMap((b) => b.items)
      .filter((it) => it.kind === 'if');

    expect(ifItems).toHaveLength(6);
    expect(ifItems.map((i) => i.condition)).toEqual([
      "they're busy",
      'active',
      'watching',
      'they refuse SMS',
      'asked about office',
      'asked about visit',
    ]);
  });

  it('does not over-match: list items merely containing "if" are plain', () => {
    const blocks = parseBlocks(
      '- "If you have time, that\'d be great" — read this aloud\n- We talk about If conditions all day'
    );
    expect(blocks).toEqual([
      {
        type: 'ul',
        items: [
          {
            kind: 'plain',
            text: '"If you have time, that\'d be great" — read this aloud',
          },
          { kind: 'plain', text: 'We talk about If conditions all day' },
        ],
      },
    ]);
  });
});
