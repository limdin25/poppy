# Phase 3 — Compiled Spec

Implementation source of truth. The CSS itself ships inside `src/core/site-demo/render.ts` as one inline `<style>` block, because the page is standalone HTML with no build step and no external requests.

## External Library Decision

**No external libraries.** No CDN, no webfont, no icon package, no animation library. Enforced by the brief: the page must be self-contained, and every external host is a round trip on a phone on mobile data plus a privacy leak on a lead's page. Motion is CSS only. Glyphs are inline SVG paths.

## Library source ids

Every major move on this page is marked `Custom`. Each derives from a named Ozu technique rather than from a library entry, and the guardrails permit `Custom` when justified:

| Move | Status | Justification |
|---|---|---|
| Low eye-line tableau | `Custom` | Direct translation of Ozu's fixed low camera. No library entry encodes a vertical anchoring rule. |
| Pillow band | `Custom` | Direct translation of the pillow shot. The library's section archetypes are all content-bearing; the pillow band's defining property is that it carries almost nothing. |
| Plane wipe entrance | `Custom` | Reads as a cut rather than a fade, which is required because Ozu does not dissolve. |
| Doorway frame | `Custom` | Ozu frames through door and window openings. Implemented as an inset three-sided hairline. |

## Tokens

```
--paper:      #FBFBF9   page ground, warm paper white, not pure white
--plane:      #FFFFFF   raised planes
--mist:       #F1F4F8   the quiet alternate ground
--ink:        #10203A   near-black with blue in it, never #000
--ink-soft:   #46566E   secondary text
--rule:       #C9D4E2   hairline
--blue:       #1D4E89   the ink blue plane, late-Ozu flat blue
--blue-deep:  #14385F   pressed state
--accent:     #C2452D   the single saturated accent, one per frame (Ozu's red kettle)
```

`--accent` is per-trade and is the only token the trade map may override. Everything else is fixed so the brand stays coherent across every generated site.

Type: system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`). Display `clamp(3.2rem, 11vw, 6.5rem)`, tracking `-0.03em`, weight 800. Body `1.0625rem`, line height `1.65`, weight 400. Tabular figures on the phone number and the rating.

Spacing scale: 8, 16, 24, 40, 64, 96, 140. Tall tableaux use 96 and 140. Pillow bands use a fixed `min-height: 30vh`.

## Sections

### 1. Title tableau
Full viewport minus the call bar. Content anchored to the lower third via `justify-content: flex-end` with `padding-bottom: var(--s-140)`. Four visual elements beyond the text, satisfying the hero density rule: the doorway frame (inset hairline on left, right and bottom), the hairline rule above the name, the solid blue call slab, and a small line-drawn trade glyph set as a printer's mark in the upper left.

Entrance: hairline scales from `scaleX(0)` at `transform-origin: left`, 520ms, then the name settles from `translateY(12px)`. The only compound entrance on the page.

### 2, 4, 6. Pillow bands
Full bleed, `min-height: 30vh`, `background: var(--blue)`, text `var(--plane)`, centred both axes, one line of copy at `clamp(1.5rem, 4vw, 2.5rem)`, weight 600, tracking `-0.01em`. Nothing else may enter this band. Entrance: `clip-path: inset(100% 0 0 0)` to `inset(0 0 0 0)`, 620ms, so the plane wipes up as a cut.

Band C is the phone number itself, rendered as a `tel:` link, treated as the fact rather than as a button.

### 3. Service index
Not cards. A numbered index: two columns on desktop collapsing to one on mobile, each row a hairline-separated line with a two-digit ordinal in `--ink-soft` and the service name in `--ink`. No icons, no borders, no hover lift. Rows stagger 40ms with opacity plus 8px translate. This is the page's single permitted `fadeUp`.

### 5. Rating tableau — conditional
Renders **only** when `content.proof` is present, which the fill step sets only when `custom_fields.reviews_source === 'google'`. Otherwise the section, its pillow band spacing and its entrance are all omitted. Straight cut, no motion: stillness on the one section carrying proof. Shows the rating, the review count, and the word "Google", and claims nothing else.

### 7. Contact tableau
`--mist` ground. Phone, address if known, and the chat affordance. Hairline draw entrance echoing the opening.

### 8. Colophon
Small, quiet, `--ink-soft`. Business name, year, and the ownership line.

### Persistent call bar
Fixed to the bottom on viewports under 720px. `--blue` plane, full width, the phone number as a `tel:` link. The only shadow on the page: `0 -1px 0 rgba(16,32,58,.08), 0 -8px 24px rgba(16,32,58,.06)`. This is the page's one heavy interaction; it needs no JS beyond the chat toggle.

## Motion

All motion sits inside an `IntersectionObserver` that adds `.in` and inside:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
  .r, .pillow, .row { opacity: 1; transform: none; clip-path: none; }
}
```

Entrances must be idempotent and must never leave content invisible if the observer fails: every animated element starts at `opacity: 1` in the no-JS baseline, and only gets its start state when the script has confirmed it is running. A lead must never receive a blank page because a script did not execute.

## Accessibility

Contrast: `--ink` on `--paper` is about 15:1, `--plane` on `--blue` about 8.6:1, `--ink-soft` on `--paper` about 7:1. Focus states are a 2px `--accent` outline with 2px offset, never removed. The trade glyph is decorative and carries `aria-hidden`. The chat widget is a labelled button, the panel is a `dialog` with a focus trap, and Escape closes it.

## Quality checklist

- Two sections structurally unlike default marketing layouts: the pillow bands and the service index. Yes.
- Adjacent sections never share an entrance. Yes, by the entrance map.
- One heavy interaction. Yes, the call bar.
- `fadeUp` used once. Yes, the service index.
- Survives a trade swap with words and one hue only. Yes.
- Would break as a card grid. Yes, per the grid fallback test.
