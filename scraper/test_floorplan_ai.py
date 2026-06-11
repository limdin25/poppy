"""TDD for the AI floor-plan scorer — parsing + the analyse pipeline (mocked).

No network. Run: cd scraper && .venv/bin/python -m pytest test_floorplan_ai.py -q
"""
import json
from floorplan_ai import parse_analysis, analyse_floorplan, _media_type


def test_media_type():
    assert _media_type("x/y.png") == "image/png"
    assert _media_type("x/y.JPEG") == "image/jpeg"
    assert _media_type("x/y.jpg") == "image/jpeg"
    assert _media_type("x/y.webp") == "image/webp"


def test_parse_clean_json():
    a = parse_analysis('{"current_beds":2,"can_add_bedroom":true,"uplift_score":6}')
    assert a["current_beds"] == 2
    assert a["can_add_bedroom"] is True
    assert a["uplift_score"] == 6


def test_parse_json_in_fences_with_prose():
    txt = "Here is the analysis:\n```json\n{\"uplift_score\": 8, \"can_add_bedroom\": true}\n```\nDone."
    a = parse_analysis(txt)
    assert a["uplift_score"] == 8
    assert a["can_add_bedroom"] is True


def test_parse_clamps_score():
    assert parse_analysis('{"uplift_score": 99}')["uplift_score"] == 10
    assert parse_analysis('{"uplift_score": -5}')["uplift_score"] == 0
    assert parse_analysis('{"uplift_score": "bad"}')["uplift_score"] == 0


def test_parse_coerces_can_add_bedroom():
    assert parse_analysis('{"can_add_bedroom": 0}')["can_add_bedroom"] is False
    assert parse_analysis('{"can_add_bedroom": 1}')["can_add_bedroom"] is True


def test_parse_garbage_returns_none():
    assert parse_analysis("no json at all") is None
    assert parse_analysis("") is None


def test_analyse_pipeline_with_mocks():
    captured = {}
    def fake_fetch(url):
        captured["url"] = url
        return b"\xff\xd8fakejpeg"
    def fake_post(body, key):
        captured["body"] = body
        captured["key"] = key
        return '{"current_beds":2,"can_add_bedroom":true,"uplift_score":7,"conversion_idea":"x"}'
    res = analyse_floorplan("http://x/plan.jpeg", api_key="K", fetch=fake_fetch, post=fake_post)
    assert res["uplift_score"] == 7
    assert res["can_add_bedroom"] is True
    assert captured["url"] == "http://x/plan.jpeg"
    assert captured["key"] == "K"
    # image was base64-encoded into the message
    content = captured["body"]["messages"][0]["content"]
    assert content[0]["type"] == "image"
    assert content[0]["source"]["media_type"] == "image/jpeg"


def test_analyse_no_key():
    assert analyse_floorplan("http://x/p.png", api_key="")["error"] == "no anthropic key"


def test_analyse_bad_model_reply():
    res = analyse_floorplan("http://x/p.png", api_key="K",
                            fetch=lambda u: b"img", post=lambda b, k: "sorry, no json")
    assert "error" in res
