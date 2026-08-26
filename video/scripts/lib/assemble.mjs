// assemble.mjs: build one finished post out of three pieces.
//
//   [ ~4.7s blurred opening, three beats of text ]   unique, built per post
//   [ the account's body render                  ]   built once per master x account
//   [ one of 640 pre-rendered end cards          ]   picked per post
//
// The middle piece is 85% of the running time and the only expensive part, and
// it is never touched: it is concatenated with a STREAM COPY, not re-encoded.
// Only the two ends are encoded, and they are a few seconds of flat colour and
// blurred footage between them.
//
// Measured on an M-series Mac: 1.6 to 2.7 seconds per finished post, against 90
// to 160 seconds to re-render the whole thing in Remotion. That ratio is the
// only reason 3,700 posts a day is possible at all.
//
// PURE-ISH: takes paths in, writes a file out, throws on failure. No database,
// no network, no environment. The worker owns all of that.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Encoder settings shared by every piece. They MUST match across the pieces or
 *  the concat demuxer refuses to stream-copy and the whole saving is lost. */
const ENC = [
  '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
  '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
  '-x264-params', 'keyint=30:min-keyint=30',
  '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
  // The body renders carry a 90000 timescale. An intro written at ffmpeg's
  // default 15360 concatenates without complaint and then reports a duration
  // six times too long, which Instagram reads before it reads the frames.
  '-video_track_timescale', '90000',
];

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function probeDuration(path) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path,
  ], { encoding: 'utf8' });
  return Number(out.trim());
}

/**
 * The last keyframe at or before `before`. The body has to be cut somewhere the
 * stream can be copied from, and cutting anywhere else forces a re-encode of
 * everything after it.
 */
export function lastKeyframeBefore(path, before) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let best = 0;
  for (const line of out.split('\n')) {
    const [t, flags] = line.split(',');
    if (!flags || !flags.includes('K')) continue;
    const at = Number(t);
    if (Number.isFinite(at) && at <= before) best = at;
  }
  return best;
}

/**
 * The blurred opening. Three text plates over a window of stock or own footage,
 * blurred past recognition and drained of colour.
 *
 * Hugo, 26 Aug 2026: black and white only, text centred, and longer than three
 * seconds so the tension has room to build.
 */
export function buildIntro({ clip, at, plates, beats, blur, dim, out }) {
  if (plates.length !== 3) throw new Error('an opening is three beats');
  let t = 0.12;
  const marks = [];
  for (let i = 0; i < 3; i++) {
    marks.push({ start: t, end: t + beats[i] });
    t += beats[i] + 0.11;
  }
  const total = Number((t + 0.12).toFixed(2));

  const inputs = ['-ss', String(at), '-t', String(total), '-i', clip];
  for (const p of plates) inputs.push('-loop', '1', '-framerate', '30', '-t', String(total), '-i', p);
  inputs.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo');

  const fades = plates.map((_, i) => {
    const m = marks[i];
    return (
      `[${i + 1}:v]format=rgba,` +
      `fade=in:st=${m.start.toFixed(2)}:d=0.20:alpha=1,` +
      `fade=out:st=${m.end.toFixed(2)}:d=0.15:alpha=1[t${i}]`
    );
  });
  const overlays = [
    `[bg][t0]overlay=0:0:enable='between(t,${marks[0].start.toFixed(2)},${marks[1].start.toFixed(2)})'[s0]`,
    `[s0][t1]overlay=0:0:enable='between(t,${marks[1].start.toFixed(2)},${marks[2].start.toFixed(2)})'[s1]`,
    `[s1][t2]overlay=0:0:enable='between(t,${marks[2].start.toFixed(2)},${total})',format=yuv420p[v]`,
  ];
  const filter = [
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
      `gblur=sigma=${blur.toFixed(1)},eq=brightness=${(-dim).toFixed(3)}:saturation=0,` +
      `fps=30,setsar=1[bg]`,
    ...fades,
    ...overlays,
  ].join(';');

  // The silent track is the LAST input, after the clip and every plate. This
  // was hardcoded to 3 back when an opening was two beats, and the third beat
  // silently shifted it to 4. Derive it, so a fourth beat cannot break this
  // again.
  const audioInput = plates.length + 1;
  ff([...inputs, '-filter_complex', filter, '-map', '[v]', '-map', `${audioInput}:a`, ...ENC, out]);
  return total;
}

/** The end card, held for `seconds`. Jittered per post so two posts closing on
 *  the same card still do not close identically. */
export function buildOutro({ card, seconds, out }) {
  ff([
    '-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', card,
    '-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', '[0:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v]',
    '-map', '[v]', '-map', '1:a', ...ENC, out,
  ]);
}

/**
 * The body, with the render's own ten second end card cut off. That card is
 * replaced by one of the 640, so leaving it on would show the viewer two
 * endings back to back.
 *
 * Cut at a keyframe so this is a stream copy. It is the one operation that
 * touches the expensive footage and it must stay free.
 */
export function trimBody({ render, out, tailSeconds = 10 }) {
  const dur = probeDuration(render);
  const target = Math.max(1, dur - tailSeconds);
  const cut = lastKeyframeBefore(render, target);
  if (cut <= 0) throw new Error(`no keyframe before ${target}s in ${render}`);
  ff(['-t', String(cut), '-i', render, '-c', 'copy', out]);
  return cut;
}

/** Glue the three together without re-encoding any of them. */
export function concat({ parts, out, workDir }) {
  const list = join(workDir, 'concat.txt');
  execFileSync('/bin/sh', ['-c',
    `printf "%s\\n" ${parts.map((p) => `"file '${p}'"`).join(' ')} > ${JSON.stringify(list)}`]);
  ff(['-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', '-movflags', '+faststart', out]);
}

/**
 * Everything a finished post must be true of before it is allowed near
 * Instagram. A file that is subtly wrong costs an account's reputation, and the
 * checks are far cheaper than the post.
 */
export function verify(path, expectMin, expectMax) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const p = JSON.parse(raw);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const errs = [];
  if (!v) errs.push('no video stream');
  else {
    if (v.codec_name !== 'h264') errs.push(`codec ${v.codec_name}`);
    if (Number(v.width) !== 1080 || Number(v.height) !== 1920) errs.push(`${v.width}x${v.height}`);
  }
  if (!a) errs.push('no audio stream');
  const dur = Number(p.format?.duration);
  // The timescale bug produced a file whose frames were right and whose header
  // said 250 seconds. Instagram reads the header.
  if (!Number.isFinite(dur)) errs.push('no duration');
  else if (dur < expectMin || dur > expectMax) errs.push(`duration ${dur.toFixed(1)}s`);
  return errs;
}

/**
 * One finished post, start to finish.
 *
 * Everything lands in a scratch directory that is removed whether this succeeds
 * or throws. At 3,700 posts a day a leaked temp file per failure fills a disk
 * inside a week, and a full disk fails every account at once.
 */
export function assemblePost({ render, clip, at, plates, beats, blur, dim, card, cardSeconds, out }) {
  const work = mkdtempSync(join(tmpdir(), 'hp-post-'));
  try {
    if (!existsSync(render)) throw new Error(`body missing: ${render}`);
    if (!existsSync(clip)) throw new Error(`blur clip missing: ${clip}`);
    if (!existsSync(card)) throw new Error(`card missing: ${card}`);

    const intro = join(work, 'intro.mp4');
    const body = join(work, 'body.mp4');
    const outro = join(work, 'outro.mp4');

    const introSeconds = buildIntro({ clip, at, plates, beats, blur, dim, out: intro });
    const bodySeconds = trimBody({ render, out: body });
    buildOutro({ card, seconds: cardSeconds, out: outro });
    concat({ parts: [intro, body, outro], out, workDir: work });

    const expected = introSeconds + bodySeconds + cardSeconds;
    const errs = verify(out, expected - 2, expected + 2);
    if (errs.length) throw new Error(`assembled file failed verify: ${errs.join(', ')}`);
    return { seconds: expected, introSeconds, bodySeconds };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
