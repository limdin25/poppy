// SSE client + form handlers + table updates
const $ = (id) => document.getElementById(id);
const leadsBody = $("leads-body");
const logEl = $("log");
let startedAt = null;

function cfg() {
  return {
    keywords: $("keywords").value,
    locations: $("locations").value,
    host: $("px-host").value, port: $("px-port").value,
    username: $("px-user").value, password: $("px-pass").value,
    rotate_every: parseInt($("px-rotate").value || "25"),
    sticky: $("px-sticky").checked,
    max_per_query: parseInt($("max-per").value || "50"),
    delay_min: parseFloat($("d-min").value || "2"),
    delay_max: parseFloat($("d-max").value || "5"),
    headless: $("headless").checked,
    full_details: $("full").checked,
    force_rescrape: $("force").checked,
  };
}

async function preview() {
  const r = await fetch("/api/preview", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({keywords: $("keywords").value, locations: $("locations").value})
  });
  const d = await r.json();
  $("preview").textContent =
    `${d.keywords} keywords × ${d.locations} locations = ${d.queries} queries `
    + `(${d.already} already scraped, will skip → ${d.will_scrape} to run)`;
}

$("keywords").addEventListener("input", preview);
$("locations").addEventListener("input", preview);

$("btn-test").onclick = async () => {
  $("px-result").textContent = "testing…";
  const r = await fetch("/api/test_proxy", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(cfg())
  });
  const d = await r.json();
  $("px-result").textContent = d.ok
    ? `✔ ${d.ip} ${d.country ? "("+d.country+")" : ""} via ${d.via}  [sent ${d.sent||""}]`
    : `✘ ${d.error}  [sent ${d.sent||""}]`;
  $("px-result").className = "text-xs mt-1 " + (d.ok ? "text-emerald-700" : "text-rose-700");
};

$("btn-start").onclick = async () => {
  const r = await fetch("/api/start", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(cfg())
  });
  const d = await r.json();
  if (!d.ok) { alert("Start failed: " + (d.error || "unknown")); return; }
  startedAt = Date.now();
  leadsBody.innerHTML = ""; logEl.innerHTML = "";
};

$("btn-pause").onclick = async () => {
  const r = await fetch("/api/pause", {method: "POST"});
  const d = await r.json();
  $("btn-pause").textContent = d.paused ? "Resume" : "Pause";
};

$("btn-stop").onclick = async () => {
  await fetch("/api/stop", {method: "POST"});
};

$("btn-export-all").onclick = () => { window.location = "/api/export"; };
$("btn-clear").onclick = () => { $("modal").classList.remove("hidden"); };
$("modal-cancel").onclick = () => { $("modal").classList.add("hidden"); };
$("modal-ok").onclick = async () => {
  const r = await fetch("/api/clear", {method: "POST"});
  const d = await r.json();
  $("modal").classList.add("hidden");
  if (!d.ok) alert(d.error || "clear failed");
  refreshHistory();
};

function fmtTime(ms) {
  if (!ms) return "00:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60), ss = s % 60;
  return `${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

setInterval(() => {
  if (startedAt) $("m-time").textContent = fmtTime(Date.now() - startedAt);
}, 1000);

function addLead(l) {
  const tr = document.createElement("tr");
  tr.className = "border-t hover:bg-slate-50";
  tr.innerHTML = `<td class="p-1">${escapeHtml(l.name||"")}</td>
                  <td class="p-1">${escapeHtml(l.phone||"")}</td>
                  <td class="p-1">${l.rating ?? ""}</td>
                  <td class="p-1">${escapeHtml(l.location||"")}</td>`;
  leadsBody.prepend(tr);
  while (leadsBody.children.length > 50) leadsBody.removeChild(leadsBody.lastChild);
}

function addLog(level, msg, ts) {
  const colors = {info:"text-slate-200", warn:"text-amber-300", error:"text-rose-300"};
  const div = document.createElement("div");
  div.className = `log-line ${colors[level]||"text-slate-200"}`;
  div.textContent = `[${ts||""}] ${msg}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function refreshHistory() {
  const [s, q] = await Promise.all([
    fetch("/api/sessions").then(r=>r.json()),
    fetch("/api/queries").then(r=>r.json()),
  ]);
  $("sessions").innerHTML = s.map(r =>
    `<div class="border rounded p-1 flex justify-between items-center">
       <div>#${r.id} <span class="text-slate-500">${r.started_at||""}</span><br>
            <span class="text-slate-600">${r.leads_count||0} leads · ${r.duplicates||0} dupes</span></div>
       <a href="/api/export/${r.id}" class="bg-sky-100 hover:bg-sky-200 px-2 py-1 rounded text-sky-800">CSV</a>
     </div>`
  ).join("") || '<div class="text-slate-400">none yet</div>';
  $("queries").innerHTML = q.map(r =>
    `<div class="flex justify-between"><span>✔ ${escapeHtml(r.keyword)} · ${escapeHtml(r.location)}</span>
     <span class="text-slate-500">${r.lead_count||0}</span></div>`
  ).join("") || '<div class="text-slate-400">none yet</div>';
}

async function loadRecent() {
  const r = await fetch("/api/recent").then(r=>r.json());
  leadsBody.innerHTML = "";
  r.reverse().forEach(addLead);
}

// SSE
const es = new EventSource("/stream");
es.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "metrics") {
    $("m-pages").textContent = ev.pages;
    $("m-new").textContent = ev.new;
    $("m-dupes").textContent = ev.duplicates;
    $("m-err").textContent = ev.errors;
    $("m-proxy").textContent = ev.current_proxy;
    $("m-query").textContent = ev.current_query || "—";
    $("m-done").textContent = ev.queries_done;
    $("m-total").textContent = ev.queries_total;
    const pct = ev.queries_total ? (100 * ev.queries_done / ev.queries_total) : 0;
    $("m-bar").style.width = pct + "%";
  } else if (ev.type === "lead") {
    addLead(ev.lead);
  } else if (ev.type === "log") {
    addLog(ev.level, ev.msg, ev.ts);
  } else if (ev.type === "captcha") {
    $("captcha-banner").classList.remove("hidden");
  } else if (ev.type === "done") {
    addLog("info", "Job finished.", new Date().toLocaleTimeString());
    refreshHistory();
    startedAt = null;
  }
};

// Restore saved config on load
async function loadConfig() {
  try {
    const c = await fetch("/api/config").then(r => r.json());
    if (!c || Object.keys(c).length === 0) return;
    const map = {
      keywords: "keywords", locations: "locations",
      host: "px-host", port: "px-port",
      username: "px-user", password: "px-pass",
      rotate_every: "px-rotate",
      max_per_query: "max-per",
      delay_min: "d-min", delay_max: "d-max",
    };
    for (const [k, id] of Object.entries(map)) {
      if (c[k] !== undefined && c[k] !== null && $(id)) $(id).value = c[k];
    }
    if (c.sticky !== undefined && $("px-sticky")) $("px-sticky").checked = !!c.sticky;
    if (c.headless !== undefined && $("headless")) $("headless").checked = !!c.headless;
    if (c.full_details !== undefined && $("full")) $("full").checked = !!c.full_details;
    if (c.force_rescrape !== undefined && $("force")) $("force").checked = !!c.force_rescrape;
  } catch (e) { /* no config yet — fine */ }
}

// Debounced auto-save when proxy fields change (so creds persist even without clicking Test)
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch("/api/config", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(cfg()),
    });
  }, 600);
}
["px-host","px-port","px-user","px-pass","px-rotate","px-sticky",
 "max-per","d-min","d-max","headless","full","force",
 "keywords","locations"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("change", scheduleSave);
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.addEventListener("input", scheduleSave);
});

(async () => {
  await loadConfig();
  preview();
  refreshHistory();
  loadRecent();
})();
