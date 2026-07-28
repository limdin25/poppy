# Phase 2 — Storyboard

## Site cinematic grammar

- **Shell logic.** Stacked frontal tableaux. Every section is square to the viewer, symmetrical about a centre axis, and sits on one flat plane. No section overlaps another. No diagonals anywhere.
- **Eye-line.** Ozu's camera sits low. Translated: content in the tall sections is anchored to the lower two thirds of the frame, with generous empty space above it. This single rule is what makes the page unmistakable at a glance and is the hardest thing for a template to imitate.
- **Navigation posture.** No navigation bar. A single-page site for a business with one phone number does not need one. The only persistent chrome is a call bar pinned to the bottom on mobile.
- **Framing discipline.** One idea per frame. A section carries either a statement or a list, never both.
- **Density cadence.** Tall breathing tableau, then a narrow dense band, then a tall tableau. The alternation is the pacing device and replaces the content we do not have.
- **Recurring material.** Paper white `#FFFFFF` and a soft off-white `#F4F6F9`. Flat ink blue planes. A one-pixel blue rule used as a framing device, never as a divider of convenience.
- **What may repeat.** The pillow band, the hairline rule, the low eye-line. Nothing else.

## One big idea

**A small business, framed like a still life.** Seven true facts, each given a whole frame, so the modest amount of truth reads as editorial restraint rather than as an empty page.

## Page scene thesis

The opening scene of a quiet domestic film. We are not being sold to. We are being shown a place, calmly, and told exactly how to reach it.

## Hero dominance statement

The business's own name set at display scale, low in a tall white frame, with nothing above it but air and a single hairline rule. It feels expensive because of scale and restraint, not decoration — and because almost nothing else on the internet aimed at plumbers has the confidence to leave that much space empty.

## Signature composition — the pillow band

A full-bleed band, roughly 30vh, flat ink blue, holding **exactly one true fact** set large and centred, and nothing else. No icon, no button, no supporting line. These sit between the tall tableaux and carry the pacing.

**Grid fallback test.** Collapsed into a three-column card grid, the seven facts become a thin, obviously padded feature list and the page reads as a cheap template with a small amount of content. The pillow bands are what convert thinness into deliberateness. This is the composition the page cannot lose.

## Material thesis

Flat planes and hairlines, in the register of good printed stationery. Depth comes from the meeting of two flat colour fields and from one-pixel rules, never from shadows or blur. Exactly one soft shadow exists on the whole page, under the floating call bar, because it must read as detached from the content.

## Typography thesis

One family, system stack, no webfont round trip. Authority comes from the range: display sizes are genuinely large (clamped to about 3.2rem on mobile, 6.5rem on desktop) and body copy stays small and quiet. Tight tracking on display, generous line height on body. Numbers and the phone number get tabular figures so they align like a printed document.

## Narrative arc

Not `Hero -> Features -> Stats -> CTA`. The Ozu arc is: establish the place, hold on a detail, show the work, hold on a detail, offer the door.

| # | Beat | Section | Function |
|---|---|---|---|
| 1 | Establish | Frontal title tableau | Name, trade, town, one hairline, call affordance |
| 2 | Pillow | Band A | The service area, stated once |
| 3 | Show the work | Service list as an index | The trade's real services, numbered, no icons |
| 4 | Pillow | Band B | Availability, stated once |
| 5 | Testimony, only if true | Google rating tableau | Rendered **only** when `reviews_source === 'google'`, otherwise the whole beat is dropped |
| 6 | Pillow | Band C | The phone number itself, as the fact |
| 7 | Offer the door | Contact tableau | Phone, address if known, chat affordance |
| 8 | Colophon | Footer | Name, year, quiet ownership line |

Beats 2, 4 and 6 are the pillow shots. Beat 5 deletes itself rather than inventing a rating, which is the truth rule expressed as structure.

## Entrance map

Four distinct entrance types, none repeated adjacently, all subordinate to the stillness.

| Section | Entrance | Note |
|---|---|---|
| Title tableau | Hairline rule draws left to right, then the name settles up 12px | The only compound entrance on the page |
| Pillow bands | Plane wipes up from the lower edge, text already in place | Reads as a cut, not a fade |
| Service index | Rows stagger in at 40ms, opacity plus 8px | The one `fadeUp` use |
| Rating tableau | Straight cut, no motion | Deliberate stillness on the one section carrying proof |
| Contact tableau | Hairline draw only | Echoes the opening, closes the frame |

Interaction budget: **one** heavy interaction on the page (the call bar's pinned behaviour). Everything else is a cut or a settle. All motion is wrapped in `prefers-reduced-motion`.

## Trade adaptability

Nothing in the composition knows what a plumber is. The trade supplies: the label and plural from `api/lib/trades.ts`, a service list from a per-profile default map, and the accent hue. Swapping to a locksmith changes words and one hue token, never a layout rule. That is the whole point of putting the meaning in the content document rather than in the markup.
