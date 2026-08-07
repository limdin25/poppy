# The short-form variation factory

Turns any vertical clip into any number of distinct posts: the clip playing full
screen with nothing on it, shrinking into a phone mockup at a natural point
around the middle, one line of text above it telling the viewer to watch to the
end, and a ten second end card that reveals it was AI.

Everything is derived from a seed, so a render is reproducible and any specific
bad variant can be regenerated on its own and fixed.

---

## One command

Run everything from `/Users/hugo/Whats/Poppy/video`.

```bash
node scripts/factory.mjs --count=4
```

That is the whole operating procedure.

1. Drop clips into `video/sources-in/`. Any `.mp4`, `.mov`, `.m4v`, `.webm`,
   `.mkv` or `.avi`. Not vertical? It gets centre-cropped to vertical. Wrong
   frame rate, wrong sample rate, mono, no audio at all? All handled.
2. Run the line above.
3. Files land in `video/out/variants/<batch>/`.

`--count` is **per clip**, so four clips at `--count=4` is 16 files and
`--count=250` is a thousand. Nothing is uploaded anywhere.

If `sources-in/` is empty it falls back to the four HeyPubli landing page demos,
which is what the factory was built on.

### Useful variations

```bash
# Name the batch, so two runs do not land in the same folder
node scripts/factory.mjs --count=250 --batch=b003

# Reproduce one specific variant, because it looked wrong
node scripts/render-variants.mjs --only=v2-0047 --batch=fix

# Look at two dozen at once before committing to a big batch
node scripts/contact-sheet.mjs --count=6

# Re-encode the clips from scratch, for instance after replacing one
node scripts/factory.mjs --count=4 --force
```

Everything is resumable. A job whose output already exists is skipped, so a
Ctrl-C or a crash costs only the file that was in flight. Nothing is ever
overwritten.

---

## The shape of every video

1. **The clip fills the screen and nothing is on it.** No text, no plate, no
   branding. It just plays.
2. **Somewhere in the middle, it shrinks into a phone.** The generated background
   is revealed around it and the device closes in.
3. **From that moment one line of text appears** above the phone and stays
   there. It only ever tells the viewer to watch to the end.
4. **A ten second end card**, and this is the only place the video says what it
   is: "That was 100% AI", then the offer, then LINK IN BIO.

**The reveal is the whole design.** The viewer does not learn they are watching
AI until the end card tells them. Told up front it is a novelty; told at the end
it is a demonstration. Every retention line exists to get somebody to that
sentence, which is why not one of them may mention AI, generation, filming or
cameras, and why nothing hints the clip is not real. A test fails the build if
one does.

**One hook, held.** Not a rotation. About 60% of videos show a single line for
the whole back half and the rest swap once at their own midpoint; two is the
hard ceiling. An earlier version rotated up to eight lines on a 2 to 3.5 second
timer and it was worse for a reason worth keeping: there is only one message
here, and saying it eight different ways dilutes it rather than reinforcing it.
Text that changes every few seconds also competes with the clip for the very
attention it is supposed to be holding. A line that simply sits there is a
promise, and once it has been read it becomes furniture, which is what you want.

### What the line may and may not say

Three ways a retention line fails, all of which the first bank managed at once:

- **It treats the video as a chore.** "Stick with it" is what you say to somebody
  struggling through something difficult. It concedes the clip is boring before
  the viewer has decided that themselves.
- **It promises a visual payoff that never comes.** "Wait for it" has a precise
  meaning: something is about to visibly happen. Nothing does. Somebody who waits
  for it and gets a call to action feels tricked, which is worse than never
  promising anything. Same fault in "The best bit is last".
- **It answers a question nobody asked.** "The answer is at the end" implies one
  was posed.

What survives works because of the edit itself: the moment the picture drops into
a phone, the viewer genuinely has a question, which is *why is this in a phone
now*. So every line either says plainly to watch to the end, or says the end
explains it. Both are true and neither over-promises.

### The drop is timed to the clip, not to a stopwatch

The shrink lands anywhere in **40 to 60% of the clip's length**. It is the
structural midpoint of the video, so it belongs at the middle of whatever the
clip actually is, not at a fixed number of seconds. A 30 second clip breaks at
12 to 18 seconds, a 60 second clip at 24 to 36.

Every clip is analysed once at ingest for where a cut would feel natural: scene
changes in the picture, and the starts and ends of spoken phrases in the sound.
Those frame numbers are stored in `sources.json`. Each variant picks a seeded
target inside its window and snaps to the nearest of that clip's real beats if
one is within 1.5 seconds, plus up to 3 frames of jitter either side. A clip with
no detectable rhythm simply lands on its target, which is why an empty beat list
is not a failure.

**The rhythm is worked out once per clip and cached, not per render.** Variant
900 of a clip reuses exactly what variant 1 established. That is the difference
between analysing four clips and analysing four thousand times, and it is why
ingest and render are separate scripts behind one front door.

The 3 frames of jitter exist because of a real failure: v3 is a long continuous
shot with music under it, so only ten beats were detected and only two of those
fall in the target window. Every variant snapped to the same one. A thousand
files all cutting at frame 280 is exactly the template signature the whole system
is meant to avoid.

---

## Why they do not cluster

The risk is not one file matching one file. It is a hundred accounts posting
work that is visibly from one template, which gets read as a network.

### The metadata question, answered plainly

Metadata is the part everyone worries about and it is the part that matters
least. Every output is a fresh encode out of a headless browser: there is no
inherited camera data, no editing software tag, no creation history, because
nothing was copied. The only tag written is a `comment` holding the seed, which
is there so a bad file can be traced back to the plan that made it.

More to the point, **the platforms strip container metadata and re-encode on
upload**. Nothing written in an MP4 header survives to the version anyone
watches. Deduplication is done on the decoded picture and the decoded sound.
Scrubbing metadata is not the defence; it is theatre.

### What actually varies, per file

| | how many | costs quality? |
|---|---|---|
| Palette family | 13 | no |
| Background archetype | 7 | no |
| Typeface | 10 | no |
| Type size | continuous, 0.86 to 1.00 of the cap | no |
| Accent harmony | 3 | no |
| Hook copy | 16 retention lines | no |
| End card reveal x offer | 10 x 8 = 80 | no |
| End card layout and position | 3 x 9 | no |
| Where the shrink lands | the clip's beats, plus jitter | no |
| How long the shrink takes | 12 to 30 frames | no |
| How the shrink accelerates | 3 curves | no |
| Mirrored or not | 2, and **off unless a clip is cleared** | no, it is a reflection |
| Zoom into the clip | 5 steps, 1.000 to 1.045 | no, the screen is 676 so it still downsamples |
| Pan inside that zoom | continuous | no, it is a crop |
| Head trim | 0 to 12 frames | no, it is a cut |
| Opening zoom and crop | continuous, always unique | no, the opening is resampled anyway |
| Opening grade | continuous, within 1.5% | negligible, and it decays to nothing |
| Ambient bed | 20 beds x start point x gain | no, it is 50dB down |

The two doing the heavy lifting against picture matching are the **mirror** and
the **zoom**, because they move every pixel in the frame. Repainting the
background leaves the middle 44 percent of the canvas identical, and the middle
is the part a matcher looks at.

- **Mirroring is free**, and it is **off by default**. It is a reflection, so not
  one pixel value changes, only its position, which defeats pixel comparison and
  most perceptual hashing outright. But it only works on a clip with nothing
  readable in it, and checking the four demos settled the default the safe way:
  **three of the four cannot be mirrored.** One holds a bottle reading "Lymphatic
  drainage", one a branded sachet, one carries burned-in captions. A backwards
  product label on a video whose whole pitch is that AI footage looks real does
  more damage than clustering ever would.

  So `allowFlip` defaults to `false` and somebody turns it on per clip after
  watching that clip through. `ingest-sources.mjs` carries the decision forward
  every time it rebuilds the manifest. **This is worth knowing when you judge the
  list above: on most real product footage the strongest lever is unavailable**,
  which is one more reason the answer is more source clips rather than more
  variants of one.
- **The zoom is capped by measurement, not by feel.** At 1.045 the phone screen
  shows 689 of the source's 720 columns across 720 output columns: a 4.5 percent
  upsample, below what crf 18 quantisation removes anyway. It is quantised to
  five steps and **the bottom step is exactly 1.000**, so roughly a fifth of
  variants are still a perfect one to one pixel map.

### The opening is handled separately, and it had a real hole

The resting zoom is quantised to five steps with 1.000 among them, so about a
fifth of files rest pixel-exact. That is deliberate and it is correct for the
phone act. It was **wrong for the opening**, and it left a hole worth writing
down because it is the kind that survives every automated check:

> During the opening the clip covers the whole canvas, so the generated
> background is not visible at all. For a variant resting at zoom 1.000 with no
> mirror, frame one was therefore **pixel-identical** to every other such variant
> of that clip, differing only in the hook text. And the hook does not fade in
> until frame 4 to 10, so the first few frames had nothing distinguishing them
> whatsoever.

The fix uses a fact that only applies to the opening: **it is already being
resampled.** Filling 1080x1920 from a 720x1280 clip is a 1.5x upscale no matter
what, so geometric jitter there is genuinely free, where in the phone act it
would not be.

So the opening gets its own **continuous** zoom and crop, never quantised, always
at least 1.2 percent away from where the clip ends up, and it **drifts to meet
the resting position exactly as the shrink finishes**. Three things fall out:

- frame one is geometrically unique per file, always, with no exceptions;
- the handover from the upscaled twin to the untouched 720 file stays invisible,
  because the drift lands exactly on the resting transform;
- what a viewer sees is a slow push over nine seconds, which reads as camera
  movement. It is a technique, not a defect, and if anything it improves the
  opening.

A per-file **grade** (contrast, saturation, brightness, each within 1.5 percent
and brightness held to half that) rides along the opening and decays to nothing
across the shrink, so the phone act carries no colour filter at all.

**The grade is the weakest of the three levers and that should be said plainly.**
Perceptual hashing takes a DCT of the luminance and thresholds it at its own
median, which makes it invariant to exactly this kind of global level shift by
design. It changes colour histograms and it changes every encoded byte, so it is
not nothing, but the geometry is what does the work. It is capped low rather than
turned up because turning it up would cost real fidelity for very little.

### The type changes size, and the range only goes down

Every variant draws its hook and its end card at a cap height scaled by
`TYPE_SCALE_MIN..MAX`, currently 0.86 to 1.00. Real spread across the four demos:
cap 48 to 54, which is a drawn size of 56px to 87px depending on the face. It is
the only lever in the set that changes the SIZE of anything, which makes it one
of the few visible at thumbnail scale, where most of these are actually seen.

**One scale drives both the hook and the end card, on purpose.** Independent
scales would eventually pair a large hook with a small end card, which reads as a
mistake rather than as a choice. Moving them together reads as a deliberate
typographic decision, which is the only reason to vary it at all.

**It scales down only, and 54 is a ceiling rather than a midpoint.** Both the
two-line guarantee and the 190px hook box were derived AT 54 with 8px of slack,
so anything above it overflows into the phone. Down is provably safe in both
directions that matter: smaller type fits more characters per line, so line count
can only fall, and a shorter block always fits a box measured for a taller one.

The floor is 0.86 rather than lower because `TextBlock` clamps UP to each face's
`minSize`. A face whose derived size falls under its own floor **stops varying
entirely while every other test still passes**, so the feature would look
implemented and quietly do nothing on that face. There is a test for exactly
that, and it is the one to read before widening the range.

### Every video carries an ambient bed, and it is generated, not downloaded

A hard rule: every single video gets a unique low level background layer, around
50dB under the voice, which is beneath the noise floor of the source recordings
themselves. Different bed, different start point within it, different gain, on
every file. It runs under the end card too, which also fixes something nobody
asked about: the cut from a talking clip into ten seconds of digital silence was
abrupt, and a bed carrying through makes the end card feel like part of the same
video.

**The beds are generated by ffmpeg, not taken from a sound library, and that is
the important decision.** A royalty-free library (Freesound, Pixabay, an
ElevenLabs sound-effects call) gives a **fixed set** of recordings. A thousand
videos over twenty downloaded loops means fifty videos each carrying a
byte-for-byte identical, trivially fingerprintable audio signature that appears
in no other account's content. That is not camouflage, it is a tracking beacon,
and it would be a **stronger** cluster signal than the one it was added to hide.

Generated noise has no fixed set: every bed is a different realisation of a
random process, so no two share a sample. It is also free, offline, instant,
carries no licence or attribution obligation, and works on a VPS with no network.
There is nothing a library does better for this job.

Brown noise for the deep end, a quiet band-limited pink layer for air,
decorrelated across the two channels so it reads as space rather than as hiss in
the middle of your head, with a very slow amplitude drift so it is not perfectly
stationary. `scripts/make-ambience.mjs`, run automatically by `factory.mjs`.

(If real recorded room tone is ever wanted for its own sake rather than for
camouflage, **Pixabay's audio API** is the one to use: permissive licence, no
attribution required, free. But that is a creative choice, not this one.)

### Two things this does not fix, and you should know both

**The audio is still the weak side, even with the ambient bed.** Every video now
carries a unique low level background layer (see below), which changes every
sample and every encoded byte. It does **not** defeat audio fingerprinting, and
this needs saying plainly because it is easy to assume otherwise: landmark
fingerprinting hashes the positions of spectral **peaks** relative to each other,
and was designed from the outset to survive a phone microphone in a loud bar. A
bed 50dB under the voice is orders of magnitude less interference than the case
it was built for. The head trim shifts the audio by up to 0.4 seconds, which
defeats naive alignment and nothing more.

**The lever that would actually move an audio fingerprint is a 1 to 3 percent
tempo offset**, because that shifts the peaks themselves in both time and
frequency, and broadcasters have used exactly that for decades without anyone
noticing. It is not built, because it cannot be a render setting: applied to the
audio alone it drifts out of lip sync within a minute, so it has to be applied to
the whole clip at ingest, producing two or three speed variants of each source.
That is a decision about the footage, not about the render.

**And the plainest fix remains more source clips, not more processing.** Ten
clips at 100 variants is a far safer shape than one clip at 1000.

**The same clip is the same clip.** No framing, mirroring or recolouring makes
the footage inside the phone into different footage. What this system does is
make each *post* a distinct creative. It does not, and cannot, make one clip look
like ten.

**And the signal nobody can fix in code**: posting behaviour. Same accounts, same
times, same bio link, same follower graph. That clusters harder than any pixel.

---

## Quality decisions worth knowing

**The clip is never upscaled to fill the phone.** The phone screen is exactly
720x1280, which is exactly the size of the encoded source, so at zoom 1.000 they
map one pixel to one pixel with no interpolation at all.

**The full-bleed opening is upscaled once, not every frame.** Filling a 1080x1920
canvas needs 1080x1920 pixels and the demos are 720x1280, so that segment is a
1.5x upscale. There is no way around that short of higher resolution sources. So
ingest builds a 1080x1920 twin of every clip with lanczos at crf 14, and the
composition swaps to the untouched 720 file the instant the shrink finishes,
where both are drawing the same content at the same size. Doing it the lazy way,
one 1080 file scaled down for the whole video, would put the phone segment
through an upscale and a downscale for nothing, and the phone segment is most of
the video.

**If you want the opening sharper, the answer is a 1080p source.** Everything
downstream already handles it.

**Text can never be unreadable.** Every combination is contrast-checked in the
test suite against the actual composited background, using APCA rather than WCAG,
because WCAG lets large text pass at a level that washes out on a phone in
daylight. Over the full-bleed opening, where no gate can say anything about video
pixels, the hook sits on an opaque plate in a colour the gate has already
measured.

**Grain is always on.** A big smooth gradient bands visibly under h264, and
banding is the clearest sign of a cheap render.

**No contrast or saturation filter.** It was considered and is deliberately off.
It is the one step that costs fidelity while adding nothing the mirror, the zoom
and the regenerated background do not already provide.

---

## How many genuinely different videos

**512 distinct looks**, counted rather than guessed: sum over the 13 families of
(admissible typefaces x admissible archetypes), which is 512 because a family
accepts 4 to 8 faces and 6 or 7 archetypes, not all 10 and all 7. Count the
accent harmony too and it is **1,164**. About 40,000 once you count the end card,
which is 10 reveals against 8 offers against 3 layouts. On top of that every video
carries one line from a bank of 16, so sixteen videos of a clip go by before a
line comes round again.

To recount after any bank edit, the arithmetic is in the family table in
`palettes.ts` (`temperaments`, `harmonies`) crossed with `admissibleFonts()` and
the archetype `modes`. Do not quote a number from memory, it moves.

**Colour jitter and type scale contribute nothing to that count, and they are
there for different reasons.** Jitter exists so four variants of one clip do not
look copy-pasted side by side. The type scale is the one size-varying lever, so
unlike jitter it IS visible at thumbnail scale, but it varies within a look
rather than creating a new one. If somebody asks for more variety, the only lever
that moves the count is **more palette families**, at roughly 40 looks each.
Widening the jitter just produces mud.

Within one clip, nothing repeats for the first 13 variants, because that is how
many palette families there are.

---

## Cost and speed

There is **no per-video cost**. No API, no service, no per-file fee. It renders
on hardware already paid for, so a thousand videos costs a thousand videos' worth
of machine time and well under a pound of electricity.

**Measured, not estimated.** Two real batches on Hugo's Mac (M4 Pro, concurrency
8): b001 was 16 files in 26 minutes, b002 was 4 files in 5 minutes 52 seconds.
That is **88 to 97 seconds per variant**, or about 17 frames of finished video
per second. Call it **90 seconds**.

| batch | Mac | VPS (2 to 3x slower) |
|---|---|---|
| 16 | 25 min | ~1 h |
| 100 | 2.5 h | 5 to 7 h |
| 1000 | **25 h** | 50 to 75 h, not practical |

So a thousand files is a day and a bit on the Mac, running unattended. Resumable,
so it can be stopped and restarted around whatever else the machine is doing.
Storage is about 17MB per file, so 1000 files is roughly 17GB.

An earlier version of this file said 45 seconds. That was wrong: it was a guess
extrapolated from the VSL pipeline rather than a measurement, and the real
figure is twice it. Length dominates, so a batch of 30 second clips is quicker
than these four, which average 49 seconds each.

A documented faster route exists (render the background, frame and hook once as
still images and let ffmpeg do the video work) that would cut this by roughly
four times, to around **6 hours per thousand**, and slightly improve quality,
since the video pixels would skip a round of re-encoding. It is not built. The
components are already split into the four separate pieces it needs, so it is an
addition rather than a rewrite. **This is the single highest-value thing left to
build here**, and it is what makes a thousand a routine overnight job rather
than a full day of the machine.

---

## If something looks wrong

Every output has a matching `.json` next to it and the seed baked into the file's
own metadata, so any file is traceable even if it gets renamed:

```bash
ffprobe -v error -show_entries format_tags=comment -of default=nw=1 out/variants/b002/v2-0003-*.mp4
```

To regenerate exactly that one file, take the name and run
`--only=v2-0003 --batch=fix`.

**Do not edit `remotion.config.ts`.** It is shared with the VSL render pipeline,
which is customer-facing and runs against a 25 minute timeout. Every quality
setting this factory needs is passed per render instead.

**`RECIPE_VERSION` is currently 6.** Anything rendered at 1 to 5 is an orphan, so
re-rendering those addresses gives different videos. Delete them rather than
mixing generations.

**`RECIPE_VERSION` in `src/variants/recipe.ts` is a throw-away-the-batch switch.**
It is folded into every seed, so bumping it deliberately makes every previously
rendered file unreproducible. That is correct when the recipe changes, and
expensive otherwise. `render-variants.mjs` holds the same number and a test fails
if the two drift.

---

## Checks

```bash
npx vitest run video/src/variants     # from the repo root
cd video && npx tsc --noEmit
```

143 tests. They sweep every palette, archetype, font and seed combination the
system can emit and assert it is readable, in gamut, not muddy, lands on a beat,
never pans past its own edge, and does not repeat. They run in node in about two
seconds with no browser.

The batch renderer additionally checks every finished file: exact frame count
(which is what proves the per-variant data actually reached the render), correct
resolution and pixel format, one AAC track at 48kHz stereo, body audio present,
end card silent. Then it hashes a frame from every file in the batch and refuses
to report success if any two are identical.

Neither of those replaces looking at a contact sheet.
