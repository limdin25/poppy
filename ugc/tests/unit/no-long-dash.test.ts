// The no-long-dash rule, machine-enforced for the whole ugc/ app from commit
// one (Hugo, 2026-07-27: "no long dashes ever, we don't use"). Same idea as the
// root repo's tests/message-copy.test.ts but applied to EVERY file here: code,
// comments, UI copy, docs, SQL. Also bans curly quotes and the ellipsis
// character. In SMS bodies these flip GSM-7 to UCS-2 and triple the cost; in
// everything else they are simply against the house rule.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const UGC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Characters are built from code points so this file passes its own scan:
// no banned glyph ever appears literally in this file.
const BANNED: Array<[string, RegExp]> = [
  ['em dash', new RegExp('\\u2014')],
  ['en dash', new RegExp('\\u2013')],
  ['left curly single quote', new RegExp('\\u2018')],
  ['right curly single quote', new RegExp('\\u2019')],
  ['left curly double quote', new RegExp('\\u201C')],
  ['right curly double quote', new RegExp('\\u201D')],
  ['ellipsis character', new RegExp('\\u2026')],
];

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.md', '.sql', '.json',
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vercel', 'playwright-report', 'test-results']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.has(extname(name))) out.push(full);
  }
  return out;
}

describe('no long dashes anywhere in ugc/', () => {
  const files = walk(UGC_ROOT);

  it('scans a real file tree, not an empty directory', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('finds no banned characters in any file', () => {
    const offences: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [label, re] of BANNED) {
        if (re.test(text)) {
          const line = text.split('\n').findIndex((l) => re.test(l)) + 1;
          offences.push(`${relative(UGC_ROOT, file)}:${line} contains a ${label}`);
        }
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
