"""One-off maintenance: for EVERY OpenRent account —
  1. verify the password (log in with the stored password; if wrong, try the other
     known passwords to find the one OpenRent actually accepts),
  2. set the profile First name (+ Surname) on /account/edit (the blank-name fix),
  3. correct the stored password in the DB to whatever actually works,
  4. refresh the saved session.
Each account runs through its OWN sticky FlashProxy IP (never Hugo's IP). Gentle:
stored password first (usually 1 attempt), stop immediately on a security lock,
sequential with sleeps. Accounts where NO known password works are reported for a
manual Kimi password reset (Step 7).

  .venv/bin/python backfill_profile_names.py                 # DRY-RUN (no writes)
  .venv/bin/python backfill_profile_names.py --apply          # set names + fix passwords + stamp
  .venv/bin/python backfill_profile_names.py --email <addr> [--apply]   # one account
"""
import random
import sys
import time

from playwright.sync_api import sync_playwright

import browser_util
import flashproxy
import openrent_login
import openrent_signup
from worker import load_config, Sessions, resolve_profile_name, DEFAULT_ACCOUNT_PASSWORD
from db import DB, now_iso

# Passwords this fleet has used over time (newest standard first). Per account we
# try the stored one first, then these — first that logs in wins.
KNOWN_PASSWORDS = [DEFAULT_ACCOUNT_PASSWORD, "Maria!Lets2026", "Dgs58913347."]


def candidates(stored):
    seen, out = set(), []
    for p in [stored] + KNOWN_PASSWORDS:
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def main():
    apply = "--apply" in sys.argv
    only = sys.argv[sys.argv.index("--email") + 1] if "--email" in sys.argv else None
    cfg = load_config()
    db = DB(cfg)
    settings = db.get_settings()
    accs = db.accounts()
    if only:
        accs = [a for a in accs if a.get("email") == only]
    print(f"=== profile-name + password backfill [{'APPLY' if apply else 'DRY-RUN'}] — {len(accs)} account(s) ===\n")

    b = {k: [] for k in ("named", "already", "no_source", "name_failed",
                         "no_access", "locked", "pw_fixed", "skipped")}

    with sync_playwright() as pw:
        sessions = Sessions(pw, cfg, db)
        base = sessions._active_base()
        try:
            for a in accs:
                email = a.get("email")
                label = a.get("label") or email
                if a.get("status") == "disabled":
                    b["skipped"].append(f"{email} (disabled)")
                    continue
                first, last = resolve_profile_name(a, settings)
                if not first:
                    b["no_source"].append(email)
                    if apply:
                        db.update_account(a["id"], {"profile_name_set_at": now_iso()})
                    print(f"• {email}: NO NAME SOURCE — skip & report")
                    continue

                stored = a.get("password")
                proxy = flashproxy.parse_proxy(base, sticky_id=a["id"])
                browser = pw.chromium.launch(headless=cfg.get("headless", True), proxy=proxy)
                working_pw = None
                locked = False
                last_kind = None
                page = None
                try:
                    for cand in candidates(stored):
                        ctx = browser.new_context()
                        p = ctx.new_page()
                        try:
                            openrent_login.login(p, email, cand)
                            working_pw, page = cand, p
                            break
                        except openrent_login.LoginError as e:
                            last_kind = getattr(e, "kind", "unknown")
                            ctx.close()
                            if last_kind == openrent_login.KIND_LOCKED:
                                locked = True
                                break
                            time.sleep(3)
                        except Exception:  # nav/proxy blip
                            last_kind = "network"
                            ctx.close()
                            time.sleep(3)

                    if locked:
                        b["locked"].append(email)
                        print(f"• {email}: 🔒 LOCKED for security — stop (needs reset/wait)")
                        continue
                    if not working_pw:
                        b["no_access"].append(f"{email} ({last_kind})")
                        print(f"• {email}: ❌ no known password works ({last_kind}) — needs Kimi reset")
                        continue

                    pw_fixed = working_pw != stored
                    if pw_fixed:
                        b["pw_fixed"].append(f"{email} → {working_pw}")

                    if apply:
                        status = openrent_signup.ensure_profile_name(page, first, last)
                    else:
                        browser_util.nav(page, openrent_signup.EDIT_PROFILE_URL)
                        page.wait_for_timeout(600)
                        cur = openrent_signup._read_value(page, openrent_signup.FIRST_NAME_SELS)
                        status = (openrent_signup.NAME_ALREADY_SET
                                  if (cur or "").casefold() == first.casefold() else "would-set")

                    if status == openrent_signup.NAME_ALREADY_SET:
                        b["already"].append(email)
                    elif status in (openrent_signup.NAME_SET, "would-set"):
                        b["named"].append(f"{email} → {first} {last}".strip())
                    else:
                        b["name_failed"].append(f"{email} ({status})")

                    tag = "stored OK" if not pw_fixed else f"pw FIXED→{working_pw}"
                    print(f"• {email}: {tag} | name {status} → {(first + ' ' + last).strip()}")

                    if apply:
                        try:
                            page.context.storage_state(path=sessions._state(a))
                        except Exception:
                            pass
                        patch = {"session_valid": True, "status": "live", "login_attempts": 0,
                                 "next_login_attempt_at": None, "failure_kind": None,
                                 "needs_human": False, "last_error": None, "last_login_at": now_iso()}
                        if status in (openrent_signup.NAME_SET, openrent_signup.NAME_ALREADY_SET):
                            patch["profile_name_set_at"] = now_iso()
                        db.update_account(a["id"], patch)
                        if pw_fixed:
                            db.sb.table("openrent_account_secrets").update(
                                {"password_enc": working_pw, "updated_at": now_iso()}
                            ).eq("account_id", a["id"]).execute()
                            db.log(a["business_id"], "password-fixed",
                                   f"{label}: stored password corrected (login now works)", account_id=a["id"])
                        if status in (openrent_signup.NAME_SET, openrent_signup.NAME_ALREADY_SET):
                            db.log(a["business_id"], "profile-name-set",
                                   f"{label}: profile name → {(first + ' ' + last).strip()} ({status})",
                                   account_id=a["id"])
                finally:
                    browser.close()
                time.sleep(random.randint(4, 8))
        finally:
            sessions.close()

    def show(title, key):
        print(f"\n{title} ({len(b[key])}):")
        for it in b[key]:
            print(f"   {it}")

    sfx = "" if apply else " (would)"
    print("\n\n================= REPORT =================")
    show(f"✅ Name set{sfx}", "named")
    show("⏭️  Already named", "already")
    show(f"🔑 Stored password was WRONG — corrected{sfx}", "pw_fixed")
    show("📝 No name source — set manually (legacy gmail)", "no_source")
    show("❌ No known password works — needs Kimi reset", "no_access")
    show("🔒 Locked for security — wait / reset", "locked")
    show("⚠️  Name write failed (will retry)", "name_failed")
    show("➖ Skipped (disabled)", "skipped")
    print("=========================================")


if __name__ == "__main__":
    main()
