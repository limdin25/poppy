# Phase 3 — Compiled Spec (v3, photographic)

Implementation source of truth. The CSS ships inside
`src/core/site-demo/render.ts` as one inline `<style>` block, because the page
is standalone HTML with no build step.

## External Library Decision

**No external libraries and no third-party hosts.** No CDN, no webfont, no icon
package, no animation library. Motion is CSS only, icons are inline SVG.

**Photographs are the one addition in v3, and they are first-party.** Pexels
files are downloaded, cropped, duotoned and compressed at build time by
`scripts/build-site-photos.mjs`, then committed to `public/site/` and served
from our own origin as **relative URLs**. The self-contained rule is intact:
still no third-party host, no privacy leak, no CDN round trip.

## Photography pipeline

`scripts/build-site-photos.mjs`, run by hand when the set changes.

1. Download from `images.pexels.com` at 1600w.
2. Crop to role aspect: hero 4:5 portrait-ish for phones (1400x1750), work
   3:4 (1200x1600), outcome 3:2 (1400x933).
3. `.greyscale()` then `.tint({ brand blue })` — sharp's tint preserves
   luminance and replaces chroma, which is a true duotone.
4. `.linear(1.06, -8)` for a small contrast lift, so the duotone does not go
   flat in the midtones.
5. `.webp({ quality: 72 })`. Budget: **under 110KB per image**, checked by the
   script, which fails loudly rather than shipping a 400KB hero.

Output: `public/site/{profileKey}-{role}.webp`.

## Tokens

```
--paper #FFFFFF     --soft #F4F7FB      --line #E4EAF2
--ink   #0B1B2D     --muted #58687C
--blue  #1D4E89 (from content.colours.blue, per-trade override possible)
--deep  #12304F     --duo-base #0E2E52  (the duotone shadow, matches the files)
--accent per trade (content.colours.accent)
```

Type: system stack. Title `clamp(2.6rem, 9vw, 5.2rem)`, weight 800, tracking
`-.035em`. Body one size, `1.0625rem`.

## Section specs

### Beat 1 — Hero. Full-bleed photograph, title low-left
- `min-height: 92svh` on phones, `88vh` from 760px.
- Photograph as a `<img>` positioned `absolute; inset:0; object-fit:cover`, not
  a CSS background: it must be in the DOM so it can carry `alt` text, be
  `fetchpriority="high"` and be `decoding="async"`.
- Scrim: `linear-gradient(to top, rgba(9,26,45,.92) 0%, rgba(9,26,45,.55) 42%, rgba(9,26,45,.18) 100%)`.
  One directional source, deep falloff. This is the film reference, and it is
  also what makes white type legible over an unknown photograph.
- Content anchored bottom-left: rating row, business name, one line, call
  button, then a thin rule.
- **Entrance (Custom, from the film's slow reveal):** the scrim wipes from
  `opacity .4` to `1` while the title translates up 18px. Load only.
- Fallback: if there is no photograph for the trade, the `<img>` is omitted and
  the section keeps `--duo-base` as a solid plane. Nothing else changes.

### Beat 2 — Territory. Solid blue rest, no photograph
- Solid `--blue`, `padding: var(--s6) 0`, one line of type at
  `clamp(1.4rem, 3.6vw, 2.1rem)`, max 22ch, left aligned, plus a small pin icon.
- **Entrance: none, intentional.** The rest beat must not perform.
- Deliberately image-free: see the storyboard. A generic town photograph
  captioned with his town is a quiet lie.

### Beat 3 — Inventory. Editorial list beside a tall photograph
- Two columns from 900px: photograph left at `4/5`, list right. Single column
  below, photograph first at `16/11`.
- Services are `<li>` rows: index number in `--muted` tabular, then the name,
  then a hairline. **Not cards.** No borders except the hairline, no radius, no
  shadow.
- Blue slab overlapping the photograph's bottom-left corner carrying the
  availability line. `position:absolute; left:0; bottom:24px; padding:18px 22px`.
  This is the signature composition, instance one.
- **Entrance (Custom):** photograph scales `1.06 -> 1` over its own scroll
  range; list items stagger `opacity + translateY(10px)` at 55ms intervals.

### Beat 4 — Proof. White slab over the outcome photograph
- Only renders when `content.proof` exists. Google-sourced only, unchanged rule.
- Full-bleed photograph at `21/9` on desktop, `4/3` on phones.
- White slab overlapping **top-right** (the mirror of beat 3), carrying stars,
  the score at `clamp(3rem, 8vw, 4.2rem)` and the review count.
- **Entrance:** slab translates in from the right, 24px, over the still image.
  The only lateral move on the page.
- If the trade has no outcome photograph, the slab sits on `--soft` instead and
  the section keeps its shape.

### Beat 5 — Reckoning. Deep blue close
- Solid `--deep`, centred, the phone number set as the largest type on the page
  (`clamp(2.2rem, 8vw, 3.6rem)`, tabular, `tel:` link), the area line under it,
  then the checkout button.
- **Entrance:** single-step scale `.97 -> 1` with opacity.

### Chrome
- **Header:** transparent over the hero, `background:#fff` + hairline once
  `scrollY > 40`. Mark, business name, and the number as a text link from 620px.
- **Fixed call bar** below 620px, unchanged from v2 (it works).
- **Chat launcher** hides whenever a `.btn-call` or `.getstarted` is on screen.
  Kept from v2 verbatim: it was a real bug, twice.

## Motion rules

- Every start state lives behind `.js`, applied by script. A dropped script must
  never hand a lead a blank page. Non-negotiable, this is a paying sales asset.
- **Nothing clips an element the IntersectionObserver is watching.** Chromium
  counts an element's own `clip-path` when deciding intersection; v1 shipped an
  invisible band for exactly this reason. Reveals are opacity, transform and
  scale only.
- `prefers-reduced-motion: reduce` forces every start state to its end state.

## Phase 3 checklist

- [x] Signature composition locked before shared primitives
- [x] 5 distinct entrance types, one intentional `none`
- [x] `opacity + translateY` used twice (beats 3, 5)
- [x] 1 heavy interaction (beat 3 scroll-linked scale)
- [x] 2 attention-seeking reveals (beats 1, 4)
- [x] No section survives being reduced to a card grid unchanged
- [x] No process language in the rendered UI
- [x] Image failure and missing-photograph paths both specified
