"""Supabase access for the OpenRent worker (service-role). Engine logic lives in
worker.py; this module is just typed-ish helpers over the tables."""
from __future__ import annotations
import json
import re
import unicodedata
import datetime as dt
from supabase import create_client, Client

DEFAULT_SETTINGS = {
    "enabled": False,
    "run_times": ["09:30"],
    "rescrape_every_min": 30,
    "scrape_window_min": 15,
    "gap_between_sends_min": 4,
    "gap_jitter_min": 3,
    "blacklist_days": 30,
    "only_listings_newer_than_days": 3,
    "reply_delay_seconds": 60,
    "reply_auto_send": False,
    "max_sends_per_run": 2,
    "outreach_prompt": "",
    "reply_prompt": "",
    # ── Phase 2: persona account creation (mirror api/lib/openrent.ts) ──
    "account_creation_enabled": False,   # OFF by default — ToS-sensitive, opt-in only
    "accounts_per_domain_per_day": 2,
    "persona_first_name": "Maria",
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def landlord_key(name: str | None) -> str:
    """Normalise a landlord name for blacklist matching (mirror api/lib/openrent.ts)."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


class DB:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.sb: Client = create_client(cfg["supabase_url"], cfg["supabase_service_role_key"])

    # ── settings ──
    def get_settings(self) -> dict:
        try:
            r = self.sb.table("platform_settings").select("value").eq("key", "openrent_settings").maybe_single().execute()
            val = (r.data or {}).get("value") if r and r.data else None
        except Exception:
            val = None
        s = dict(DEFAULT_SETTINGS)
        if val:
            try:
                s.update(json.loads(val))
            except Exception:
                pass
        return s

    # ── log ──
    def log(self, business_id, event, message="", level="info", account_id=None, meta=None):
        try:
            self.sb.table("openrent_activity_log").insert({
                "business_id": business_id, "event": event, "message": message,
                "level": level, "account_id": account_id, "meta": meta or {},
            }).execute()
        except Exception as e:  # noqa: BLE001
            print(f"[log] {event}: {message} ({e})")

    # ── accounts ──
    def accounts(self) -> list[dict]:
        accs = self.sb.table("openrent_accounts").select("*").order("rotation_order").execute().data or []
        secs = self.sb.table("openrent_account_secrets").select("*").execute().data or []
        secmap = {s["account_id"]: s for s in secs}
        for a in accs:
            sec = secmap.get(a["id"], {})
            a["password"] = sec.get("password_enc")
            a["proxy"] = sec.get("proxy_session")
        return accs

    def update_account(self, account_id, patch):
        self.sb.table("openrent_accounts").update(patch).eq("id", account_id).execute()

    # ── Phase 2: persona account creation ──
    def active_domains(self, business_id) -> list[dict]:
        """Connected catch-all domains that can receive confirmation email."""
        return (self.sb.table("openrent_domains").select("*")
                .eq("business_id", business_id).eq("status", "active")
                .order("created_at").execute().data or [])

    def auto_accounts_created_today(self, business_id, domain_id, today_start_iso) -> int:
        """How many persona accounts were auto-created on this domain since the
        start of today (UTC). Used for the per-domain/day cap."""
        r = (self.sb.table("openrent_accounts").select("id")
             .eq("business_id", business_id).eq("domain_id", domain_id)
             .eq("auto_created", True).gte("created_at", today_start_iso)
             .execute())
        return len(r.data or [])

    def account_email_exists(self, business_id, email) -> bool:
        r = (self.sb.table("openrent_accounts").select("id")
             .eq("business_id", business_id).eq("email", email)
             .limit(1).execute())
        return bool(r.data)

    def create_account(self, business_id, domain_id, label, email, password,
                       proxy_base, persona, rotation_order=None) -> str | None:
        """Insert a persona account (status 'pending_confirm') + its secrets
        (password + the REUSED sticky proxy base string). Returns the new
        account id, or None if the email already exists. The worker pins this
        account to its own sticky IP via flashproxy.parse_proxy(base, sticky_id=id)."""
        if self.account_email_exists(business_id, email):
            return None
        # Slot the new account at the END of the rotation (max existing + 1) unless
        # an explicit order was given, so auto-created accounts don't all pile onto
        # order 0 and break the rotation ordering.
        if rotation_order is None:
            last = (self.sb.table("openrent_accounts").select("rotation_order")
                    .eq("business_id", business_id)
                    .order("rotation_order", desc=True).limit(1).execute().data or [])
            rotation_order = ((last[0].get("rotation_order") or 0) + 1) if last else 0
        r = self.sb.table("openrent_accounts").insert({
            "business_id": business_id,
            "label": label,
            "email": email,
            "status": "pending_confirm",
            "domain_id": domain_id,
            "persona": persona,
            "auto_created": True,
            "session_valid": False,
            "rotation_order": rotation_order,
        }).execute()
        acc_id = r.data[0]["id"]
        # Store the BASE proxy string (no -session- yet); the worker appends the
        # sticky session id per account at runtime via flashproxy.parse_proxy.
        self.sb.table("openrent_account_secrets").insert({
            "account_id": acc_id,
            "password_enc": password,
            "proxy_session": proxy_base,
        }).execute()
        return acc_id

    # ── on-demand account-creation requests (the "Create N now" button) ──
    def pending_account_requests(self) -> list[dict]:
        """On-demand requests the user fired from the Emails tab, oldest first so
        we drain them FIFO. Each row: requested / created / domain_id (null = all
        active domains)."""
        return (self.sb.table("openrent_account_requests").select("*")
                .eq("status", "pending").order("created_at").execute().data or [])

    def bump_request_created(self, request_id, n=1):
        """Increment a request's created counter by n (read-modify-write; the
        worker is the only writer, so no contention)."""
        cur = (self.sb.table("openrent_account_requests").select("created")
               .eq("id", request_id).maybe_single().execute().data) or {}
        new_val = (cur.get("created") or 0) + n
        self.sb.table("openrent_account_requests").update(
            {"created": new_val}).eq("id", request_id).execute()

    def mark_request_done(self, request_id):
        self.sb.table("openrent_account_requests").update(
            {"status": "done"}).eq("id", request_id).execute()

    def account_with_secret(self, account_id) -> dict | None:
        """One account row joined with its secret (password + proxy base)."""
        a = (self.sb.table("openrent_accounts").select("*")
             .eq("id", account_id).maybe_single().execute().data)
        if not a:
            return None
        sec = (self.sb.table("openrent_account_secrets").select("*")
               .eq("account_id", account_id).maybe_single().execute().data) or {}
        a["password"] = sec.get("password_enc")
        a["proxy"] = sec.get("proxy_session")
        return a

    def pending_confirm_accounts(self) -> list[dict]:
        """Persona accounts awaiting email confirmation (with secrets attached)."""
        accs = (self.sb.table("openrent_accounts").select("*")
                .eq("status", "pending_confirm").eq("auto_created", True)
                .execute().data or [])
        if not accs:
            return []
        secs = self.sb.table("openrent_account_secrets").select("*").execute().data or []
        secmap = {s["account_id"]: s for s in secs}
        for a in accs:
            sec = secmap.get(a["id"], {})
            a["password"] = sec.get("password_enc")
            a["proxy"] = sec.get("proxy_session")
        return accs

    # ── received catch-all emails (confirmation links) ──
    def received_emails_for(self, business_id, to_email, since_iso=None) -> list[dict]:
        """Catch-all emails addressed to a specific persona address (newest first)."""
        q = (self.sb.table("openrent_received_emails").select("*")
             .eq("business_id", business_id).eq("to_email", to_email))
        if since_iso:
            q = q.gte("created_at", since_iso)
        return q.order("created_at", desc=True).limit(20).execute().data or []

    def mark_email_used(self, email_id, used_for):
        self.sb.table("openrent_received_emails").update(
            {"status": "used", "used_for": used_for}).eq("id", email_id).execute()

    def security_emails(self) -> list[dict]:
        """Unprocessed emails from OpenRent's security address (e.g. account-locked
        notices). Used to flag the matching account for human review."""
        return (self.sb.table("openrent_received_emails").select("*")
                .ilike("from_email", "%security@openrent.co.uk%")
                .eq("status", "new").order("created_at").limit(50).execute().data or [])

    def account_by_email(self, business_id, email) -> dict | None:
        if not email:
            return None
        r = (self.sb.table("openrent_accounts").select("id,label,business_id")
             .eq("business_id", business_id).eq("email", email)
             .maybe_single().execute())
        return r.data if r else None

    # ── source URLs / targets ──
    def source_urls(self, business_id) -> list[dict]:
        return self.sb.table("openrent_source_urls").select("*").eq("business_id", business_id).eq("active", True).execute().data or []

    def target_exists(self, business_id, external_listing_id):
        r = self.sb.table("openrent_targets").select("id,status").eq("business_id", business_id).eq("external_listing_id", external_listing_id).maybe_single().execute()
        return r.data if r else None

    def upsert_target(self, row: dict):
        self.sb.table("openrent_targets").upsert(row, on_conflict="business_id,external_listing_id").execute()

    def ready_targets(self, business_id, limit=50) -> list[dict]:
        return self.sb.table("openrent_targets").select("*").eq("business_id", business_id).eq("status", "ready").order("created_at").limit(limit).execute().data or []

    def claim_target(self, target_id) -> bool:
        r = self.sb.table("openrent_targets").update({"status": "contacting"}).eq("id", target_id).eq("status", "ready").execute()
        return bool(r.data)

    def set_target(self, target_id, patch):
        self.sb.table("openrent_targets").update(patch).eq("id", target_id).execute()

    # ── blacklist ──
    def blacklist_active(self, business_id, key) -> bool:
        if not key:
            return False
        r = self.sb.table("openrent_blacklist").select("id").eq("business_id", business_id).eq("landlord_key", key).gt("blacklist_until", now_iso()).limit(1).execute()
        return bool(r.data)

    def add_blacklist(self, business_id, key, name, days, account_id=None, target_id=None):
        until = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).isoformat()
        self.sb.table("openrent_blacklist").insert({
            "business_id": business_id, "landlord_key": key, "landlord_name": name,
            "blacklist_until": until, "account_id": account_id, "target_id": target_id,
        }).execute()

    # ── contacts / conversations / messages (REUSED inbox tables) ──
    def get_or_create_contact(self, business_id, name, phone=None, email=None) -> str:
        existing = None
        if phone:
            existing = self.sb.table("contacts").select("id").eq("business_id", business_id).eq("phone", phone).maybe_single().execute().data
        if not existing and email:
            existing = self.sb.table("contacts").select("id").eq("business_id", business_id).eq("email", email).maybe_single().execute().data
        if existing:
            return existing["id"]
        r = self.sb.table("contacts").insert({"business_id": business_id, "name": name, "phone": phone, "email": email}).execute()
        return r.data[0]["id"]

    def find_conversation(self, business_id, external_thread_id):
        if not external_thread_id:
            return None
        r = self.sb.table("conversations").select("id,ai_handling,openrent_account_id").eq("business_id", business_id).eq("external_thread_id", external_thread_id).maybe_single().execute()
        return r.data if r else None

    def create_conversation(self, business_id, contact_id, account_id, external_thread_id, preview) -> str:
        r = self.sb.table("conversations").insert({
            "business_id": business_id, "contact_id": contact_id, "channel": "openrent",
            "openrent_account_id": account_id, "external_thread_id": external_thread_id,
            "status": "open", "ai_handling": True, "last_message_at": now_iso(),
            "last_message_preview": (preview or "")[:160] or None,
        }).execute()
        return r.data[0]["id"]

    def message_exists(self, conversation_id, external_id) -> bool:
        if not external_id:
            return False
        r = self.sb.table("messages").select("id").eq("conversation_id", conversation_id).eq("external_id", external_id).limit(1).execute()
        return bool(r.data)

    def add_message(self, conversation_id, direction, sender, body, status="sent", external_id=None, meta=None, bump_unread=False):
        self.sb.table("messages").insert({
            "conversation_id": conversation_id, "direction": direction, "sender": sender,
            "content_type": "text", "body": body, "status": status, "external_id": external_id,
            "metadata": meta or {"via": "openrent"},
        }).execute()
        patch = {"last_message_at": now_iso(), "last_message_preview": (body or "")[:160]}
        if bump_unread:
            cur = self.sb.table("conversations").select("unread_count").eq("id", conversation_id).maybe_single().execute()
            patch["unread_count"] = ((cur.data or {}).get("unread_count", 0) if cur else 0) + 1
        self.sb.table("conversations").update(patch).eq("id", conversation_id).execute()

    def thread_messages(self, conversation_id) -> list[dict]:
        return self.sb.table("messages").select("direction,sender,body,created_at").eq("conversation_id", conversation_id).order("created_at").execute().data or []

    def queued_outbound(self, limit=10) -> list[dict]:
        msgs = self.sb.table("messages").select("id,conversation_id,body").eq("status", "queued").limit(limit).execute().data or []
        out = []
        for m in msgs:
            conv = self.sb.table("conversations").select("id,business_id,channel,external_thread_id,openrent_account_id").eq("id", m["conversation_id"]).maybe_single().execute().data
            if conv and conv.get("channel") == "openrent":
                m["conversation"] = conv
                out.append(m)
        return out

    def claim_message(self, message_id) -> bool:
        r = self.sb.table("messages").update({"status": "sending"}).eq("id", message_id).eq("status", "queued").execute()
        return bool(r.data)

    def mark_message(self, message_id, status):
        self.sb.table("messages").update({"status": status}).eq("id", message_id).execute()
