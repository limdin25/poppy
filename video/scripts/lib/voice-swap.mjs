// voice-swap.mjs: give every account's copy of a master its own voice.
//
// The picture is already varied per account (palette, type, motion, hooks). The
// AUDIO was not: every copy of a master carried the identical performance, which
// is a perfect fingerprint match and the loudest "one asset, many accounts"
// signal left in the pipeline.
//
// This is SPEECH TO SPEECH, not text to speech. The original audio goes up and
// the same performance comes back in a different voice, so the delivery and the
// lip sync both survive. Generating a fresh take from a script instead would
// desync the lips and throw the performance away. Measured 2026-08-08: a
// 30.037s source came back 30.047s, and the picture is never re-encoded.
//
// Provider is ElevenLabs. Fish Audio was evaluated and rejected: its voice
// changer is web-app only, needs a scraped browser session token, and costs 5x.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VIDEO_DIR = resolve(HERE, '..', '..');
const ROSTER_PATH = join(VIDEO_DIR, 'data', 'voice-roster.json');

export const GENDERS = ['female', 'male'];
const STS_MODEL = 'eleven_multilingual_sts_v2';
// The account tier cannot do pcm_44100; asking for it fails. Do not "upgrade".
const OUTPUT_FORMAT = 'mp3_44100_128';
// Measured 2026-08-08: 300 credits per 30 seconds of audio.
export const CREDITS_PER_SECOND = 10;

/** FNV-1a, the same hash the rest of the factory seeds from. */
export function hashOf(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function loadRoster() {
  if (!existsSync(ROSTER_PATH)) {
    throw new Error(`no voice roster at ${ROSTER_PATH}; run scripts/fetch-voice-roster.mjs`);
  }
  const r = JSON.parse(readFileSync(ROSTER_PATH, 'utf8'));
  for (const g of GENDERS) {
    if (!r.pools?.[g]?.length) throw new Error(`voice roster has no ${g} pool`);
  }
  return r;
}

/**
 * Pick a voice for an account, from the matching-gender pool ONLY.
 *
 * Pinned per account, not random per video: a real creator account sounds like
 * one person across all of its posts, and a voice that changes every video is
 * its own kind of tell. `offset` lets a rejected voice step to the next one
 * without losing that stability for everyone else.
 */
export function pickVoice(roster, gender, accountKey, offset = 0) {
  assertGender(gender);
  const pool = roster.pools[gender];
  const idx = (hashOf(`${gender}|${accountKey}`) + offset) % pool.length;
  const voice = pool[idx];
  // Belt and braces: a later refactor must not be able to cross the pools.
  if (voice.gender !== gender) {
    throw new Error(`roster corruption: ${voice.voice_id} is ${voice.gender}, wanted ${gender}`);
  }
  return voice;
}

/** Fail closed. Anything but the two allowed values is a skip, never a guess. */
export function assertGender(gender) {
  if (!GENDERS.includes(gender)) {
    throw new Error(
      `gender must be 'female' or 'male', got ${JSON.stringify(gender)}. ` +
        'Never infer it from the audio: pitch detection was built and tested and ' +
        'failed in BOTH directions on real samples.',
    );
  }
}

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'pipe' });
}

export function durationOf(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}

/** Pull a mono 44.1k mp3 out of a video, which is what speech-to-speech wants. */
export function extractAudio(videoPath, outMp3) {
  ff(['-i', videoPath, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', outMp3]);
  return outMp3;
}

/** Put the new audio back WITHOUT touching the picture. -c:v copy is the point. */
export function remux(videoPath, audioPath, outPath) {
  ff([
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outPath,
  ]);
  return outPath;
}

/** The swap itself. Returns the bytes of the converted mp3. */
export async function convertVoice({ audioPath, voiceId, gender, apiKey }) {
  assertGender(gender);
  if (!voiceId) throw new Error('convertVoice needs a voiceId');

  const form = new FormData();
  form.append('audio', new Blob([readFileSync(audioPath)], { type: 'audio/mpeg' }), 'source.mp3');
  form.append('model_id', STS_MODEL);
  form.append('remove_background_noise', 'false');
  form.append(
    'voice_settings',
    JSON.stringify({ stability: 0.5, similarity_boost: 0.85, style: 0.0, use_speaker_boost: true }),
  );

  const url = `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form });
  if (!res.ok) throw new Error(`speech-to-speech ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- verification ----------------------------------------------------------
// Individual words come out mushy sometimes, and it differs per voice on the
// SAME source: one voice turned "first paid monthly retainer" into "first ten",
// another turned "a set amount of money" into "a sad amount". Invisible unless
// you transcribe the result back and compare it.

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? `${process.env.HOME}/.whisper-models/ggml-small.en.bin`;
const WHISPER_BIN = process.env.WHISPER_BIN ?? 'whisper-cli';

export function whisperAvailable() {
  try {
    execFileSync('which', [WHISPER_BIN], { stdio: 'pipe' });
    return existsSync(WHISPER_MODEL);
  } catch {
    return false;
  }
}

export function transcribe(audioPath, tmpWav) {
  ff(['-i', audioPath, '-ar', '16000', '-ac', '1', tmpWav]);
  const out = execFileSync(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', tmpWav, '-nt', '--no-prints'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  try {
    unlinkSync(tmpWav);
  } catch {
    /* a leftover scratch wav is not worth failing a render over */
  }
  return out;
}

export function normaliseWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Word error rate against the source transcript, by Levenshtein over words. */
export function wordErrorRate(sourceText, convertedText) {
  const a = normaliseWords(sourceText);
  const b = normaliseWords(convertedText);
  if (!a.length) return b.length ? 1 : 0;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] / a.length;
}

export function fileMb(p) {
  return statSync(p).size / 1e6;
}

// ---- the free half: per-account pitch variation ----------------------------
// Speech-to-speech costs 10 credits a second, which at 2 masters a day across
// 100 accounts is 75x the monthly allowance. This costs nothing and runs on the
// render box with no API at all.
//
// It does NOT make each account a different person, only the paid swap does
// that. What it does is give every account its own spectral signature, which
// is what actually defeats "these 100 uploads are one file". Measured on a real
// clip, it is also GENTLER than the paid route: every shift tested transcribed
// back word perfect, including "first paid monthly retainer", which one
// ElevenLabs voice turned into "first Taze monthly retainer".
//
// 25 steps across roughly a semitone either way. Small enough that nobody hears
// processing, spread enough that 25 accounts all differ.
export const PITCH_STEPS = 25;
export const PITCH_SPAN = 0.06;

export function pitchFor(profileId) {
  const step = hashOf(`pitch|${profileId}`) % PITCH_STEPS;
  const ratio = 1 - PITCH_SPAN + (2 * PITCH_SPAN * step) / (PITCH_STEPS - 1);
  return Math.round(ratio * 1000) / 1000;
}

let rubberbandChecked = null;
export function hasRubberband() {
  if (rubberbandChecked !== null) return rubberbandChecked;
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    rubberbandChecked = /\brubberband\b/.test(out);
  } catch {
    rubberbandChecked = false;
  }
  return rubberbandChecked;
}

/**
 * Shift the pitch of a finished render in place. Returns a short status string.
 * Never throws: an unvaried video is worth shipping, a failed render is not.
 */
export function applyVoiceVariation(filePath, profileId) {
  if (!hasRubberband()) return 'skipped: ffmpeg has no rubberband filter';
  const ratio = pitchFor(profileId);
  const tmp = `${filePath}.pitch.mp4`;
  try {
    const before = durationOf(filePath);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', filePath,
      '-c:v', 'copy',
      '-filter:a', `rubberband=pitch=${ratio}:pitchq=quality`,
      '-c:a', 'aac', '-b:a', '192k',
      tmp,
    ]);
    const after = durationOf(tmp);
    // The filter must not have eaten or stretched the clip: past a tenth of a
    // second the picture no longer matches the sound.
    if (!Number.isFinite(after) || Math.abs(after - before) > 0.1) {
      throw new Error(`duration moved ${before.toFixed(2)}s to ${after.toFixed(2)}s`);
    }
    copyFileSync(tmp, filePath);
    return `pitch ${ratio}`;
  } catch (e) {
    return `skipped (${e.message}), original audio shipped`;
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* scratch file */
    }
  }
}

export function writeBuffer(p, buf) {
  writeFileSync(p, buf);
  return p;
}
