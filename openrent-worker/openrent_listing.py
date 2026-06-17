"""OpenRent listing scraping — wired from Comet B2 (steps 1-2).

scrape_search(page, search_url) -> list of listing dicts from a search/area
results page. Each dict:
  {
    "external_listing_id": str,   # OpenRent's numeric id (from the listing URL)
    "listing_url": str,
    "title": str | None,
    "price_text": str | None,
    "postcode": str | None,
    "posted_at": str | None,      # ALWAYS None here — see note below
    "landlord_name": str | None,  # not on the results card (None) — see note
  }

Dedup strategy (Hugo, 2026-06-16): OpenRent has no public sort-by-date, so the
pasted search URL is filtered to "available now" and re-scraped repeatedly. We
DON'T filter by posted date — `posted_at` is None on purpose so the engine's
date cutoff is skipped — and rely entirely on the per-listing "already seen"
dedup (engine: db.target_exists on external_listing_id). Never-seen → message;
seen before → skip. The landlord name lives on the listing page, not the card,
so it's None here (the per-listing dedup is what matters); use scrape_listing
to enrich a single listing when needed.

scrape_listing(page, listing_url) -> a single richer dict (same keys), incl.
landlord name + rent, by opening the listing detail page.
"""
from __future__ import annotations
import re

from browser_util import nav

BASE = "https://www.openrent.co.uk"
CARD_SEL = "a.pli.search-property-card"


def _abs(href):
    if not href:
        return None
    if href.startswith("http"):
        return href
    return BASE + (href if href.startswith("/") else "/" + href)


def _listing_id_from(card, href):
    # 1) trailing digits of the listing URL (…/2910864)
    if href:
        m = re.search(r"/(\d+)(?:[/?#]|$)", href)
        if m:
            return m.group(1)
    # 2) data-* on the card
    for attr in ("data-listing-id", "data-property-id"):
        v = (card.get_attribute(attr) or "").strip()
        if v.isdigit():
            return v
    # 3) id="p<id>"
    m = re.match(r"p(\d+)$", (card.get_attribute("id") or "").strip())
    return m.group(1) if m else None


def _text(node, selector):
    try:
        el = node.query_selector(selector)
        if el:
            return ((el.inner_text() or "").strip()) or None
    except Exception:
        pass
    return None


def scrape_search(page, search_url):
    nav(page, search_url, wait_until="domcontentloaded")
    try:
        page.wait_for_selector(CARD_SEL, timeout=15000)
    except Exception:
        return []  # no results, or page blocked
    out, seen = [], set()
    for card in page.query_selector_all(CARD_SEL):
        href = card.get_attribute("href")
        ext = _listing_id_from(card, href)
        if not ext or ext in seen:
            continue
        seen.add(ext)
        title = card.get_attribute("title") or _text(card, "h2, h3, h4, .listing-title")
        if not title:
            # derive a readable title from the listing-url slug (…/1-bed-flat-london-wc2n/2865841)
            segs = [s for s in (href or "").split("?")[0].strip("/").split("/") if s]
            if len(segs) >= 2 and segs[-1].isdigit() and not segs[-2].isdigit():
                title = segs[-2].replace("-", " ").title()
        price = _text(card, ".pl-price, .price, [class*='price']")
        if not price:
            m = re.search(r"£[\d,]+(?:\.\d+)?(?:\s*(?:pcm|pw|pm))?", (card.inner_text() or ""), re.I)
            price = m.group(0) if m else None
        out.append({
            "external_listing_id": ext,
            "listing_url": _abs(href),
            "title": title,
            "price_text": price,
            "postcode": None,
            "posted_at": None,        # see module docstring — dedup is by listing id
            "landlord_name": None,    # not on the results card
        })
    return out


def scrape_listing(page, listing_url):
    nav(page, listing_url, wait_until="domcontentloaded")
    title = _text(page, "h1")
    landlord = (_text(page, "a.userPicContainer")
                or _text(page, ".landlord-name")
                or _text(page, "[class*='landlord'] .line-clamp-1"))
    price = None
    for row in page.query_selector_all("table.table-column-2-right tr"):
        label = row.query_selector("td.fw-medium")
        if label and "rent" in (label.inner_text() or "").lower():
            val = row.query_selector("td.fw-medium + td")
            price = ((val.inner_text() or "").strip() or None) if val else None
            break
    m = re.search(r"/(\d+)(?:[/?#]|$)", listing_url or "")
    return {
        "external_listing_id": m.group(1) if m else None,
        "listing_url": listing_url,
        "title": title,
        "price_text": price,
        "postcode": None,
        "posted_at": None,
        "landlord_name": landlord,
    }
