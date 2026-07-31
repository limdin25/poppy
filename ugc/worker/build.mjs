// Bundle the worker to one self-contained file for the VPS (same pattern as
// deploying vsl-render-worker: node + ffmpeg are the only runtime deps).
// esbuild ships inside vite's dependency tree; no extra install.

import { build } from 'esbuild';

await build({
  entryPoints: ['worker/worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'worker/dist/worker.mjs',
  banner: { js: '// built by worker/build.mjs; do not edit by hand' },
});

console.log('worker/dist/worker.mjs built');
