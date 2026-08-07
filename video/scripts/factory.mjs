// factory.mjs: the one command. Drop videos in, get finished posts out.
//
//   cd /Users/hugo/Whats/Poppy/video
//   node scripts/factory.mjs --count=4
//
// That is the whole operating procedure. Put any .mp4 into video/sources-in/,
// run this, and it ingests anything new, works out each clip's rhythm, and
// renders --count variants of every clip it knows about. No editing, no config,
// no code change, nothing to keep in your head between runs.
//
// --count is PER CLIP. Four clips at --count=4 is 16 files; at --count=250 it is
// a thousand. Everything is resumable: rendering the same batch again skips what
// is already there, so a Ctrl-C or a crash costs only the file in flight.
//
// IT IS DELIBERATELY TWO SCRIPTS BEHIND ONE FRONT DOOR. Ingest is slow, paid
// once per clip, and its output is a cached fact about that clip: its frame
// count and its beat map. Rendering is paid per variant. Keeping them separate
// is what stops variant 900 of a clip re-deriving the rhythm variant 1 already
// established, which is the difference between analysing four clips and
// analysing four thousand times.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = resolve(HERE, '..');

const passthrough = process.argv.slice(2);
const step = (label, script, args) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], {
    stdio: 'inherit',
    cwd: VIDEO_DIR,
  });
  if (r.status !== 0) {
    console.error(`\n${label} failed. Nothing after this ran.`);
    process.exit(r.status ?? 1);
  }
};

// Only the flags each step understands. --force means "re-encode the clips" and
// would be meaningless to the renderer; --count means "per clip" and would be
// meaningless to ingest.
// Ambience first, because every video must have a bed and a missing pool would
// otherwise surface as a render that quietly has no background layer.
step('ambience', 'make-ambience.mjs', passthrough.filter((a) => a === '--force'));
step('ingest', 'ingest-sources.mjs', passthrough.filter((a) => a === '--force'));
step('render', 'render-variants.mjs', passthrough.filter((a) => a !== '--force'));

console.log('\nDone. Files are in video/out/variants/<batch>/');
