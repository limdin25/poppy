// Bundle the bench to one runnable file (same pattern as worker/build.mjs):
// the TS provider builders are shared with the worker, so the bench proves
// the exact request shapes production will use.

import { build } from 'esbuild';

await build({
  entryPoints: ['bench/run-bench.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'bench/dist/run-bench.mjs',
  banner: { js: '// built by bench/build.mjs; do not edit by hand' },
});

console.log('bench/dist/run-bench.mjs built');
