"""iProyal residential proxy rotation + health check.

iProyal residential format puts options on the PASSWORD, not the username:
    username: <your_username>
    password: <your_password>_country-us_session-<token>_lifetime-30m

If the user already includes `_session-` or `_country-` in either field,
we pass everything through verbatim (assume they know what they want).
"""
from __future__ import annotations
import requests, random, string, urllib.parse


class ProxyManager:
    def __init__(self, host="", port="", username="", password="",
                 rotate_every=25, sticky=False):
        self.host = (host or "").strip()
        self.port = str(port or "").strip()
        self.username = (username or "").strip()
        self.password = (password or "").strip()
        self.rotate_every = max(1, int(rotate_every or 25))
        self.sticky = bool(sticky)
        self._session_token = self._new_token()
        self._counter = 0
        self.label = "direct"
        self._refresh_label()

    @property
    def enabled(self) -> bool:
        return bool(self.host and self.port and self.username and self.password)

    def _new_token(self) -> str:
        return "".join(random.choices(string.ascii_lowercase + string.digits, k=10))

    def _refresh_label(self):
        if not self.enabled:
            self.label = "direct"
        elif self.sticky and not self._user_supplied_session():
            self.label = f"{self.host}:{self.port} (sess {self._session_token})"
        else:
            self.label = f"{self.host}:{self.port}"

    def _user_supplied_session(self) -> bool:
        """True only if the user already pinned a session token.
        `_country-` / `_city-` are independent options and don't count."""
        return ("_session-" in self.username) or ("_session-" in self.password)

    def _password_with_session(self) -> str:
        """Append _session-<token> to password unless user opts out / already has one."""
        if not self.sticky or self._user_supplied_session():
            return self.password
        return f"{self.password}_session-{self._session_token}"

    # URL-encode user/password so special chars don't break the http://u:p@h:p form.
    def proxy_url(self) -> str | None:
        if not self.enabled:
            return None
        u = urllib.parse.quote(self.username, safe="")
        p = urllib.parse.quote(self._password_with_session(), safe="")
        return f"http://{u}:{p}@{self.host}:{self.port}"

    def playwright_proxy(self) -> dict | None:
        if not self.enabled:
            return None
        return {
            "server": f"http://{self.host}:{self.port}",
            "username": self.username,
            "password": self._password_with_session(),
        }

    def tick(self) -> bool:
        """Increment counter; rotate if threshold hit. Returns True if rotated."""
        self._counter += 1
        if self._counter >= self.rotate_every:
            self.rotate()
            return True
        return False

    def rotate(self):
        self._session_token = self._new_token()
        self._counter = 0
        self._refresh_label()

    def test(self, connect_timeout=8, read_timeout=20) -> dict:
        # (connect, read) tuple → fail fast if proxy never opens the tunnel.
        t = (connect_timeout, read_timeout)
        if not self.enabled:
            try:
                r = requests.get("https://api.ipify.org?format=json", timeout=t)
                return {"ok": True, "ip": r.json().get("ip"), "country": "", "via": "direct"}
            except Exception as e:
                return {"ok": False, "error": str(e), "via": "direct"}
        url = self.proxy_url()
        # Mask password but show whether _session- got appended
        sent_pwd = self._password_with_session()
        masked = f"{self.username}:{sent_pwd[:3]}***{('_session-' + self._session_token) if '_session-' in sent_pwd and self.sticky else ''}@{self.host}:{self.port}"
        proxies = {"http": url, "https": url}
        try:
            r = requests.get("https://api.ipify.org?format=json",
                             proxies=proxies, timeout=t)
            r.raise_for_status()
            ip = r.json().get("ip")
            country = ""
            try:
                rc = requests.get(f"http://ip-api.com/json/{ip}",
                                  proxies=proxies, timeout=t)
                country = rc.json().get("country", "")
            except Exception:
                pass
            return {"ok": True, "ip": ip, "country": country,
                    "via": self.label, "sent": masked}
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}",
                    "via": self.label, "sent": masked}
