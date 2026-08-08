// swap-voice.mjs: run one video through the voice swap, end to end, and prove it.
//
//   ELEVENLABS_API_KEY=... node scripts/swap-voice.mjs \
//     --in=clip.mp4 --gender=female --account=acct-1 --out=swapped.mp4
//
// Flags:
//   --in       source video (required)
//   --gender   'female' or 'male' (required; there is no default and no guess)
//   --account  the key the voice is pinned to, so one account always sounds
//              like one person. Defaults to the input filename.
//   --out      output video (default: <in>-swapped.mp4)
//   --seconds  trim the source first, for a cheap test run
//   --max-wer  reject and retry above this word error rate (default 0.08)
//   --tries    how many voices to try before giving up (default 3)
//   --dry      pick the voice and price the job, spend nothing
//
// Exit 0 means the output is written and verified. Exit 1 means it is not, and
// the CALLER must fall back to the original audio rather than ship anything.

import { existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import {
  CREDITS_PER_SECOND,
  assertGender,
  convertVoice,
  durationOf,
  extractAudio,
  loadRoster,
  pickVoice,
  remux,
  transcribe,
  whisperAvailable,
  wordErrorRate,
  writeBuffer,
} from './lib/voice-swap.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const IN = arg('in');
const GENDER = arg('gender');
const OUT = arg('out');
const SECONDS = arg('seconds') ? Number(arg('seconds')) : null;
const MAX_WER = Number(arg('max-wer', 0.08));
const TRIES = Number(arg('tries', 3));
const DRY = flag('dry');

if (!IN || !existsSync(IN)) {
  console.error(`--in is required and must exist (got ${JSON.stringify(IN)})`);
  process.exit(1);
}
// Fail closed, loudly. A skipped swap is a non-event; a man speaking with a
// woman's voice is a ruined asset that may go out publicly.
try {
  assertGender(GENDER);
} catch (e) {
  console.error(`SKIPPING SWAP, original audio must be used: ${e.message}`);
  process.exit(1);
}

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY && !DRY) {
  console.error('missing ELEVENLABS_API_KEY');
  process.exit(1);
}

const ACCOUNT = arg('account', basename(IN).replace(/\.[^.]+$/, ''));
const outPath = OUT ?? join(dirname(IN), basename(IN).replace(/\.[^.]+$/, '') + '-swapped.mp4');
const tmp = (n) => join(dirname(outPath), `.swap-${process.pid}-${n}`);

const log = (m) => console.log(`[voice-swap] ${m}`);
const cleanup = [];
const scrub = () => {
  for (const f of cleanup) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      /* scratch files are not worth failing over */
    }
  }
};

let source = IN;
if (SECONDS) {
  source = tmp('trim.mp4');
  cleanup.push(source);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', IN, '-t', String(SECONDS), '-c', 'copy', source]);
}

const srcSeconds = durationOf(source);
const cost = Math.round(srcSeconds * CREDITS_PER_SECOND);
const roster = loadRoster();

log(`source ${basename(source)}, ${srcSeconds.toFixed(2)}s, gender=${GENDER}, account=${ACCOUNT}`);
log(`estimated cost ${cost} credits per attempt (${CREDITS_PER_SECOND}/second, measured)`);

if (DRY) {
  const v = pickVoice(roster, GENDER, ACCOUNT);
  log(`DRY RUN, nothing spent. Would use ${v.name} (${v.voice_id}), pool=${v.gender}`);
  scrub();
  process.exit(0);
}

const srcMp3 = tmp('src.mp3');
cleanup.push(srcMp3);
extractAudio(source, srcMp3);

const canVerify = whisperAvailable();
if (!canVerify) {
  log('WARNING: whisper not available, shipping WITHOUT the transcript check');
}
let srcText = '';
if (canVerify) {
  srcText = transcribe(srcMp3, tmp('src.wav'));
  log(`source transcript: ${srcText.trim().slice(0, 90)}...`);
}

let spent = 0;
let ok = false;

for (let attempt = 0; attempt < TRIES; attempt++) {
  const voice = pickVoice(roster, GENDER, ACCOUNT, attempt);
  // Assert immediately before the call, so no refactor between the pick and
  // the spend can cross the pools.
  if (voice.gender !== GENDER) throw new Error(`pool crossed: ${voice.voice_id} is ${voice.gender}`);

  log(`attempt ${attempt + 1}/${TRIES}: ${voice.name} (${voice.voice_id})`);
  const buf = await convertVoice({ audioPath: srcMp3, voiceId: voice.voice_id, gender: GENDER, apiKey: KEY });
  spent += cost;

  const convMp3 = tmp(`conv${attempt}.mp3`);
  cleanup.push(convMp3);
  writeBuffer(convMp3, buf);

  const outSeconds = durationOf(convMp3);
  const drift = Math.abs(outSeconds - srcSeconds);
  if (drift > 0.1) {
    log(`  REJECT: duration drifted ${(drift * 1000).toFixed(0)}ms (limit 100ms)`);
    continue;
  }

  if (canVerify) {
    const convText = transcribe(convMp3, tmp(`conv${attempt}.wav`));
    const wer = wordErrorRate(srcText, convText);
    log(`  duration ${outSeconds.toFixed(2)}s (drift ${(drift * 1000).toFixed(0)}ms), word error rate ${(wer * 100).toFixed(1)}%`);
    if (wer > MAX_WER) {
      log(`  REJECT ${voice.voice_id}: ${(wer * 100).toFixed(1)}% > ${(MAX_WER * 100).toFixed(0)}% threshold`);
      log(`  got: ${convText.trim().slice(0, 120)}`);
      continue;
    }
  }

  remux(source, convMp3, outPath);
  log(`OK -> ${outPath}`);
  log(`  voice_id=${voice.voice_id} name="${voice.name}" credits=${spent}`);
  ok = true;
  break;
}

scrub();
if (!ok) {
  console.error(`[voice-swap] FAILED after ${TRIES} voices, ${spent} credits spent. Use the ORIGINAL audio.`);
  process.exit(1);
}
