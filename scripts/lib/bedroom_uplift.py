"""bedroom_uplift.py, the Python twin of api/lib/brrr-offer.ts.

What it costs to add a bedroom, by how many the house already has. Hugo's own
figures, 2026-08-10, for the kitchen-to-bedroom conversion plus a light refurb.

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

The table is (from_beds, to_beds): (low, high, budget). `budget` is the number
to plan on; low and high are the range it usually lands between, kept so nobody
mistakes a planning figure for a builder's quote.
"""

BEDROOM_UPLIFT_REFURB = {
    (1, 2): (12000, 15000, 14000),
    (2, 3): (14000, 18000, 16000),
    (3, 4): (16000, 22000, 19000),
}


def uplift_refurb(beds):
    """Cost of taking this house from `beds` to one more bedroom.

    Returns a dict, or None outside 1 to 3 beds. The None matters: there is no
    row for a studio or for a 4-bed going to 5, and extrapolating one is how a
    plausible wrong number ends up in a valuation. None means "no figure", and
    the caller is expected to fall back rather than guess.
    """
    try:
        n = int(beds)
    except (TypeError, ValueError):
        return None
    for (frm, to), (low, high, budget) in BEDROOM_UPLIFT_REFURB.items():
        if frm == n:
            return {"from": frm, "to": to, "low": low, "high": high, "budget": budget}
    return None
