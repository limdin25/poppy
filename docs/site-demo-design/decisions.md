# Phase 1 — Decisions (v3, photographic)

Supersedes the v1 decisions that stood here. v1 shipped and was rejected on
sight. v2 was a repair of v1 under the same no-images constraint and was
rejected too. This is the first pass with photography available.

## The brief, stated honestly

Not "a beautiful website for a plumber". The actual test:

> A tradesman opens this on his phone, thirty seconds after a cold text from a
> stranger, and has to want to pay GBP 97 a month for it.

He must **recognise himself in it in one glance**. Recognition, not beauty.
The audience is not a design audience and never will be.

## What went wrong twice, recorded so it does not go wrong a third time

**v1 (late-period Ozu).** Empty framed hero, flat colour "pillow" bands each
carrying one fact, services as a numbered index, no photography at all. Hugo:
*"a hell of an ugly plumber website"*. The film choice was defensible and the
execution was clean. The brief was wrong: it optimised for weight and restraint
in front of an audience that reads restraint as unfinished.

**v2 (card repair).** Graded navy hero, rating pill, three white cards lifted
over the hero edge, three-column rounded service cards, centred colour band.
Hugo: *"still very ugly, no plumber images, nothing"*. It was a competent SaaS
marketing page. A plumber does not want a SaaS page, he wants to see the work.

**The constraint was the actual fault, and it was mine to challenge.** The
original spec said self-contained, no external images. Under that rule any
director lands on typographic restraint, because nothing else is left. Stock
photography **served from our own domain** satisfies the real requirement (no
third-party host, no privacy leak, no CDN round trip) without the starvation.
That should have been raised on day one instead of designed around.

## Start questionnaire

| Item | Answer | Source |
|---|---|---|
| How to start | Step-by-step, director chosen by analysis | Hugo asked for the skill by name |
| Images | **Real photography, required.** Pexels, processed, self-hosted | Hugo: "add image from pexel stock uk" |
| Niche | UK trade services: plumber, electrician, builder, locksmith, pest control, plus the rest of `api/lib/trades.ts` | Hugo |
| Page list | One page. A demo site is a single scroll. | Inferred |
| Palette | Blue and white, light mode | Hugo |
| Constraint | One template, adapts across trades with no redesign | Hugo |

## Director and film: Paul Thomas Anderson, *There Will Be Blood*

Chosen by analysis. The three anti-convergence questions:

**1. What specific visual problem does this film solve for this niche?**
TWBB alternates close, dirty, practically-lit shots of manual labour against
wide shots of the territory that labour claims. Those are precisely the two
facts a trade page must establish: *he can do the work*, and *he covers your
area*. Robert Elswit lights interiors with a single hard practical source and
lets the falloff go deep, which is also the real condition of every usable
photograph here: under a sink, inside a consumer unit, in a loft.

**2. Would it work equally well for three unrelated niches?**
No. Its value here is the labour-plus-territory alternation and the dignity it
grants physical work. Applied to a SaaS or a fashion brand it would have to be
distorted past recognition. Passes.

**3. Am I picking the film or its reputation?**
TWBB's reputation is the performance and the score, neither of which is a
design signal. The selection rests on the derrick-floor photography and the
opening reel, which is nearly wordless and entirely about hands and material.
Passes.

**Deliberate deviation, recorded:** the film's amber/sepia grade is NOT
imported. Hugo's brand is blue and white, light mode. What is imported is the
*lighting behaviour* (one directional source, deep falloff, texture held in
shadow) and the *framing logic*. The hue is ours.

## Previous-work audit and shell-ban list

Traits from v1 and v2 that must not appear again:

- Full-bleed flat colour band with a centred heading and a centred button (both)
- Rounded card grid for services (v2)
- Cards floating over the hero's lower edge (v2)
- Gradient hero with left-aligned copy and two pill buttons (v2)
- Centred empty frame as the opening (v1)
- Pill-shaped rating badge at the hero's top-left (v2)
- Any composition whose wireframe is "coloured block, card row, card grid,
  coloured block"

**Wireframe test:** strip colour and type. v2 reads as four stacked blocks plus
a card matrix. v3 must not.

## Primary composition family: image-first corridor (panoramic slabs)

v1 was stacked frontal tableaux. v2 was a card matrix on a graded plane. v3 is
a sequence of **full-bleed photographic slabs with the interface inset into
them**, interrupted by exactly one solid colour rest. Different at the
wireframe level, not only at the surface.

## Photography

**Source:** Pexels. The licence permits free commercial use and modification
with no attribution required. Files are downloaded, processed and **served from
our own domain** (`public/site/`), so the self-contained rule still holds.

**Selection rule, and it is a truth rule not a taste rule.** Prefer hands,
tools, materials, the job in progress. Reject posed models on studio
backgrounds and anything that reads as "our team", because it is not his team.
A close shot of a wrench on a pipe states the ordinary scope of the trade. A
smiling model in branded hi-vis states a staff member who does not exist. After
the sale the owner replaces these with his own photographs in the editor, which
is the entire point of keeping them generic now.

**Geography.** UK-specific stock is not reliably identifiable, so the set is
biased toward close work where geography is not legible, and away from wide
shots carrying number plates, signage or foreign electrical fittings.

**The unifying move: every photograph is duotoned to the brand blue at build
time.** This is the signature treatment and it earns its place three times
over. It makes six photographs by six photographers, shot under a yellow studio
light, a red gel and an overcast sky, read as one commissioned shoot. It puts
the brand colour *into* the photography instead of fighting it. And baking it
at build time costs the page nothing at runtime.

## Sources consulted

- Pexels search and photo pages for plumbing, electrical, roofing, locksmith,
  painting and pest control. Chosen IDs and their roles are recorded in
  `scripts/build-site-photos.mjs`, which is the reproducible build step.
- Direct inspection of a 24-image contact sheet before selection. That is how
  the posed studio shots and the hazmat fogger were caught. Judging stock from
  its title alone does not work.
