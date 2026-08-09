/* Agency Admin shared runtime. Plain JS, no modules, no network. */
/* Pages register themselves on window.Pages[key] = { render(root, param), css? } */

window.Pages = {};

/* ---------------- DOM helper ---------------- */
function h(tag, attrs) {
  var el = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (v === null || v === undefined || v === false) return;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
    else el.setAttribute(k, v);
  });
  for (var i = 2; i < arguments.length; i++) appendChild(el, arguments[i]);
  return el;
}
function appendChild(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { child.forEach(function (c) { appendChild(el, c); }); return; }
  if (typeof child === "string" || typeof child === "number") { el.appendChild(document.createTextNode(String(child))); return; }
  el.appendChild(child);
}

function uid() { return "id" + Math.random().toString(36).slice(2, 9); }

/* localStorage can be unavailable in sandboxed embeds; the app must not crash there */
function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { } }

/* ---------------- formatting ---------------- */
function fmtMoney(n) {
  if (n === null || n === undefined) return "";
  var neg = n < 0; n = Math.abs(Math.round(n));
  var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-$" : "$") + s;
}
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  var d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}
function fmtDateShort(iso) {
  if (!iso) return "";
  var d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return MONTHS[d.getMonth()] + " " + d.getDate();
}
function monthLabel(iso) {
  var d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return MONTHS[d.getMonth()];
}
function timeAgo(iso) {
  var now = new Date(DB.TODAY + "T10:00:00");
  var then = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  var mins = Math.max(1, Math.round((now - then) / 60000));
  if (mins < 60) return mins + "m ago";
  var hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  var days = Math.round(hrs / 24);
  if (days < 30) return days + "d ago";
  return fmtDateShort(iso);
}
function daysSince(iso) {
  var now = new Date(DB.TODAY + "T00:00:00");
  var then = new Date(iso + "T00:00:00");
  return Math.floor((now - then) / 86400000);
}

/* ---------------- icons ---------------- */
function icon(paths, extra) {
  return '<svg viewBox="0 0 24 24" fill="' + (extra && extra.fill ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>";
}
var Icons = {
  dashboard: icon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>'),
  money: icon('<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  clients: icon('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  calendar: icon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  leads: icon('<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>'),
  ideation: icon('<path d="M9 18h6M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/>'),
  thumbnails: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  analytics: icon('<path d="M18 20V10M12 20V4M6 20v-6"/>'),
  team: icon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  onboarding: icon('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>'),
  settings: icon('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  search: icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  chevronDown: icon('<path d="m6 9 6 6 6-6"/>'),
  chevronRight: icon('<path d="m9 18 6-6-6-6"/>'),
  chevronLeft: icon('<path d="m15 18-6-6 6-6"/>'),
  download: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>'),
  copy: icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  edit: icon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  trash: icon('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
  refresh: icon('<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  send: icon('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  star: icon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>'),
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>',
  lock: icon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  sun: icon('<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'),
  moon: icon('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  panel: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>'),
  external: icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>'),
  bell: icon('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  warning: icon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>'),
  info: icon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  doc: icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'),
  play: icon('<polygon points="5 3 19 12 5 21 5 3"/>'),
  clock: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  sparkle: icon('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7L19 17z"/>'),
  logout: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  grip: icon('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  user: icon('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  image: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  arrowUp: icon('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  eye: icon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>')
};

/* ---------------- avatars & placeholder thumbnails ---------------- */
var AVATAR_HUES = [212, 30, 280, 160, 350, 190, 45, 130];
function hashStr(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
function avatar(name, size) {
  size = size || 36;
  var hue = AVATAR_HUES[hashStr(name || "?") % AVATAR_HUES.length];
  var initials = (name || "?").split(/\s+/).map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return h("span", {
    class: "avatar",
    style: {
      width: size + "px", height: size + "px", fontSize: Math.round(size * 0.38) + "px",
      background: "linear-gradient(135deg, hsl(" + hue + ", 70%, 52%), hsl(" + ((hue + 40) % 360) + ", 70%, 40%))"
    }
  }, initials);
}
/* 16:9 fake generated thumbnail as an SVG data URI */
var THUMB_GRADS = [["#0A2540", "#0A84FF"], ["#2a0a3d", "#BF5AF2"], ["#3d1c0a", "#FF9F0A"], ["#0a3d24", "#30D158"], ["#3d0a12", "#FF453A"], ["#0a2f3d", "#64D2FF"]];
function mockThumbUrl(text, seed) {
  seed = (seed || 0) % THUMB_GRADS.length;
  var g = THUMB_GRADS[seed];
  var words = String(text || "PREVIEW").toUpperCase();
  /* fit the text: the 1280px frame comfortably holds ~9 chars at 130px */
  var fontSize = Math.max(56, Math.min(130, Math.floor(1150 / Math.max(1, words.length) * 1.55)));
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="' + g[0] + '"/><stop offset="1" stop-color="' + g[1] + '"/></linearGradient>'
    + '<radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.55)"/></radialGradient></defs>'
    + '<rect width="1280" height="720" fill="url(#g)"/>'
    + '<circle cx="' + (240 + seed * 120) + '" cy="180" r="260" fill="rgba(255,255,255,0.07)"/>'
    + '<circle cx="' + (1040 - seed * 60) + '" cy="600" r="320" fill="rgba(0,0,0,0.15)"/>'
    + '<rect width="1280" height="720" fill="url(#v)"/>'
    + '<text x="640" y="400" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="' + fontSize + '" font-weight="800" fill="#ffffff" letter-spacing="-3">' + words + '</text>'
    + '<text x="640" y="470" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="30" font-weight="600" fill="rgba(255,255,255,0.55)">AI GENERATED PREVIEW</text>'
    + "</svg>";
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
/* resolve stored image refs like "GEN:not-yet:1" */
function thumbSrc(ref) {
  if (!ref) return null;
  if (ref.indexOf("GEN:") === 0) {
    var parts = ref.split(":");
    return mockThumbUrl(parts[1].replace(/-/g, " "), parseInt(parts[2] || "0", 10));
  }
  return ref;
}

/* ---------------- pills ---------------- */
function pill(label, color, withDot) {
  return h("span", {
    class: "pill",
    style: { background: "color-mix(in srgb, " + color + " 16%, transparent)", color: color }
  }, withDot !== false ? h("span", { class: "dot" }) : null, label);
}
function stageMeta(key) {
  for (var i = 0; i < DB.STAGES.length; i++) if (DB.STAGES[i].key === key) return DB.STAGES[i];
  return { key: key, label: key, color: "#86868b" };
}
function stagePill(key) { var m = stageMeta(key); return pill(m.label, m.color); }
var STATUS_COLORS = {
  PAID: "#30D158", PENDING: "#FF9F0A", OVERDUE: "#FF453A",
  ACTIVE: "#30D158", CHURNED: "#86868b",
  TO_CONTACT: "#86868b", CONTACTED: "#0A84FF", IN_TALKS: "#FF9F0A", CLOSED: "#30D158", LOST: "#FF453A",
  connected: "#30D158", not_configured: "#86868b", error: "#FF453A"
};
var STATUS_LABELS = {
  PAID: "Paid", PENDING: "Pending", OVERDUE: "Overdue", ACTIVE: "Active", CHURNED: "Churned",
  TO_CONTACT: "To contact", CONTACTED: "Contacted", IN_TALKS: "In talks", CLOSED: "Closed", LOST: "Lost",
  connected: "Connected", not_configured: "Not configured", error: "Error"
};
function statusPill(status) { return pill(STATUS_LABELS[status] || status, STATUS_COLORS[status] || "#86868b"); }
function planLabel(c) {
  if (c.planType === "TEAM_ONLY") return "Team only";
  if (c.planType === "PERSONAL_INVOLVED") return "Personal involved";
  return c.customPlanLabel || "Custom";
}

/* ---------------- modal / slideover / toast ---------------- */
function openModal(opts) {
  var root = document.getElementById("modal-root");
  var overlay = h("div", { class: "modal-overlay", onclick: function (e) { if (e.target === overlay && opts.dismissable !== false) close(); } });
  var head = h("div", { class: "modal-head" },
    h("h3", {}, opts.title || ""),
    opts.dismissable !== false ? h("button", { class: "btn ghost icon", html: Icons.x, onclick: function () { close(); } }) : null
  );
  var body = h("div", { class: "modal-body" });
  appendChild(body, opts.body);
  var modal = h("div", { class: "modal" + (opts.wide ? " wide" : "") }, head, body);
  if (opts.actions && opts.actions.length) modal.appendChild(h("div", { class: "modal-foot" }, opts.actions));
  overlay.appendChild(modal);
  root.appendChild(overlay);
  function close() { overlay.remove(); if (opts.onClose) opts.onClose(); }
  return { close: close, el: modal };
}
function confirmModal(opts) {
  var m = openModal({
    title: opts.title || "Are you sure?",
    body: h("p", { class: "muted", style: { fontSize: "14px", lineHeight: "1.6" } }, opts.message || ""),
    actions: [
      h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
      h("button", { class: "btn " + (opts.danger ? "danger" : "primary"), onclick: function () { m.close(); if (opts.onConfirm) opts.onConfirm(); } }, opts.confirmText || "Confirm")
    ]
  });
  return m;
}
function openSlideover(opts) {
  var root = document.getElementById("slideover-root");
  var overlay = h("div", { class: "slideover-overlay", onclick: function () { close(); } });
  var panel = h("div", { class: "slideover" },
    h("div", { class: "slideover-head" },
      h("div", {}, h("h3", {}, opts.title || ""), opts.subtitle ? h("div", { class: "caption" }, opts.subtitle) : null),
      h("button", { class: "btn ghost icon", html: Icons.x, onclick: function () { close(); } })
    ),
    (function () { var b = h("div", { class: "slideover-body" }); appendChild(b, opts.body); return b; })()
  );
  root.appendChild(overlay); root.appendChild(panel);
  function close() { overlay.remove(); panel.remove(); if (opts.onClose) opts.onClose(); }
  return { close: close, el: panel };
}
function toast(message, type) {
  var root = document.getElementById("toast-root");
  var t = h("div", { class: "toast " + (type || "success") },
    h("span", { html: type === "error" ? Icons.warning : Icons.check }), message);
  root.appendChild(t);
  setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; setTimeout(function () { t.remove(); }, 320); }, 2600);
}

/* ---------------- shared UI pieces ---------------- */
function emptyState(opts) {
  return h("div", { class: "empty" },
    h("span", { html: opts.icon || Icons.info }),
    h("div", { class: "empty-title" }, opts.title || "Nothing here yet"),
    opts.message ? h("div", { style: { fontSize: "13px", maxWidth: "360px" } }, opts.message) : null,
    opts.action || null
  );
}
/* "connect your API key" graceful-degradation block */
function apiGate(opts) {
  return h("div", { class: "gate" },
    h("div", { class: "gate-icon", html: Icons.lock }),
    h("div", { style: { fontWeight: "600", fontSize: "15px" } }, opts.title || "This tool will be available once you connect your API key"),
    h("div", { class: "caption", style: { maxWidth: "420px" } }, opts.message || ("Connect " + (opts.integration || "the integration") + " in Settings and this section starts working automatically.")),
    h("details", { class: "gate-how" },
      h("summary", {}, "Here's how"),
      h("div", { class: "gate-how-body" }, opts.how || ("Open Settings, find the " + (opts.integration || "") + " card, follow the Setup Guide and paste your key. No restart needed, the feature switches on the moment the key is saved."))
    ),
    h("button", { class: "btn small", onclick: function () { location.hash = "#/settings"; } }, "Open Settings")
  );
}
function integrationBanner(opts) {
  return h("div", { class: "banner" },
    h("span", { html: Icons.info }),
    h("span", { style: { flex: "1" } }, "This feature requires " + opts.integration + " to be configured."),
    h("span", { class: "banner-link", onclick: function () { location.hash = "#/settings"; } }, "Set it up now →")
  );
}
function sectionHead(title, right) {
  return h("div", { class: "section-head" }, h("h2", {}, title), right || null);
}
function kpiCard(opts) {
  return h("div", { class: "card kpi" },
    h("div", { class: "kpi-label" }, opts.label),
    h("div", { class: "kpi-value", style: opts.color ? { color: opts.color } : null }, opts.value),
    opts.sub ? h("div", { class: "kpi-sub", html: opts.sub }) : null
  );
}
function starRating(value, onRate) {
  var wrap = h("span", { class: "stars" });
  for (var i = 1; i <= 5; i++) (function (i) {
    wrap.appendChild(h("button", {
      class: "star" + (value >= i ? " on" : ""),
      html: value >= i ? Icons.starFill : Icons.star,
      onclick: function () { if (onRate) onRate(i); }
    }));
  })(i);
  return wrap;
}
/* chat input bar: Enter sends, Shift+Enter newline */
function chatInputBar(opts) {
  var ta = h("textarea", { rows: "1", placeholder: opts.placeholder || "Message..." });
  function autosize() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; }
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === "Return" || e.keyCode === 13) && !e.shiftKey) { e.preventDefault(); send(); }
  });
  var btn = h("button", { class: "chat-send", html: Icons.send, onclick: send });
  function send() {
    var text = ta.value.trim();
    if (!text) return;
    ta.value = ""; autosize();
    opts.onSend(text);
  }
  var bar = h("div", { class: "chat-bar" }, ta, btn);
  bar.focusInput = function () { ta.focus(); };
  return bar;
}
function chatBubble(role, content, meta) {
  var b = h("div", { class: "bubble " + role });
  appendChild(b, content);
  var wrap = h("div", { style: { display: "flex", flexDirection: "column", alignItems: role === "user" ? "flex-end" : "flex-start" } }, b);
  if (meta) wrap.appendChild(h("div", { class: "bubble-meta" }, meta));
  return wrap;
}
function typingBubble() {
  return chatBubble("assistant", h("span", { class: "typing" }, h("i"), h("i"), h("i")));
}
function download(filename, text, mime) {
  var blob = new Blob([text], { type: mime || "text/plain" });
  var a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
  toast("Copied to clipboard");
}

/* ---------------- canned AI replies (UI mock, no real model) ---------------- */
function mockAiReply(kind, input) {
  var short = (input || "").slice(0, 60);
  if (kind === "thumbnail") {
    return "Direction for \"" + short + "\": single expressive face, eyes to the lens, one emotion pushed 20 percent past natural. Three words max in heavy condensed type on a solid color block, placed against the darkest corner. Background simplified to one idea and blurred so the face carries the contrast. This follows the trained rules: one face, three words, readable at 120px.";
  }
  if (kind === "training") {
    return "Learned. Extracted principle: " + (input.length > 120 ? input.slice(0, 117) + "..." : input) + "\n\nI will apply this to every future generation in this scope. It compounds with the " + "existing principles rather than replacing them.";
  }
  if (kind === "titles") {
    return "Here are alternative angles that keep the promise honest but open a stronger curiosity gap. Each one states a change or a stake, never a topic label, per the global training.";
  }
  return "Three angles worth testing on \"" + short + "\":\n\n1. The contrarian open: lead with the claim your audience assumes is false, then spend the video earning it.\n2. The stakes frame: attach a number or a deadline so the outcome is falsifiable.\n3. The series play: split it into 3 connected episodes with linked titles so a click on any one feeds the others.\n\nWant me to draft titles and a thumbnail concept for the strongest one?";
}

/* ---------------- charts ---------------- */
var CHART_COLORS = ["#0A84FF", "#C97500", "#BF5AF2", "#1490C8", "#1FA044"];
var chartTip = null;
function ensureTip() {
  if (!chartTip) { chartTip = h("div", { class: "chart-tip" }); document.body.appendChild(chartTip); }
  return chartTip;
}
function showTip(html, x, y) {
  var t = ensureTip();
  t.innerHTML = html;
  t.classList.add("show");
  var w = t.offsetWidth, hgt = t.offsetHeight;
  var left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
  var top = y - hgt - 12; if (top < 8) top = y + 16;
  t.style.left = left + "px"; t.style.top = top + "px";
}
function hideTip() { if (chartTip) chartTip.classList.remove("show"); }

function svgNode(tag, attrs) {
  var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
  return el;
}
function niceMax(v) {
  if (v <= 0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log10(v)));
  var n = v / mag;
  var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}
function legendRow(series) {
  return h("div", { class: "legend" }, series.map(function (s, i) {
    return h("span", { class: "legend-item" },
      h("span", { class: "swatch", style: { background: s.color || CHART_COLORS[i] } }), s.name);
  }));
}
/* Charts.line({labels, series:[{name,color,values}], height, fmt, area}) */
var Charts = {};
Charts.line = function (opts) {
  var W = 640, H = opts.height || 220, padL = 46, padR = opts.series.length > 1 ? 84 : 16, padT = 12, padB = 26;
  var fmt = opts.fmt || fmtNum;
  var all = [];
  opts.series.forEach(function (s) { all = all.concat(s.values); });
  var max = niceMax(Math.max.apply(null, all) * 1.05);
  var iw = W - padL - padR, ih = H - padT - padB;
  var n = opts.labels.length;
  function X(i) { return padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); }
  function Y(v) { return padT + ih - (v / max) * ih; }
  var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H });
  /* grid + y labels */
  for (var g = 0; g <= 4; g++) {
    var gv = (max / 4) * g, gy = Y(gv);
    svg.appendChild(svgNode("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "var(--grid-line)", "stroke-width": 1 }));
    var yl = svgNode("text", { x: padL - 8, y: gy + 4, "text-anchor": "end", "font-size": 11, fill: "var(--text2)" });
    yl.textContent = fmt(gv); svg.appendChild(yl);
  }
  /* x labels, thinned */
  var stepEvery = Math.ceil(n / 8);
  opts.labels.forEach(function (lb, i) {
    if (i % stepEvery !== 0 && i !== n - 1) return;
    var xl = svgNode("text", { x: X(i), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--text2)" });
    xl.textContent = lb; svg.appendChild(xl);
  });
  /* series */
  var defs = svgNode("defs", {}); svg.appendChild(defs);
  opts.series.forEach(function (s, si) {
    var color = s.color || CHART_COLORS[si];
    var d = s.values.map(function (v, i) { return (i === 0 ? "M" : "L") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
    if (opts.area !== false && si === 0) {
      var gid = "grad" + uid();
      var grad = svgNode("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(svgNode("stop", { offset: "0", "stop-color": color, "stop-opacity": 0.22 }));
      grad.appendChild(svgNode("stop", { offset: "1", "stop-color": color, "stop-opacity": 0 }));
      defs.appendChild(grad);
      svg.appendChild(svgNode("path", { d: d + " L" + X(n - 1) + " " + (padT + ih) + " L" + X(0) + " " + (padT + ih) + " Z", fill: "url(#" + gid + ")" }));
    }
    svg.appendChild(svgNode("path", { d: d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    if (opts.series.length > 1) {
      var el = svgNode("text", { x: X(n - 1) + 8, y: Y(s.values[n - 1]) + 4, "font-size": 11, "font-weight": 600, fill: color });
      el.textContent = s.name; svg.appendChild(el);
    }
  });
  /* hover layer */
  var hoverLine = svgNode("line", { y1: padT, y2: padT + ih, stroke: "var(--hairline)", "stroke-width": 1, opacity: 0 });
  svg.appendChild(hoverLine);
  var dots = opts.series.map(function (s, si) {
    var dot = svgNode("circle", { r: 4, fill: s.color || CHART_COLORS[si], stroke: "var(--bg)", "stroke-width": 2, opacity: 0 });
    svg.appendChild(dot); return dot;
  });
  var overlay = svgNode("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent" });
  svg.appendChild(overlay);
  overlay.addEventListener("mousemove", function (e) {
    var rect = svg.getBoundingClientRect();
    var relX = (e.clientX - rect.left) / rect.width * W;
    var i = Math.round((relX - padL) / (iw / (n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    hoverLine.setAttribute("x1", X(i)); hoverLine.setAttribute("x2", X(i)); hoverLine.setAttribute("opacity", 1);
    var rows = "";
    opts.series.forEach(function (s, si) {
      dots[si].setAttribute("cx", X(i)); dots[si].setAttribute("cy", Y(s.values[i])); dots[si].setAttribute("opacity", 1);
      rows += '<div class="tip-row"><span class="swatch" style="background:' + (s.color || CHART_COLORS[si]) + '"></span>' + s.name + ' <b>' + fmt(s.values[i]) + "</b></div>";
    });
    showTip('<div class="tip-title">' + opts.labels[i] + "</div>" + rows, e.clientX, e.clientY);
  });
  overlay.addEventListener("mouseleave", function () {
    hoverLine.setAttribute("opacity", 0);
    dots.forEach(function (d) { d.setAttribute("opacity", 0); });
    hideTip();
  });
  var wrap = h("div", { class: "chart-wrap" });
  if (opts.series.length > 1) wrap.appendChild(legendRow(opts.series));
  wrap.appendChild(svg);
  return wrap;
};
/* Charts.bars({labels, series:[{name,color,values}] (1-2), height, fmt}) */
Charts.bars = function (opts) {
  var W = 640, H = opts.height || 220, padL = 46, padR = 16, padT = 12, padB = 26;
  var fmt = opts.fmt || fmtNum;
  var all = [];
  opts.series.forEach(function (s) { all = all.concat(s.values); });
  var max = niceMax(Math.max.apply(null, all) * 1.05);
  var iw = W - padL - padR, ih = H - padT - padB;
  var n = opts.labels.length;
  var groupW = iw / n;
  var sN = opts.series.length;
  var barW = Math.min(26, (groupW * 0.6) / sN);
  var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H });
  for (var g = 0; g <= 4; g++) {
    var gv = (max / 4) * g, gy = padT + ih - (gv / max) * ih;
    svg.appendChild(svgNode("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "var(--grid-line)", "stroke-width": 1 }));
    var yl = svgNode("text", { x: padL - 8, y: gy + 4, "text-anchor": "end", "font-size": 11, fill: "var(--text2)" });
    yl.textContent = fmt(gv); svg.appendChild(yl);
  }
  opts.labels.forEach(function (lb, i) {
    var xc = padL + groupW * i + groupW / 2;
    var xl = svgNode("text", { x: xc, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--text2)" });
    xl.textContent = lb; svg.appendChild(xl);
    var group = svgNode("g", {});
    opts.series.forEach(function (s, si) {
      var v = s.values[i];
      var bh = Math.max(2, (v / max) * ih);
      var x = xc - (barW * sN + 2 * (sN - 1)) / 2 + si * (barW + 2);
      var y = padT + ih - bh;
      var r = Math.min(4, barW / 2);
      var path = "M" + x + " " + (padT + ih) + " L" + x + " " + (y + r) + " Q" + x + " " + y + " " + (x + r) + " " + y +
        " L" + (x + barW - r) + " " + y + " Q" + (x + barW) + " " + y + " " + (x + barW) + " " + (y + r) +
        " L" + (x + barW) + " " + (padT + ih) + " Z";
      group.appendChild(svgNode("path", { d: path, fill: s.color || CHART_COLORS[si] }));
    });
    var hit = svgNode("rect", { x: padL + groupW * i, y: padT, width: groupW, height: ih, fill: "transparent" });
    hit.addEventListener("mousemove", function (e) {
      var rows = "";
      opts.series.forEach(function (s, si) {
        rows += '<div class="tip-row"><span class="swatch" style="background:' + (s.color || CHART_COLORS[si]) + '"></span>' + s.name + ' <b>' + fmt(s.values[i]) + "</b></div>";
      });
      showTip('<div class="tip-title">' + lb + "</div>" + rows, e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", hideTip);
    group.appendChild(hit);
    svg.appendChild(group);
  });
  var wrap = h("div", { class: "chart-wrap" });
  if (opts.series.length > 1) wrap.appendChild(legendRow(opts.series));
  wrap.appendChild(svg);
  return wrap;
};
/* Charts.donut({value:0..1, label, sublabel, color, size}) */
Charts.donut = function (opts) {
  var size = opts.size || 132, r = size / 2 - 10, c = size / 2;
  var circ = 2 * Math.PI * r;
  var v = Math.max(0, Math.min(1, opts.value));
  var svg = svgNode("svg", { viewBox: "0 0 " + size + " " + size, style: "width:" + size + "px;height:" + size + "px" });
  svg.appendChild(svgNode("circle", { cx: c, cy: c, r: r, fill: "none", stroke: "var(--surface2)", "stroke-width": 10 }));
  svg.appendChild(svgNode("circle", {
    cx: c, cy: c, r: r, fill: "none", stroke: opts.color || "#0A84FF", "stroke-width": 10,
    "stroke-linecap": "round", "stroke-dasharray": (circ * v) + " " + circ,
    transform: "rotate(-90 " + c + " " + c + ")"
  }));
  var t = svgNode("text", { x: c, y: c + 1, "text-anchor": "middle", "font-size": 22, "font-weight": 600, fill: "var(--text)" });
  t.textContent = opts.label || Math.round(v * 100) + "%";
  svg.appendChild(t);
  if (opts.sublabel) {
    var st = svgNode("text", { x: c, y: c + 20, "text-anchor": "middle", "font-size": 10, fill: "var(--text2)" });
    st.textContent = opts.sublabel; svg.appendChild(st);
  }
  return h("div", { class: "chart-wrap", style: { display: "flex", justifyContent: "center" } }, svg);
};
Charts.spark = function (opts) {
  var W = opts.width || 120, H = opts.height || 36, pad = 3;
  var vals = opts.values;
  var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
  var span = max - min || 1;
  var n = vals.length;
  var d = vals.map(function (v, i) {
    var x = pad + (i / (n - 1)) * (W - pad * 2);
    var y = pad + (1 - (v - min) / span) * (H - pad * 2);
    return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
  var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, style: "width:" + W + "px;height:" + H + "px" });
  svg.appendChild(svgNode("path", { d: d, fill: "none", stroke: opts.color || "#0A84FF", "stroke-width": 2, "stroke-linecap": "round" }));
  return svg;
};

/* ---------------- domain helpers ---------------- */
var Util = {
  clientById: function (id) { return DB.clients.find(function (c) { return c.id === id; }); },
  activeClients: function () { return DB.clients.filter(function (c) { return c.status === "ACTIVE"; }); },
  mrr: function () { return Util.activeClients().reduce(function (s, c) { return s + c.monthlyFee; }, 0); },
  teamCostFor: function (clientId) {
    return DB.team.filter(function (t) { return t.clientId === clientId; }).reduce(function (s, t) { return s + t.cost; }, 0);
  },
  teamFor: function (clientId) { return DB.team.filter(function (t) { return t.clientId === clientId; }); },
  paymentsFor: function (clientId) { return DB.payments.filter(function (p) { return p.clientId === clientId; }); },
  roleLabel: function (r) {
    return { CHANNEL_MANAGER: "Channel manager", SHORT_FORM_EDITOR: "Short-form editor", LONG_FORM_EDITOR: "Long-form editor", THUMBNAIL_DESIGNER: "Thumbnail designer" }[r] || r;
  },
  integration: function (key) { return DB.integrations.find(function (i) { return i.key === key; }); },
  isConnected: function (key) { var i = Util.integration(key); return i && i.status === "connected"; },
  /* long-form rule: 4 minutes or longer */
  isLongForm: function (video) { return video.minutes >= 4; }
};

/* ---------------- app shell ---------------- */
var App = {
  current: null,
  param: null,
  injectedCss: {},
  NAV: [
    ["dashboard", "Dashboard", Icons.dashboard],
    ["money", "Money", Icons.money],
    ["clients", "Clients", Icons.clients],
    ["calendar", "Calendar", Icons.calendar],
    ["leads", "Leads", Icons.leads],
    ["ideation", "Ideation", Icons.ideation],
    ["thumbnails", "Thumbnails", Icons.thumbnails],
    ["analytics", "Analytics", Icons.analytics],
    ["team", "Team", Icons.team],
    ["onboarding", "Onboarding", Icons.onboarding],
    ["settings", "Settings", Icons.settings]
  ],
  TITLES: {
    dashboard: "Dashboard", money: "Money", clients: "Clients", calendar: "Calendar", leads: "Leads",
    ideation: "Ideation", thumbnails: "Thumbnails", analytics: "Analytics", team: "Team",
    onboarding: "Onboarding", settings: "Settings"
  },
  init: function () {
    var theme = storeGet("aa-theme") || "dark";
    document.documentElement.setAttribute("data-theme", theme);
    if (storeGet("aa-sidebar") === "collapsed") document.getElementById("sidebar").classList.add("collapsed");
    App.buildSidebar();
    window.addEventListener("hashchange", App.route);
    App.route();
    if (!storeGet("aa-welcomed")) App.showWelcome();
  },
  buildSidebar: function () {
    var sb = document.getElementById("sidebar");
    sb.innerHTML = "";
    sb.appendChild(h("div", { class: "side-logo" },
      h("span", { class: "mark" }, "AA"),
      h("span", { class: "name" }, "Agency Admin")
    ));
    App.NAV.forEach(function (item) {
      sb.appendChild(h("button", {
        class: "side-item" + (App.current === item[0] ? " active" : ""),
        dataset: { page: item[0] },
        onclick: function () { location.hash = "#/" + item[0]; },
        title: item[1]
      }, h("span", { html: item[2] }), h("span", { class: "side-label" }, item[1])));
    });
    var foot = h("div", { class: "side-foot" });
    foot.appendChild(h("div", { class: "side-sep" }));
    var isLight = document.documentElement.getAttribute("data-theme") === "light";
    foot.appendChild(h("button", {
      class: "side-item", title: "Toggle theme",
      onclick: function () {
        var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        storeSet("aa-theme", next);
        App.buildSidebar();
      }
    }, h("span", { html: isLight ? Icons.moon : Icons.sun }), h("span", { class: "side-label" }, isLight ? "Dark mode" : "Light mode")));
    foot.appendChild(h("button", {
      class: "side-item", title: "Collapse sidebar",
      onclick: function () {
        var sbEl = document.getElementById("sidebar");
        sbEl.classList.toggle("collapsed");
        storeSet("aa-sidebar", sbEl.classList.contains("collapsed") ? "collapsed" : "open");
      }
    }, h("span", { html: Icons.panel }), h("span", { class: "side-label" }, "Collapse")));
    sb.appendChild(foot);
  },
  route: function () {
    var hash = location.hash.replace(/^#\/?/, "") || "dashboard";
    var parts = hash.split("/");
    var page = parts[0];
    if (!window.Pages[page]) page = "dashboard";
    App.current = page;
    App.param = parts[1] || null;
    /* sidebar active state */
    var items = document.querySelectorAll(".side-item[data-page]");
    items.forEach(function (b) { b.classList.toggle("active", b.dataset.page === page); });
    /* topbar */
    var tb = document.getElementById("topbar");
    tb.innerHTML = "";
    tb.appendChild(h("span", { class: "tb-title" }, App.TITLES[page] || page));
    tb.appendChild(h("span", { class: "tb-spacer" }));
    tb.appendChild(h("span", { class: "caption" }, "Tue, Aug 5"));
    /* page */
    var def = window.Pages[page];
    if (def.css && !App.injectedCss[page]) {
      var st = document.createElement("style");
      st.textContent = def.css;
      document.head.appendChild(st);
      App.injectedCss[page] = true;
    }
    var root = document.getElementById("page");
    root.innerHTML = "";
    root.scrollTop = 0;
    var inner = h("div", { class: "page-inner fade-in" });
    root.appendChild(inner);
    def.render(inner, App.param);
  },
  refresh: function () { App.route(); },
  showWelcome: function () {
    storeSet("aa-welcomed", "1");
    var list = h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
    DB.integrations.forEach(function (ig) {
      list.appendChild(h("div", { class: "row", style: { padding: "10px 12px", borderRadius: "12px", background: "var(--glass)", border: "0.5px solid var(--border)" } },
        h("div", { style: { flex: "1" } },
          h("div", { style: { fontWeight: "600", fontSize: "14px" } }, ig.name, ig.required ? h("span", { class: "tag", style: { marginLeft: "8px", color: "var(--blue)" } }, "Required") : null),
          h("div", { class: "caption" }, ig.desc)
        ),
        statusPill(ig.status)
      ));
    });
    var m = openModal({
      title: "Welcome to Agency Admin",
      wide: true,
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        h("p", { class: "muted", style: { fontSize: "14px", lineHeight: "1.6" } },
          "Connect your integrations in the recommended order below. Start with the Claude API, it powers channel analysis, ideation, thumbnails and the Discord agent."),
        list
      ),
      actions: [
        h("button", { class: "btn ghost", onclick: function () { m.close(); } }, "Skip for now"),
        h("button", { class: "btn primary", onclick: function () { m.close(); location.hash = "#/settings"; } }, "Get Started")
      ]
    });
  }
};
