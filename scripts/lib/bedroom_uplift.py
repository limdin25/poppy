"""bedroom_uplift.py, the Python twin of api/lib/brrr-offer.ts.

What it costs to convert this house and refurbish it, by how many bedrooms it
already has. Hugo's costings, 2026-08-11.

These REPLACED a much thinner table (a 2-bed conversion at 16,000) that was
roughly the low end of the kitchen move alone, with nothing for the rest of the
works. It feeds the maximum offer directly: measured over the live batch, one
pound of refurb error moves the most we can pay by 1.05, so the engine was
prepared to overpay by about 20,000 on a 2-bed.

Four costs per row, because the two jobs are separate and only their sum is
what you actually spend:
    conversion  moving the kitchen and building the new bedroom
    refurb      the light refurbishment the rest of the place needs
    total       the two added up, before contingency
    low/high    the SENSIBLE BUDGET, which already carries 10-15% contingency

`budget` is the midpoint of that sensible range and is the number to plan on.
**CONTINGENCY IS ALREADY INSIDE IT.** valuation.py must not multiply it again,
and no longer does. Where more caution is wanted (a suspiciously cheap asking
price usually means something is wrong with the building) the engine reaches for
`high` rather than inventing a multiplier of its own.

WHY A TWIN. valuation.py runs on the VPS at /root/scraper, in Python, in a
different git repo. It cannot import the TypeScript module that every other part
of the offer maths lives in, and two independent copies of a pricing table is
exactly how this codebase has been bitten before. So the TypeScript side is the
canon, this file mirrors it, and tests/brrr-offer.test.ts reads THIS file's
source and fails the build if a number drifts. Same arrangement as
api/lib/uk-places.ts and scripts/lib/uk-places.mjs. If you edit one, edit both.

Deploy: copy this file to /root/scraper/bedroom_uplift.py. valuation.py imports
it, and the drift test also asserts that import exists, because a helper that is
written, tested and imported by nothing is a trap this project has fallen into
before (see the line-status screen).

The table is (from_beds, to_beds): (low, high, budget), where low and high are
the sensible budget range with contingency in it.
"""

BEDROOM_UPLIFT_REFURB = {
    (1, 2): (22000, 41000, 31500),
    (2, 3): (26000, 47000, 36500),
    (3, 4): (32000, 56000, 44000),
    (4, 5): (37000, 66000, 51500),
}

# The parts behind each sensible budget, kept so a screen can show the working
# and a builder's quote can be compared against the right line.
BEDROOM_UPLIFT_PARTS = {
    (1, 2): {"conversion": (12000, 22000), "refurb": (8000, 14000), "total": (20000, 36000)},
    (2, 3): {"conversion": (13000, 23000), "refurb": (11000, 18000), "total": (24000, 41000)},
    (3, 4): {"conversion": (14000, 25000), "refurb": (15000, 24000), "total": (29000, 49000)},
    (4, 5): {"conversion": (15000, 27000), "refurb": (19000, 30000), "total": (34000, 57000)},
}


def uplift_refurb(beds):
    """Cost of taking this house from `beds` to one more bedroom.

    Returns a dict, or None outside 1 to 4 beds. The None matters: there is no
    row for a studio or for a 5-bed going to 6, and extrapolating one is how a
    plausible wrong number ends up in a valuation. None means "no figure", and
    the caller is expected to fall back rather than guess.
    """
    try:
        n = int(beds)
    except (TypeError, ValueError):
        return None
    for (frm, to), (low, high, budget) in BEDROOM_UPLIFT_REFURB.items():
        if frm == n:
            parts = BEDROOM_UPLIFT_PARTS.get((frm, to), {})
            return {
                "from": frm, "to": to, "low": low, "high": high, "budget": budget,
                "conversion": parts.get("conversion"),
                "refurb": parts.get("refurb"),
                "total": parts.get("total"),
            }
    return None
