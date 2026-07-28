# Phase 2 — Storyboard (v3, photographic)

## Site cinematic grammar

- **Shell logic.** An image-first corridor. The page is a run of full-bleed
  photographic slabs; the interface is inset *into* the photographs rather than
  laid out beside them. Exactly one solid colour section interrupts the run, as
  a rest.
- **Eye-line.** Type sits low-left inside a frame, the way a title card sits
  under a horizon. Never centred over a photograph.
- **Navigation posture.** A slim bar that starts transparent over the opening
  photograph and turns solid white once the page moves. One phone number in it.
  No menu: a single-page site for a business with one number does not need one.
- **Framing discipline.** One fact per slab. If a slab needs two, it is two
  slabs.
- **Density cadence.** Tall photograph, tight editorial column, tall
  photograph, colour rest, tall photograph. Photography carries the spectacle
  and the text blocks carry the information, so neither has to do both.
- **Recurring material.** Every photograph is duotoned to the brand blue, so
  the whole page reads as one shoot. A single white slab and a single blue slab
  are the only solid shapes allowed to overlap a photograph.
- **What may repeat.** The overlapping slab, the low-left title position, the
  duotone. Nothing else.

## One big idea

**The work, photographed, with his name on it.** Not a brochure about a
plumber. A page that opens on a pair of hands on a pipe and puts his business
name across it.

## Page scene thesis

The opening reel of *There Will Be Blood*: nearly wordless, entirely hands and
material, and by the end of it you believe the man can do the job. The page is
that reel with a phone number in it.

## Hero dominance statement

A full-bleed photograph of the trade actually being done, duotoned to the brand
blue, with the business name set large and low-left over a directional scrim
that reproduces the film's single-source falloff. It feels expensive because it
is a photograph doing the work, not a gradient standing in for one.

## Restraint statement

What this deliberately does not do: no rounded card grid, no gradient-on-
gradient, no glassmorphism, no photo carousel, no counters or animated
statistics, no more than two type scales in body copy, no motion that a lead on
a train would notice.

## Material thesis

Photographic grain and the duotone are the material. Solid slabs are flat and
matte with no shadow softening, so the contrast is photograph against pigment,
not card against page.

## Typography thesis

System stack at heavy weights and tight tracking for titles, so the name reads
as signage. Body copy stays at one size. Authority comes from scale contrast
between the name and everything else, not from a display face we cannot load.

## Signature composition: the overlapping slab

A full-bleed photograph with one solid slab overlapping a corner of it,
carrying exactly one fact. Used **twice only**, alternating side: blue slab
bottom-left over the work photograph, white slab top-right over the outcome
photograph. This is the move that cannot survive being flattened into a card
grid.

## Grid fallback test

Reduce this page to a three-column card grid and you lose: the alternation
between labour and territory, the sense that these are photographs of real
work rather than illustrations of it, and the overlap that makes the fact and
the image occupy one plane. What is left is v2, which was rejected.

## Narrative arc (from the film, not from marketing)

| Beat | Film reference | Page |
|---|---|---|
| 1. Silent labour | The wordless opening reel | Full-bleed hero photograph, name low-left, rating, call |
| 2. The claim on territory | The pitch to Little Boston | Solid blue rest carrying the area line. **No photograph, on purpose:** we cannot honestly show *his* town, and a generic town captioned with his town is a quiet lie |
| 3. The inventory | The derrick assembled piece by piece | Services as an editorial list beside a tall work photograph, blue slab overlapping it |
| 4. The gusher | The derrick fire, the one spectacle | The Google rating, large, on a white slab overlapping the outcome photograph |
| 5. The reckoning | The final confrontation | Deep blue close: the number, set as the largest type on the page |

Five beats. Adjacent beats never reveal the same way.

## Entrance map

| Beat | Entrance | Why it differs |
|---|---|---|
| 1 Hero | Scrim wipes down, title rises | Only beat that moves on load |
| 2 Territory | Straight cut, no entrance | The rest beat should not perform |
| 3 Inventory | Photograph scales from 1.06 to 1, list items stagger in | Camera settling, then the inventory counted off |
| 4 Proof | Slab slides in from the right over the still photograph | The only lateral move on the page |
| 5 Reckoning | Number counts up in scale, single step | Terminal emphasis |

`opacity + translateY` appears twice at most (beats 3 and 5). Beat 2 has an
intentional `none`.

## Interaction budget

One heavy interaction (the beat 3 photograph scale, tied to scroll position).
Two attention-seeking reveals (beat 1 wipe, beat 4 lateral slab). Everything
else is subordinate.

## Uniqueness guardrail

Must not inherit from v1 or v2 at the wireframe level: no card grid, no cards
over the hero edge, no centred colour band with a centred button, no pill
rating badge, no empty framed opening. Checked by stripping colour and type and
comparing the block diagram.

## Resilience

The photographs are an enhancement, never a dependency. A trade with no
photograph set, or an image that fails to load, falls back to the duotone base
colour as a solid plane. Nothing on the page depends on an image arriving.
