// Two guarantees about environment variables, enforced forever:
//
// 1. Every env var the code reads is documented in ENV.md. An undocumented
//    var is how a deploy silently ships half-configured.
// 2. Provider keys (Gemini, BytePlus, fal, Kling) are only ever read by the
//    VPS worker or the hand-run bench. If one is referenced under src/ or
//    api/, it is on its way to a browser bundle or a Vercel function, and
//    this test fails the build before that can deploy.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UGC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const FORBIDDEN_OUTSIDE_WORKER = [
  'GEMINI_API_KEY',
  'ARK_API_KEY',
  'BYTEPLUS_AK',
  'BYTEPLUS_SK',
  'FAL_KEY',
  'KLING_ACCESS_KEY',
  'KLING_SECRET_KEY',
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function envRefs(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]!);
  for (const m of text.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) names.add(m[1]!);
  for (const m of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]*)/g)) names.add(m[1]!);
  return [...names];
}

const CODE_DIRS = ['src', 'api', 'worker', 'bench'].map((d) => join(UGC_ROOT, d));
const manifest = readFileSync(join(UGC_ROOT, 'ENV.md'), 'utf8');

describe('env manifest', () => {
  it('every env var referenced in code is documented in ENV.md', () => {
    const undocumented: string[] = [];
    for (const dir of CODE_DIRS) {
      for (const file of walk(dir)) {
        for (const name of envRefs(readFileSync(file, 'utf8'))) {
          // NODE_ENV and vitest's own flags are runtime plumbing, not config.
          if (name === 'NODE_ENV' || name === 'MODE' || name === 'DEV') continue;
          if (!manifest.includes(name)) {
            undocumented.push(`${name} (${relative(UGC_ROOT, file)})`);
          }
        }
      }
    }
    expect(undocumented, undocumented.join('\n')).toEqual([]);
  });

  it('provider keys are never referenced from src/ or api/', () => {
    const leaks: string[] = [];
    for (const dir of [join(UGC_ROOT, 'src'), join(UGC_ROOT, 'api')]) {
      for (const file of walk(dir)) {
        const text = readFileSync(file, 'utf8');
        for (const key of FORBIDDEN_OUTSIDE_WORKER) {
          if (text.includes(key)) leaks.push(`${key} referenced in ${relative(UGC_ROOT, file)}`);
        }
      }
    }
    expect(leaks, leaks.join('\n')).toEqual([]);
  });
});
