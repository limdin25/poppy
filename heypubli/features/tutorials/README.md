# tutorials

The data behind seven Seedance 2.5 classes. Listed for admins at
`/admin/tutorials`, and used to GENERATE the Skool lessons.

## THE PUBLIC PAGES ARE GONE

`heypubli.com/v0` to `/v6` used to render a class each. They were deleted on
2026-08-05 and the route with them, because they were **completely ungated**:
anyone with the URL got the full prompt, the script and the steps, free, while
members were paying for the same thing. One shared link undercut the community.

Everything a student reads now lives in the Skool lesson itself, behind the
paywall. This feature keeps the data, because that data is what the lessons are
generated from, and keeps the admin table that lists it.

`TutorialPage.tsx` and `tests/e2e/tutorials.spec.ts` went with the route.

## Public exports

| Export | What it does |
| --- | --- |
| `TutorialIndex` | The admin shortcut table. Copies the Skool post text per class. |
| `TUTORIALS` | The seven classes, in order. |
| `TUTORIAL_SLUGS` | `["v0" ... "v6"]`. The slugs outlived the routes and are still the id for a class. |
| `getTutorial(slug)` | One class or `undefined`. |

## Three things that are easy to get wrong

**The class order is not the file order.** Class 1 is the source file `v5.mp4`
and class 5 is `v4.mp4`. They are sequenced by difficulty so each class adds
exactly one new skill. `sourceFile` on every tutorial says which video to upload,
and the admin table shows it in its own column for that reason.

**The script is not a caption.** Seedance generates voice and picture together,
so the words drive the lip movement and the pace of the gestures. That is why
`script` is a required field, why it renders above the prompt, and why the
spoken text is also embedded inside the prompt's audio section.

**Anything over 30 seconds is two generations.** Seedance 2.5 caps at 30 seconds
per pass, so the longer classes carry a `twoPart` block holding the split script
and the instructions for the extend. The test suite enforces the relationship:
`generations` must match `seconds`, and `twoPart` must be present when and only
when `generations` is 2.

## skoolDescription is the CARD, not the lesson

It is marketing aimed at somebody deciding whether to open the class, so it
belongs on the course card. The lesson body itself is generated separately by
`generate.py` and is written for somebody already inside.

## Tests

`data.test.ts` covers the shape, the slug to class mapping, the two part
invariant, and the no long dash rule (these strings reach Skool posts and SMS).
That is all there is now: the page and its route tests were deleted with the
public pages.

---

# RUNBOOK: adding a new class, end to end

Hugo drops a finished video in `~/Downloads` and asks for a class. This is the
whole job. It takes about an hour, most of it waiting on image generation and
the video upload.

## 1. Work out what the video actually is

Do not take the brief's word for it. Probe and measure:

```bash
ffprobe -v error -show_entries format=duration \
  -show_entries stream=codec_type,width,height,r_frame_rate -of csv=p=0 ~/Downloads/vN.mp4

# shot count, which decides whether the class is really about its shot list
ffmpeg -y -i ~/Downloads/vN.mp4 -vf "select='gt(scene,0.25)',showinfo" -an -f null - 2>&1 \
  | grep -oE "pts_time:[0-9.]+"

# the spoken words, which are a required field
ffmpeg -v error -y -i ~/Downloads/vN.mp4 -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 64k a.mp3
curl -s https://api.openai.com/v1/audio/transcriptions -H "Authorization: Bearer $K" \
  -F "file=@a.mp3" -F "model=whisper-1" -F "response_format=verbose_json"
```

**`-v error` suppresses `showinfo`.** Use `-y` without `-v error` for the cut
detection or you will get an empty list and think there are no cuts.

The class is named for the ONE new skill it adds over the class before it. If
you cannot name that skill, it is not a new class.

## 2. Tests first, then the data

This project's rule, and it catches real things. Update `data.test.ts` for the
new count and slug list, run it, watch it fail, then write the entry in
`data.ts`. Existing invariants worth knowing:

- `prompt` must be over 600 chars and contain `@Image 1`
- `script` over 120 chars, unless the class sets `soundLed`, then 60
- `generations` must match `seconds` (over 30s means 2, and needs `twoPart`)
- `shots`, if set, must equal the number of `->` lines in the prompt
- no long dash, curly quote or ellipsis anywhere

Gate: `pnpm exec tsc --noEmit && pnpm exec vitest run features/tutorials`.

**If Hugo supplies the prompt, keep it.** The one edit worth making is adding
the `@Image 1` reference line if it is missing: his prompts often describe the
subject in words, which is fine for one clip and wrong for a course whose spine
is that the presenter is the same person every time. Tell him you added it.

## 3. Generate the lesson and write it into Skool

The lesson body is BUILT FROM `data.ts`, never typed twice. The scripts are in
`~/Downloads/class-covers-premium/`:

- `generate.py` turns one tutorial into the lesson HTML
- `lesson_build.py` opens the editor, writes it, saves it
- `port_all.py` does every class and screenshots each result

## 4. Deploy, only for the admin table

Nothing student facing ships from this repo any more, but the admin list at
`/admin/tutorials` reads the data, so a new class still wants a deploy.

```bash
pnpm build
TOKEN=$(grep -hoE "vcp_[A-Za-z0-9]+" \
  ~/.claude/projects/-Users-hugo-Whats-Poppy/memory/credentials_vercel.md | head -1)
npx vercel --prod --yes --token "$TOKEN"
```

The CLI prints a preview-looking URL on a different team name and offers to
"promote to production". **Ignore it and check the real domain**, it does go
live. Check `/`, `/login` and `/terms` still return 200.

## 5. The cover

House style is set: presenter far left, stacked ALL CAPS title, lines
alternating white and gold, near-black right side. Scripts are in
`~/Downloads/class-covers-premium/`.

1. Pull a square face crop from the video itself, so the card shows the person
   the student is about to watch. **Compute the square in PIXELS**, a non-square
   crop fed to a square resize silently removes a forehead or a chin. Avoid
   frames with burnt-in captions, they leak into the generation as gibberish.
2. Generate the scene on `gpt-image-2` via `POST /v1/images/edits` with the face
   as `image[]`, `size=1536x1024`, `quality=high`. About 110 seconds a call.
   soul_2 will NOT work: with a reference image it copies the composition and
   ignores the scene.
3. Render the type with `make-premium.mjs` at **2048x1055**. Skool's cover slot
   is 1460x752, which is wider than 16:9, so a 16:9 cover loses its type.

## 6. Skool

Community `skool.com/ai-influencer-flywheel-5612`, through Kimi WebBridge.
Working scripts: `skool.py`, `upload-covers.py`, `lesson6.py`.

1. **New course** on the classroom grid. Fields are a plain text input and a
   textarea; the button is `ADD`. It defaults to Private, which is correct,
   Hugo flips them himself.
2. The course opens with a `New page` lesson. **Click the pencil to open the
   editor**, it is the right-most `svg` in the lesson card, found by bounding
   box, not by text.
3. Title is `input[placeholder="Title"]`. Video goes into the file input whose
   `accept` is NOT `image/*`, via the DataTransfer recipe (CDP
   `setFileInputFiles` is refused, and page-to-localhost fetch is blocked).
   200KB base64 chunks; 2MB hangs the daemon.
4. Body via `execCommand('insertHTML')`. See the editor section below, there are
   two traps in it that both fail silently. **The video is NOT a child of the
   contenteditable**, so it survives replacing the text, and "kept 0 media" is
   expected. Do not wait for a `<video>` to appear inside the editor, it never
   will.
5. Cover: kebab on the card, **Edit course**, attach, then **the crop modal's
   SAVE first and the dialog's SAVE second**. Attaching opens a "Crop new cover
   photo" modal, so the page then has TWO buttons reading SAVE and a naive
   `.find()` clicks the wrong one, reports success, and changes nothing.
   Always confirm with a screenshot.

## The Skool lesson editor: what it does, and three silent traps

It is ProseMirror, and the toolbar is richer than it looks. Probed, not
assumed, every one of these survives `insertHTML` and renders properly:

`h1` `h2` `h3` `h4`, `strong`, `em`, `s`, `code`, `a[href]`, `hr`,
`blockquote`, `ul` `ol` `li`, `pre` (a real monospace code block).

`pre` is the one that matters most: a 45 line prompt in a code block keeps its
line breaks, reads as a distinct object, and is far easier to select than the
same text as paragraphs.

**TRAP 1: never touch the DOM directly. ProseMirror keeps its own document
model and only updates it from the events `execCommand` fires.** Removing the
old children with `node.remove()` looks equivalent to selecting and deleting.
It is not: ProseMirror never sees it, so on save it writes the model it still
believes in, which is empty. This silently wiped a finished 7,000 character
lesson and reported `saved`. Always: focus, select all with a Range,
`execCommand('delete')`, then `execCommand('insertHTML', ...)`.

**TRAP 2: `insertHTML` does not enable the SAVE button. `insertText` does.**
After inserting the body, SAVE sits `disabled` forever and the work cannot be
committed at all. Appending a single space with
`execCommand('insertText', false, ' ')` flips the dirty flag and SAVE goes
live. The stray space lands at the end of the last paragraph and is invisible.

**Push the HTML in chunks.** One large `evaluate` call is what hangs the
daemon hard enough to need `kimi-webbridge restart`, after which the extension
reconnects but the session has no tab until you navigate again. Assemble the
string in the page from ~6KB pieces and insert once.

**The page lazy-renders, and DOM reads through the bridge go stale.** After an
SPA navigation, `document.querySelectorAll('h3').length` returns 0 and
`document.body.innerText` returns ~160 characters while a SCREENSHOT of the same
moment shows the full lesson. Scrolling and polling does not fix it. **Verify
lessons with screenshots, not with element counts**, or you will "discover" six
failures that never happened.

**TRAP 3: the spacing. Use fewer blocks, not styled ones.** Skool puts a large
margin on every block, so a heading plus a line plus a six item list renders as
eight gaps and reads as confetti. Two fixes do not work: inline styles survive
`insertHTML` and even apply in the editor, but ProseMirror serialises to its own
schema on save and the style attribute is not in it, so it reloads broken; and
there is no class of ours in the saved document to hang a stylesheet on. What
works is structural: a whole section is ONE `<p>` with `<br>` between its lines,
and a list is lines with an emoji doing the bullet's job. `lesson_style.py` has
`section()`, `bullets()` and `para()` for exactly this. Never hand-write a `<ul>`
or a run of `<p>`.
