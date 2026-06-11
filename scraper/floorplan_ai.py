"""AI floor-plan analysis — Hugo's BRRR edge.

Strategy: find properties where we can ADD a bedroom by relocating/opening the
kitchen (e.g. knock the kitchen into the living/diner, free the old kitchen as a
bedroom). A vision model reads each floor plan and scores the conversion.

Proven live 2026-06-11 on real Rightmove floor plans. Portal-agnostic — works on
Rightmove or Zoopla floor-plan images.
"""
import os
import re
import json
import base64
import urllib.request

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-4-6"

ANALYSIS_PROMPT = (
    "You are a UK BRRR property analyst. Our strategy: buy flats/houses where we "
    "can ADD a bedroom by converting/relocating the kitchen (e.g. open the kitchen "
    "into the living/diner, freeing the old kitchen as a bedroom; or split a large "
    "reception). Analyse this floor plan and return JSON only:\n"
    "{\n"
    '  "current_beds": int,\n'
    '  "rooms": [ {"name": str, "approx_size": str} ],\n'
    '  "can_add_bedroom": true/false,\n'
    '  "conversion_idea": "one concrete sentence on how to add a bedroom, or why not",\n'
    '  "confidence": "high|medium|low",\n'
    '  "uplift_score": int  // 0-10: how attractive for our add-a-bedroom strategy\n'
    "}"
)


def _media_type(url):
    u = (url or "").lower()
    if u.endswith(".png"):
        return "image/png"
    if u.endswith(".gif"):
        return "image/gif"
    if u.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


def parse_analysis(text):
    """Pull the JSON object out of a model reply (it may wrap it in prose/fences)."""
    if not text:
        return None
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except (ValueError, TypeError):
        return None
    # Clamp + coerce so downstream UI/storage is safe.
    score = data.get("uplift_score")
    try:
        data["uplift_score"] = max(0, min(10, int(score)))
    except (TypeError, ValueError):
        data["uplift_score"] = 0
    data["can_add_bedroom"] = bool(data.get("can_add_bedroom"))
    return data


def _download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def analyse_floorplan(image_url, *, api_key=None, fetch=None, post=None):
    """Score one floor plan. fetch/post are injectable for tests.

    Returns the parsed analysis dict, or {"error": "..."} on failure.
    """
    key = api_key or ANTHROPIC_API_KEY
    if not key:
        return {"error": "no anthropic key"}
    fetch = fetch or _download
    try:
        img = fetch(image_url)
    except Exception as e:  # pragma: no cover - network
        return {"error": f"download failed: {e}"}
    b64 = base64.standard_b64encode(img).decode()
    body = {
        "model": MODEL,
        "max_tokens": 900,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64",
                                          "media_type": _media_type(image_url), "data": b64}},
            {"type": "text", "text": ANALYSIS_PROMPT},
        ]}],
    }
    poster = post or _post_anthropic
    try:
        text = poster(body, key)
    except Exception as e:  # pragma: no cover - network
        return {"error": f"api failed: {e}"}
    parsed = parse_analysis(text)
    return parsed or {"error": "could not parse analysis"}


def _post_anthropic(body, key):  # pragma: no cover - network
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(), method="POST",
        headers={"content-type": "application/json", "x-api-key": key,
                 "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    return out["content"][0]["text"]
