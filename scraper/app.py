"""Flask app: routes, SSE stream, background scraper job."""
import json, queue, threading, asyncio, os
from flask import Flask, render_template, request, jsonify, Response, send_file, abort
import requests

import storage
import facebook_storage
import rightmove_storage
import valuation
from proxies import ProxyManager
from scraper import Scraper
from facebook_scraper import FacebookScraper
from rightmove_scraper import RightmoveScraper, FloorplanFetcher, CompsFetcher
from rightmove_enquiry import EnquiryFiller
from enquiry_config import load_enquiry_config

# BRRRR pipeline promotion (Hugo's new workflow, 2026-05-27):
# When a property is marked 'potential' on /floorplans, the scraper calls
# this Supabase Edge Function which runs the comps fetcher AND inserts
# wk_contacts + wk_dialer_queue + brrrr_* mirror records. The lead then
# shows up at hub.nfstay.com/crm/pipelines (BRRRR pipeline) and on the
# /crm/dialer-pro queue. Synchronous: the request blocks until done so
# the UI spinner stays accurate (30-90s typical).
BRRRR_PROMOTE_URL = "https://asazddtvjvmckouxcmmo.functions.supabase.co/brrrr-promote-to-pipeline"


def _load_brrrr_tokens() -> dict:
    """Tokens live in env or data/brrrr.json (gitignored) — this folder sits
    inside the Poppy git repo now, so no secrets in code."""
    try:
        with open(os.path.join(os.path.dirname(__file__), "data", "brrrr.json")) as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    return {
        "promote": os.environ.get("BRRRR_PROMOTE_TOKEN") or cfg.get("promote_token", ""),
        "comps_fetch": os.environ.get("COMPS_FETCH_TOKEN") or cfg.get("comps_fetch_token", ""),
    }


_BRRRR_TOKENS = _load_brrrr_tokens()
BRRRR_PROMOTE_TOKEN = _BRRRR_TOKENS["promote"]
BRRRR_PROMOTE_TIMEOUT = 200  # seconds; allows 180s comps + headroom
BRRRR_SKIP_URL = "https://asazddtvjvmckouxcmmo.functions.supabase.co/brrrr-skip-from-pipeline"
BRRRR_SKIP_TIMEOUT = 30  # seconds; skip is just DB writes, no comps fetch

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

# The Elsie admin panel (heyelsie.com) embeds and pings this local app —
# allow those origins so the in-app Scraper tab can show live status.
_ELSIE_ORIGINS = {"https://heyelsie.com", "https://app.heyelsie.com", "http://localhost:5174"}


@app.after_request
def _elsie_cors(resp):
    origin = request.headers.get("Origin", "")
    if origin in _ELSIE_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

# --- Global job state ---
EVENTS: "queue.Queue[dict]" = queue.Queue()
JOB = {"thread": None, "scraper": None,
       "stop": threading.Event(), "pause": threading.Event(),
       "running": False}

FB_JOB = {"thread": None, "scraper": None,
          "stop": threading.Event(), "pause": threading.Event(),
          "running": False}

RM_JOB = {"thread": None, "scraper": None,
          "stop": threading.Event(), "pause": threading.Event(),
          "running": False}

FP_JOB = {"thread": None, "scraper": None,
          "stop": threading.Event(), "pause": threading.Event(),
          "running": False}

COMP_JOB = {"thread": None, "scraper": None,
            "stop": threading.Event(), "pause": threading.Event(),
            "running": False}


def emit(ev: dict):
    EVENTS.put(ev)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET", "POST"])
def config():
    if request.method == "POST":
        storage.save_config(request.get_json(force=True) or {})
        return jsonify({"ok": True})
    return jsonify(storage.load_config())


@app.route("/api/preview", methods=["POST"])
def preview():
    data = request.get_json(force=True)
    keywords = [k.strip() for k in (data.get("keywords") or "").splitlines() if k.strip()]
    locations = [l.strip() for l in (data.get("locations") or "").splitlines() if l.strip()]
    pairs = [(k, l) for k in keywords for l in locations]
    already = sum(1 for k, l in pairs if storage.is_query_scraped(k, l))
    return jsonify({"keywords": len(keywords), "locations": len(locations),
                    "queries": len(pairs), "already": already,
                    "will_scrape": len(pairs) - already})


@app.route("/api/test_proxy", methods=["POST"])
def test_proxy():
    d = request.get_json(force=True)
    pm = ProxyManager(d.get("host", ""), d.get("port", ""),
                      d.get("username", ""), d.get("password", ""),
                      int(d.get("rotate_every") or 25),
                      sticky=bool(d.get("sticky", False)))
    result = pm.test()
    if result.get("ok"):
        storage.save_config({
            "host": d.get("host", ""), "port": d.get("port", ""),
            "username": d.get("username", ""), "password": d.get("password", ""),
            "rotate_every": d.get("rotate_every"), "sticky": bool(d.get("sticky", False)),
        })
    return jsonify(result)


@app.route("/api/start", methods=["POST"])
def start():
    if JOB["running"]:
        return jsonify({"ok": False, "error": "already running"}), 400
    d = request.get_json(force=True)
    keywords = [k.strip() for k in (d.get("keywords") or "").splitlines() if k.strip()]
    locations = [l.strip() for l in (d.get("locations") or "").splitlines() if l.strip()]
    if not keywords or not locations:
        return jsonify({"ok": False, "error": "need at least one keyword and one location"}), 400
    jobs = [(k, l) for k in keywords for l in locations]
    storage.save_config(d)  # remember everything for next run

    pm = ProxyManager(d.get("host", ""), d.get("port", ""),
                      d.get("username", ""), d.get("password", ""),
                      int(d.get("rotate_every") or 25),
                      sticky=bool(d.get("sticky", False)))
    JOB["stop"].clear()
    JOB["pause"].clear()
    sc = Scraper(
        proxy_mgr=pm,
        emit=emit,
        stop_event=JOB["stop"],
        pause_event=JOB["pause"],
        max_per_query=int(d.get("max_per_query") or 50),
        delay_min=float(d.get("delay_min") or 2),
        delay_max=float(d.get("delay_max") or 5),
        headless=bool(d.get("headless", True)),
        full_details=bool(d.get("full_details", True)),
    )
    JOB["scraper"] = sc

    def _run():
        JOB["running"] = True
        try:
            asyncio.run(sc.run(jobs, force_rescrape=bool(d.get("force_rescrape", False))))
        except Exception as e:
            emit({"type": "log", "level": "error", "msg": f"FATAL: {e}"})
            emit({"type": "done"})
        finally:
            JOB["running"] = False

    t = threading.Thread(target=_run, daemon=True)
    JOB["thread"] = t
    t.start()
    return jsonify({"ok": True, "queries": len(jobs)})


@app.route("/api/pause", methods=["POST"])
def pause():
    if JOB["pause"].is_set():
        JOB["pause"].clear()
        emit({"type": "log", "level": "info", "msg": "Resumed."})
        return jsonify({"paused": False})
    JOB["pause"].set()
    emit({"type": "log", "level": "info", "msg": "Paused."})
    return jsonify({"paused": True})


@app.route("/api/stop", methods=["POST"])
def stop():
    JOB["stop"].set()
    JOB["pause"].clear()
    emit({"type": "log", "level": "warn", "msg": "Stop requested."})
    return jsonify({"ok": True})


@app.route("/api/sessions")
def sessions():
    return jsonify(storage.list_sessions())


@app.route("/api/queries")
def queries():
    return jsonify(storage.list_scraped_queries())


@app.route("/api/recent")
def recent():
    return jsonify(storage.recent_leads(50))


@app.route("/api/export")
def export_all():
    p = storage.export_csv(None)
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


@app.route("/api/export/<int:session_id>")
def export_session(session_id):
    p = storage.export_csv(session_id)
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


@app.route("/api/clear", methods=["POST"])
def clear():
    if JOB["running"]:
        return jsonify({"ok": False, "error": "stop the job first"}), 400
    storage.clear_history()
    return jsonify({"ok": True})


@app.route("/stream")
def stream():
    def gen():
        # initial hello
        yield f"data: {json.dumps({'type':'hello'})}\n\n"
        while True:
            try:
                ev = EVENTS.get(timeout=15)
                yield f"data: {json.dumps(ev)}\n\n"
            except queue.Empty:
                yield ": keep-alive\n\n"
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ───────────────── Facebook Ad Library routes ─────────────────

@app.route("/facebook")
def facebook_index():
    return render_template("facebook.html")


@app.route("/api/facebook/config", methods=["GET", "POST"])
def fb_config():
    if request.method == "POST":
        facebook_storage.save_config(request.get_json(force=True) or {})
        return jsonify({"ok": True})
    return jsonify(facebook_storage.load_config())


@app.route("/api/facebook/preview", methods=["POST"])
def fb_preview():
    data = request.get_json(force=True)
    keywords = [k.strip() for k in (data.get("keywords") or "").splitlines() if k.strip()]
    countries = [c.strip() for c in (data.get("countries") or "").split(",") if c.strip()]
    if not countries:
        countries = ["GB"]
    pairs = [(k, c) for k in keywords for c in countries]
    already = sum(1 for k, c in pairs if facebook_storage.is_query_scraped(k, c))
    return jsonify({"keywords": len(keywords), "countries": len(countries),
                    "queries": len(pairs), "already": already,
                    "will_scrape": len(pairs) - already})


@app.route("/api/facebook/start", methods=["POST"])
def fb_start():
    if FB_JOB["running"]:
        return jsonify({"ok": False, "error": "already running"}), 400
    d = request.get_json(force=True)
    keywords = [k.strip() for k in (d.get("keywords") or "").splitlines() if k.strip()]
    countries = [c.strip() for c in (d.get("countries") or "").split(",") if c.strip()]
    if not keywords:
        return jsonify({"ok": False, "error": "need at least one keyword"}), 400
    if not countries:
        countries = ["GB"]
    jobs = [(k, c) for k in keywords for c in countries]
    facebook_storage.save_config(d)

    pm = ProxyManager(d.get("host", ""), d.get("port", ""),
                      d.get("username", ""), d.get("password", ""),
                      int(d.get("rotate_every") or 25),
                      sticky=bool(d.get("sticky", False)))
    FB_JOB["stop"].clear()
    FB_JOB["pause"].clear()
    sc = FacebookScraper(
        proxy_mgr=pm,
        emit=emit,
        stop_event=FB_JOB["stop"],
        pause_event=FB_JOB["pause"],
        max_results=int(d.get("max_results") or 100),
        delay_min=float(d.get("delay_min") or 2),
        delay_max=float(d.get("delay_max") or 5),
        headless=bool(d.get("headless", True)),
    )
    FB_JOB["scraper"] = sc

    def _run():
        FB_JOB["running"] = True
        try:
            asyncio.run(sc.run(jobs,
                               force_rescrape=bool(d.get("force_rescrape", False)),
                               count_ads=bool(d.get("count_ads", False))))
        except Exception as e:
            emit({"type": "log", "level": "error", "msg": f"FB FATAL: {e}"})
            emit({"type": "fb_done"})
        finally:
            FB_JOB["running"] = False

    t = threading.Thread(target=_run, daemon=True)
    FB_JOB["thread"] = t
    t.start()
    return jsonify({"ok": True, "queries": len(jobs)})


@app.route("/api/facebook/pause", methods=["POST"])
def fb_pause():
    if FB_JOB["pause"].is_set():
        FB_JOB["pause"].clear()
        emit({"type": "log", "level": "info", "msg": "FB Resumed."})
        return jsonify({"paused": False})
    FB_JOB["pause"].set()
    emit({"type": "log", "level": "info", "msg": "FB Paused."})
    return jsonify({"paused": True})


@app.route("/api/facebook/stop", methods=["POST"])
def fb_stop():
    FB_JOB["stop"].set()
    FB_JOB["pause"].clear()
    emit({"type": "log", "level": "warn", "msg": "FB Stop requested."})
    return jsonify({"ok": True})


@app.route("/api/facebook/sessions")
def fb_sessions():
    return jsonify(facebook_storage.list_sessions())


@app.route("/api/facebook/queries")
def fb_queries():
    return jsonify(facebook_storage.list_scraped_queries())


@app.route("/api/facebook/recent")
def fb_recent():
    return jsonify(facebook_storage.recent_ads(50))


@app.route("/api/facebook/export")
def fb_export_all():
    p = facebook_storage.export_csv(None)
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


@app.route("/api/facebook/export/<int:session_id>")
def fb_export_session(session_id):
    p = facebook_storage.export_csv(session_id)
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


@app.route("/api/facebook/clear", methods=["POST"])
def fb_clear():
    if FB_JOB["running"]:
        return jsonify({"ok": False, "error": "stop the job first"}), 400
    facebook_storage.clear_history()
    return jsonify({"ok": True})


# ───────────────── Rightmove routes ─────────────────

@app.route("/rightmove")
def rightmove_index():
    return render_template("rightmove.html")


@app.route("/api/rightmove/config", methods=["GET", "POST"])
def rm_config():
    if request.method == "POST":
        rightmove_storage.save_config(request.get_json(force=True) or {})
        return jsonify({"ok": True})
    return jsonify(rightmove_storage.load_config())


@app.route("/api/rightmove/start", methods=["POST"])
def rm_start():
    if RM_JOB["running"]:
        return jsonify({"ok": False, "error": "already running"}), 400
    d = request.get_json(force=True)
    urls = [u.strip() for u in (d.get("search_urls") or "").splitlines() if u.strip()]
    if not urls:
        return jsonify({"ok": False, "error": "need at least one search URL"}), 400
    rightmove_storage.save_config(d)

    pm = ProxyManager(d.get("host", ""), d.get("port", ""),
                      d.get("username", ""), d.get("password", ""),
                      int(d.get("rotate_every") or 25),
                      sticky=bool(d.get("sticky", False)))
    RM_JOB["stop"].clear()
    RM_JOB["pause"].clear()
    sc = RightmoveScraper(
        proxy_mgr=pm,
        emit=emit,
        stop_event=RM_JOB["stop"],
        pause_event=RM_JOB["pause"],
        max_pages=int(d.get("max_pages") or 50),
        delay_min=float(d.get("delay_min") or 3),
        delay_max=float(d.get("delay_max") or 6),
        headless=bool(d.get("headless", True)),
    )
    RM_JOB["scraper"] = sc

    def _run():
        RM_JOB["running"] = True
        try:
            asyncio.run(sc.run(urls, force_rescrape=bool(d.get("force_rescrape", False))))
        except Exception as e:
            emit({"type": "log", "level": "error", "msg": f"RM FATAL: {e}"})
            emit({"type": "rm_done"})
        finally:
            RM_JOB["running"] = False

    t = threading.Thread(target=_run, daemon=True)
    RM_JOB["thread"] = t
    t.start()
    return jsonify({"ok": True, "urls": len(urls)})


@app.route("/api/rightmove/pause", methods=["POST"])
def rm_pause():
    if RM_JOB["pause"].is_set():
        RM_JOB["pause"].clear()
        emit({"type": "log", "level": "info", "msg": "RM Resumed."})
        return jsonify({"paused": False})
    RM_JOB["pause"].set()
    emit({"type": "log", "level": "info", "msg": "RM Paused."})
    return jsonify({"paused": True})


@app.route("/api/rightmove/stop", methods=["POST"])
def rm_stop():
    RM_JOB["stop"].set()
    RM_JOB["pause"].clear()
    emit({"type": "log", "level": "warn", "msg": "RM Stop requested."})
    return jsonify({"ok": True})


@app.route("/api/rightmove/sessions")
def rm_sessions():
    return jsonify(rightmove_storage.list_sessions())


@app.route("/api/rightmove/recent")
def rm_recent():
    return jsonify(rightmove_storage.recent_listings(50))


@app.route("/api/rightmove/export")
def rm_export_all():
    p = rightmove_storage.export_csv(None)
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


@app.route("/api/rightmove/export/<int:session_id>")
def rm_export_session(session_id):
    p = rightmove_storage.export_csv(session_id)
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


@app.route("/api/rightmove/clear", methods=["POST"])
def rm_clear():
    if RM_JOB["running"]:
        return jsonify({"ok": False, "error": "stop the job first"}), 400
    rightmove_storage.clear_history()
    return jsonify({"ok": True})


# ───────────────── Floor Plan Review routes ─────────────────

@app.route("/floorplans")
def floorplans_index():
    return render_template("floorplans.html")


@app.route("/api/floorplans/properties")
def fp_properties():
    return jsonify(rightmove_storage.properties_with_floorplans())


@app.route("/api/floorplans/images/<property_id>")
def fp_images(property_id):
    fps = rightmove_storage.get_floorplans(property_id)
    return jsonify([f for f in fps if f.get("image_url")])


@app.route("/api/floorplans/stats")
def fp_stats():
    return jsonify(rightmove_storage.review_stats())


def _skip_async(pid: str):
    """Fire-and-forget: call brrrr-skip-from-pipeline in background.

    Mirror of _promote_async for the skip direction. Removes the
    pending wk_dialer_queue row, sets brrrr_calls.stage=dead and
    brrrr_reviews.status=skip on Supabase, and drops the contact off
    the BRRRR kanban if they have no remaining potential properties.
    Failures are logged only — the user can re-click Skip to retry.
    """
    try:
        r = requests.post(
            BRRRR_SKIP_URL,
            json={"property_id": pid},
            headers={"x-promote-token": BRRRR_PROMOTE_TOKEN, "Content-Type": "application/json"},
            timeout=BRRRR_SKIP_TIMEOUT,
        )
        try:
            body = r.json()
        except Exception:
            body = {"ok": False, "error": f"non-json HTTP {r.status_code}"}
        if body.get("ok"):
            app.logger.info(f"BRRRR skip {pid} OK: deleted_queue={body.get('deleted_queue_rows')} "
                            f"contacts_updated={body.get('contacts_updated')}")
        else:
            app.logger.warning(f"BRRRR skip {pid} FAILED: {body.get('error')}")
    except Exception as e:
        app.logger.warning(f"BRRRR skip {pid} exception: {e}")


def _promote_async(pid: str):
    """Fire-and-forget: call brrrr-promote-to-pipeline in background.

    Runs in a daemon thread so /api/floorplans/review can return 200
    immediately (Hugo: card should jump to Potential tab instantly).
    Comps fetch + DB writes happen on the Supabase side and typically
    take 30-90s; the lead appears in /crm/pipelines + /crm/dialer-pro
    when that completes. Failures are logged only — there's no UI
    surface for the error, so the user can re-click Potential to retry.
    """
    try:
        r = requests.post(
            BRRRR_PROMOTE_URL,
            json={"property_id": pid},
            headers={"x-promote-token": BRRRR_PROMOTE_TOKEN, "Content-Type": "application/json"},
            timeout=BRRRR_PROMOTE_TIMEOUT,
        )
        try:
            body = r.json()
        except Exception:
            body = {"ok": False, "error": f"non-json HTTP {r.status_code}"}
        if body.get("ok"):
            app.logger.info(f"BRRRR promote {pid} OK: comps={body.get('comps_count')} "
                            f"contact={body.get('contact_id')} queue={body.get('queue_id')}")
        else:
            app.logger.warning(f"BRRRR promote {pid} FAILED: {body.get('error')}")
    except Exception as e:
        app.logger.warning(f"BRRRR promote {pid} exception: {e}")


@app.route("/api/floorplans/review", methods=["POST"])
def fp_review():
    """Mark a property as potential / skip.

    When status=potential we also push the lead to the Supabase BRRRR
    pipeline + dialer queue via the brrrr-promote-to-pipeline edge
    function, but that call runs in a background thread so the UI
    returns instantly and the card jumps to the Potential tab right
    away. The lead appears in /crm/pipelines + /crm/dialer-pro 30-90s
    later when the comps fetch + DB writes complete.
    """
    d = request.get_json(force=True)
    pid = d.get("property_id")
    status = d.get("status")
    if not pid or status not in ("potential", "skip"):
        return jsonify({"ok": False, "error": "need property_id and status (potential/skip)"}), 400
    rightmove_storage.set_review(pid, status)

    if status == "potential":
        threading.Thread(target=_promote_async, args=(pid,), daemon=True).start()
    elif status == "skip":
        # Mirror to Supabase: remove pending queue row, mark stage dead,
        # set review skip, drop contact off the BRRRR kanban when they
        # have no remaining potentials.
        threading.Thread(target=_skip_async, args=(pid,), daemon=True).start()

    return jsonify({"ok": True})


@app.route("/api/floorplans/fetch", methods=["POST"])
def fp_fetch():
    if FP_JOB["running"]:
        return jsonify({"ok": False, "error": "already running"}), 400
    d = request.get_json(force=True) or {}
    props = rightmove_storage.properties_without_floorplans()
    if d.get("exclude_auction") or d.get("exclude_tenanted"):
        props = rightmove_storage.filter_properties(
            props,
            exclude_auction=bool(d.get("exclude_auction")),
            exclude_tenanted=bool(d.get("exclude_tenanted")),
        )
    if not props:
        return jsonify({"ok": False, "error": "no properties to fetch floor plans for"}), 400

    pm = ProxyManager(d.get("host", ""), d.get("port", ""),
                      d.get("username", ""), d.get("password", ""),
                      int(d.get("rotate_every") or 25),
                      sticky=bool(d.get("sticky", False)))
    FP_JOB["stop"].clear()
    FP_JOB["pause"].clear()
    fetcher = FloorplanFetcher(
        proxy_mgr=pm,
        emit=emit,
        stop_event=FP_JOB["stop"],
        pause_event=FP_JOB["pause"],
        delay_min=float(d.get("delay_min") or 2),
        delay_max=float(d.get("delay_max") or 4),
        headless=bool(d.get("headless", True)),
    )
    FP_JOB["scraper"] = fetcher

    def _run():
        FP_JOB["running"] = True
        try:
            asyncio.run(fetcher.run(props))
        except Exception as e:
            emit({"type": "log", "level": "error", "msg": f"FP FATAL: {e}"})
            emit({"type": "fp_done"})
        finally:
            FP_JOB["running"] = False

    t = threading.Thread(target=_run, daemon=True)
    FP_JOB["thread"] = t
    t.start()
    return jsonify({"ok": True, "count": len(props)})


@app.route("/api/floorplans/stop", methods=["POST"])
def fp_stop():
    FP_JOB["stop"].set()
    FP_JOB["pause"].clear()
    emit({"type": "log", "level": "warn", "msg": "FP Stop requested."})
    return jsonify({"ok": True})


# ───────────────── Shortlist routes ─────────────────

@app.route("/shortlist")
def shortlist_index():
    return render_template("shortlist.html")


@app.route("/api/shortlist/properties")
def shortlist_properties():
    return jsonify(rightmove_storage.get_shortlist())


@app.route("/api/shortlist/export")
def shortlist_export():
    p = rightmove_storage.export_shortlist_csv()
    return send_file(p, as_attachment=True, download_name=os.path.basename(p))


# ───────────────── Price Comparison routes ─────────────────

@app.route("/comps")
def comps_index():
    return render_template("comps.html")


@app.route("/api/comps/properties")
def comps_properties():
    return jsonify(rightmove_storage.shortlist_with_comps())


@app.route("/api/comps/data/<property_id>")
def comps_data(property_id):
    return jsonify(rightmove_storage.get_comps(property_id))


@app.route("/api/comps/fetch", methods=["POST"])
def comps_fetch():
    if COMP_JOB["running"]:
        return jsonify({"ok": False, "error": "already running"}), 400
    d = request.get_json(force=True) or {}
    props = rightmove_storage.properties_needing_comps()
    if not props:
        return jsonify({"ok": False, "error": "no properties needing comps"}), 400

    pm = ProxyManager(d.get("host", ""), d.get("port", ""),
                      d.get("username", ""), d.get("password", ""),
                      int(d.get("rotate_every") or 25),
                      sticky=bool(d.get("sticky", False)))
    COMP_JOB["stop"].clear()
    COMP_JOB["pause"].clear()
    fetcher = CompsFetcher(
        proxy_mgr=pm,
        emit=emit,
        stop_event=COMP_JOB["stop"],
        pause_event=COMP_JOB["pause"],
        delay_min=float(d.get("delay_min") or 3),
        delay_max=float(d.get("delay_max") or 6),
        headless=bool(d.get("headless", True)),
    )
    COMP_JOB["scraper"] = fetcher

    def _run():
        COMP_JOB["running"] = True
        try:
            asyncio.run(fetcher.run(props))
        except Exception as e:
            emit({"type": "log", "level": "error", "msg": f"COMP FATAL: {e}"})
            emit({"type": "comp_done"})
        finally:
            COMP_JOB["running"] = False

    t = threading.Thread(target=_run, daemon=True)
    COMP_JOB["thread"] = t
    t.start()
    return jsonify({"ok": True, "count": len(props)})


# Synchronous per-property comps fetch. Called from the hub.nfstay.com
# /tinder/comps page via the Supabase Edge Function brrrr-fetch-property-comps.
# Token-gated because the Flask app has no auth.
COMPS_FETCH_TOKEN = _BRRRR_TOKENS["comps_fetch"]


@app.route("/api/comps/fetch-property", methods=["POST"])
def comps_fetch_property():
    # Auth gate
    if request.headers.get("X-Comps-Token") != COMPS_FETCH_TOKEN:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    body = request.get_json(force=True) or {}
    property_id = (body.get("property_id") or "").strip()
    if not property_id:
        return jsonify({"ok": False, "error": "property_id required"}), 400

    # Find the property in rm_listings
    import sqlite3
    with sqlite3.connect(rightmove_storage.DB_PATH) as c:
        c.row_factory = sqlite3.Row
        row = c.execute("""
            SELECT property_id, listing_url, price, price_qualifier, address,
                   bedrooms, property_type
            FROM rm_listings WHERE property_id = ?
        """, (property_id,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": f"property_id {property_id} not in rm_listings"}), 404
        prop = dict(row)

        # Clear any existing comps for this property so we replace, not append
        c.execute("DELETE FROM rm_comps WHERE property_id = ?", (property_id,))

    # Run CompsFetcher synchronously for this one property
    pm = ProxyManager(
        body.get("host", "") or "",
        body.get("port", "") or "",
        body.get("username", "") or "",
        body.get("password", "") or "",
        int(body.get("rotate_every") or 25),
        sticky=bool(body.get("sticky", False)),
    )
    stop_event = threading.Event()
    pause_event = threading.Event()
    fetcher = CompsFetcher(
        proxy_mgr=pm,
        emit=lambda e: None,  # silent — caller doesn't subscribe to SSE
        stop_event=stop_event,
        pause_event=pause_event,
        delay_min=float(body.get("delay_min") or 1),
        delay_max=float(body.get("delay_max") or 2),
        headless=True,
    )

    try:
        asyncio.run(fetcher.run([prop]))
    except Exception as e:
        return jsonify({"ok": False, "error": f"Comps fetch failed: {e}"}), 500

    # Read the freshly-stored comps for this property and return them
    comps = rightmove_storage.get_comps(property_id)
    return jsonify({"ok": True, "property_id": property_id, "count": len(comps), "comps": comps})


@app.route("/api/comps/stop", methods=["POST"])
def comps_stop():
    COMP_JOB["stop"].set()
    COMP_JOB["pause"].clear()
    emit({"type": "log", "level": "warn", "msg": "Comps Stop requested."})
    return jsonify({"ok": True})


# ───────────────── Valuation engine (research-backed, TDD) ─────────────────
# Replaces the broken client-side offer maths (offers were 70-75% of GDV with
# a default £250/sqft — producing offers ABOVE asking). See valuation.py.

@app.route("/api/valuation/<property_id>")
def property_valuation(property_id):
    listing = rightmove_storage.get_listing(property_id)
    if not listing:
        return jsonify({"ok": False, "error": "property not found"}), 404
    comps = rightmove_storage.get_comps(property_id)
    result = valuation.value_property(listing, comps)
    result["ok"] = True
    return jsonify(result)


@app.route("/api/valuation/batch")
def valuation_batch():
    """Light verdict map for the whole shortlist — powers the Comps tab's
    'hide no-evidence' filter and per-card verdict badges in one round trip."""
    out = {}
    for p in rightmove_storage.shortlist_with_comps():
        pid = p.get("property_id")
        try:
            listing = rightmove_storage.get_listing(pid) or p
            v = valuation.value_property(listing, p.get("comps") or [])
            offer = v.get("offer") or {}
            out[pid] = {
                "pursue": v.get("pursue"),
                "verdict": offer.get("verdict"),
                "has_offer": offer.get("max") is not None,
            }
        except Exception as e:
            out[pid] = {"pursue": None, "verdict": None, "has_offer": False, "error": str(e)}
    return jsonify(out)


# ───────────────── Elsie integration (BRRR qualifier) ─────────────────
# "Send to Elsie" pushes one approved property (listing + agent phone +
# comps + the deal-calculator numbers) into Elsie's admin Properties tab,
# where the AI voice agent can ring the listing agent and qualify it.
# Separate from the BRRRR promote flow above — explicit button, not
# automatic on 'potential'. Secret lives in env or data/elsie.json, not code.

def _elsie_config():
    url = os.environ.get("ELSIE_INGEST_URL", "")
    secret = os.environ.get("ELSIE_INGEST_SECRET", "")
    if not url or not secret:
        try:
            with open(os.path.join(os.path.dirname(__file__), "data", "elsie.json")) as f:
                cfg = json.load(f)
            url = url or cfg.get("url", "")
            secret = secret or cfg.get("secret", "")
        except Exception:
            pass
    return (url or "https://app.heyelsie.com").rstrip("/"), secret


@app.route("/api/elsie/send", methods=["POST"])
def elsie_send():
    d = request.get_json(force=True) or {}
    pid = d.get("property_id")
    if not pid:
        return jsonify({"ok": False, "error": "property_id required"}), 400
    listing = rightmove_storage.get_listing(pid)
    if not listing:
        return jsonify({"ok": False, "error": "property not found"}), 404

    base_url, secret = _elsie_config()
    if not secret:
        return jsonify({"ok": False, "error": "Elsie secret missing — add data/elsie.json"}), 500

    payload = {
        "source": "rightmove",
        "property_id": pid,
        "listing_url": listing.get("listing_url"),
        "address": listing.get("address"),
        "price": listing.get("price"),
        "price_qualifier": listing.get("price_qualifier"),
        "bedrooms": listing.get("bedrooms"),
        "property_type": listing.get("property_type"),
        "floor_area_sqm": listing.get("floor_area_sqm"),
        "floor_area_sqft": listing.get("floor_area_sqft"),
        "days_on_market": listing.get("days_on_market"),
        "agent_name": listing.get("agent_name"),
        "agent_phone": listing.get("agent_phone"),
        "agent_branch_url": listing.get("agent_branch_url"),
        "floorplans": [f["image_url"] for f in rightmove_storage.get_floorplans(pid)],
        "comps": rightmove_storage.get_comps(pid),
        "deal": d.get("deal") or {},
    }
    try:
        r = requests.post(f"{base_url}/api/properties/ingest", json=payload,
                          headers={"x-ingest-secret": secret}, timeout=30)
        try:
            body = r.json()
        except Exception:
            body = {}
        ok = r.status_code == 200 and body.get("ok")
        err = "" if ok else (body.get("error") or f"HTTP {r.status_code}")
        rightmove_storage.set_elsie_sent(pid, bool(ok), err)
        if not ok:
            return jsonify({"ok": False, "error": err}), 502
        return jsonify({"ok": True})
    except Exception as e:
        rightmove_storage.set_elsie_sent(pid, False, str(e))
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/api/elsie/sent")
def elsie_sent():
    return jsonify(rightmove_storage.get_elsie_sent_map())


# ───────────────── Email/form enquiry (alternative to calling) ─────────────────
# Instead of Elsie ringing the agent, fill the property's Rightmove enquiry
# form as a genuine cash-buyer enquiry asking the agent to call us back. The
# callback then lands on the inbound line (ask for Elsie = property). One at a
# time, human-paced. dry_run fills + screenshots but never submits.
def _enquiry_proxy():
    """Same residential setup as the scrapers; empty host = direct (home IP)."""
    try:
        with open(os.path.join(os.path.dirname(__file__), "data", "config.json")) as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    return ProxyManager(cfg.get("host", ""), cfg.get("port", ""),
                        cfg.get("username", ""), cfg.get("password", ""),
                        int(cfg.get("rotate_every") or 25),
                        sticky=bool(cfg.get("sticky", False)))


ENQUIRY_JOB = {"running": False}


@app.route("/api/elsie/enquire", methods=["POST"])
def elsie_enquire():
    if ENQUIRY_JOB["running"]:
        return jsonify({"ok": False, "error": "an enquiry is already in progress"}), 409
    d = request.get_json(force=True) or {}
    pid = d.get("property_id")
    if not pid:
        return jsonify({"ok": False, "error": "property_id required"}), 400
    listing = rightmove_storage.get_listing(pid)
    if not listing:
        return jsonify({"ok": False, "error": "property not found"}), 404

    captcha_key, contact = load_enquiry_config()
    dry_run = bool(d.get("dry_run", True))
    if not dry_run and not captcha_key:
        return jsonify({"ok": False,
                        "error": "captcha key missing — add data/enquiry.json"}), 500

    property_row = {
        "property_id": pid,
        "listing_url": listing.get("listing_url"),
        "address": listing.get("address"),
    }
    # Headed by default for live sends: a visible browser window opens on the
    # Mac so Hugo can finish the Arkose "Security Verification" puzzle (the form
    # is auto-filled; he just taps the puzzle). dry-runs stay headless.
    headless = bool(d.get("headless", dry_run))
    auto_solve = bool(d.get("auto_solve", False))  # 2captcha can't crack Rightmove Arkose yet
    filler = EnquiryFiller(_enquiry_proxy(), contact, captcha_key,
                           emit=emit, dry_run=dry_run, headless=headless,
                           auto_solve=auto_solve)

    ENQUIRY_JOB["running"] = True
    try:
        result = asyncio.run(filler.enquire(property_row))
    except Exception as e:
        ENQUIRY_JOB["running"] = False
        return jsonify({"ok": False, "error": str(e)}), 500
    ENQUIRY_JOB["running"] = False

    # Only a real (non-dry-run) success marks the property as enquired.
    rightmove_storage.set_elsie_enquired(pid, result.ok, result.dry_run, result.error or "")
    return jsonify({"ok": result.ok, **result.to_dict()}), (200 if result.ok else 502)


@app.route("/api/elsie/enquired")
def elsie_enquired():
    return jsonify(rightmove_storage.get_elsie_enquired_map())


if __name__ == "__main__":
    storage.init_db()
    facebook_storage.init_db()
    rightmove_storage.init_db()
    app.run(host="127.0.0.1", port=5001, debug=False, threaded=True)


@app.route("/api/rightmove/status", methods=["GET"])
def rm_status_endpoint():
    """Light status probe used by the autopilot to know when the daily
    Rightmove scrape has finished so it can chain into the floor-plan
    fetcher. Returns the live RM_JOB flags without holding any locks."""
    return jsonify({
        "running": bool(RM_JOB["running"]),
        "paused": bool(RM_JOB["pause"].is_set()),
        "stopping": bool(RM_JOB["stop"].is_set()),
    })


@app.route("/api/floorplans/status", methods=["GET"])
def fp_status_endpoint():
    """Same idea as rm_status_endpoint but for the FloorplanFetcher."""
    return jsonify({
        "running": bool(FP_JOB["running"]),
        "paused": bool(FP_JOB["pause"].is_set()),
        "stopping": bool(FP_JOB["stop"].is_set()),
    })
