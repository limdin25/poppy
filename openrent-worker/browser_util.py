"""Resilient navigation + self-healing helpers for the OpenRent worker.

Dependency-free on purpose (no Playwright import) so it unit-tests without a real
browser. The engine (worker.py) and the per-site modules use these so a flaky
proxy/IP can NEVER permanently wedge an account:

  * nav()        — page.goto with a generous timeout + retry (a single timeout is
                   almost always transient; retry usually succeeds).
  * heal_action()— graduated decision from the consecutive-failure count: do
                   nothing / rebuild the browser session / rebuild + re-login.

Before this, a stuck browser tab was reused on every tick forever (the bug that
left an account stuck on "Inbox read failed: Timeout 30000ms").
"""
from __future__ import annotations
import time

# A proxied OpenRent page load is slower than a direct one; give it room before
# we call it a failure, and retry once — the first hit through a cold proxy
# tunnel often times out while the retry goes straight through.
DEFAULT_NAV_TIMEOUT_MS = 45000
DEFAULT_ATTEMPTS = 2
HEAL_THRESHOLD = 2  # consecutive failures before we rebuild a wedged session


def nav(page, url, *, wait_until="domcontentloaded",
        timeout_ms=DEFAULT_NAV_TIMEOUT_MS, attempts=DEFAULT_ATTEMPTS,
        backoff_s=1.5, sleep=time.sleep):
    """page.goto(url) with retries. Returns the goto result on success; re-raises
    the LAST exception only if every attempt fails. `sleep` is injectable so tests
    run instantly."""
    attempts = max(1, int(attempts))
    last = None
    for i in range(attempts):
        try:
            return page.goto(url, wait_until=wait_until, timeout=timeout_ms)
        except Exception as e:  # noqa: BLE001 — retry any nav error (timeout, net)
            last = e
            if i + 1 < attempts:
                sleep(backoff_s * (i + 1))
    raise last


def heal_action(fail_count, threshold=HEAL_THRESHOLD):
    """What to do given how many times in a row this account's browser ops have
    failed:

      < threshold        -> 'none'    (transient — just let the next tick retry)
      threshold .. 2t-1  -> 'recycle' (rebuild browser+proxy, KEEP cookies)
      >= 2*threshold     -> 'reset'   (rebuild AND drop the saved session → full
                                       re-login; handles an expired/dead session)
    """
    threshold = max(1, int(threshold))
    if fail_count < threshold:
        return "none"
    if fail_count < threshold * 2:
        return "recycle"
    return "reset"
