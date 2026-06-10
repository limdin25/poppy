// Facebook Ad Library scraper — SSE client + form handlers + table updates
const $ = (id) => document.getElementById(id);
const leadsBody = $("leads-body");
const logEl = $("log");
let startedAt = null;

// Multi-select helper for country dropdown
const countrySelect = $("country-select");
countrySelect.setAttribute("multiple", "true");
countrySelect.size = 6;

function updateCountries() {
  const selected = Array.from(countrySelect.selectedOptions).map(o => o.value);
  $("countries").value = selected.join(",");
}
countrySelect.addEventListener("change", () => { updateCountries(); preview(); scheduleSave(); });

function cfg() {
  return {
    keywords: $("keywords").value,
    countries: $("countries").value,
    host: $("px-host").value, port: $("px-port").value,
    username: $("px-user").value, password: $("px-pass").value,
    rotate_every: parseInt($("px-rotate").value || "25"),
    sticky: $("px-sticky").checked,
    max_results: parseInt($("max-results").value || "100"),
    delay_min: parseFloat($("d-min").value || "2"),
    delay_max: parseFloat($("d-max").value || "5"),
    headless: $("headless").checked,
    force_rescrape: $("force").checked,
    count_ads: $("count-ads").checked,
  };
}

async function preview() {
  const r = await fetch("/api/facebook/preview", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({keywords: $("keywords").value, countries: $("countries").value})
  });
  const d = await r.json();
  $("preview").textContent =
    `${d.keywords} keywords x ${d.countries} countries = ${d.queries} queries `
    + `(${d.already} already scraped -> ${d.will_scrape} to run)`;
}

$("keywords").addEventListener("input", preview);

$("btn-start").onclick = async () => {
  updateCountries();
  $("status-banner").textContent = "Starting...";
  $("status-banner").className = "text-sm font-medium text-blue-600 mt-2";
  const r = await fetch("/api/facebook/start", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(cfg())
  });
  const d = await r.json();
  if (!d.ok) {
    alert("Start failed: " + (d.error || "unknown"));
    $("status-banner").textContent = "Failed: " + (d.error || "unknown");
    $("status-banner").className = "text-sm font-medium text-rose-600 mt-2";
    return;
  }
  startedAt = Date.now();
  leadsBody.innerHTML = ""; logEl.innerHTML = "";
  $("status-banner").textContent = "Running — scraping " + d.queries + " queries...";
  $("status-banner").className = "text-sm font-medium text-emerald-600 mt-2 animate-pulse";
};

$("btn-pause").onclick = async () => {
  const r = await fetch("/api/facebook/pause", {method: "POST"});
  const d = await r.json();
  $("btn-pause").textContent = d.paused ? "Resume" : "Pause";
};

$("btn-stop").onclick = async () => {
  await fetch("/api/facebook/stop", {method: "POST"});
};

$("btn-export-all").onclick = () => { window.location = "/api/facebook/export"; };
$("btn-clear").onclick = () => { $("modal").classList.remove("hidden"); };
$("modal-cancel").onclick = () => { $("modal").classList.add("hidden"); };
$("modal-ok").onclick = async () => {
  const r = await fetch("/api/facebook/clear", {method: "POST"});
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
  const pageLink = l.page_url
    ? `<a href="${escapeHtml(l.page_url)}" target="_blank" class="text-blue-600 hover:underline">${escapeHtml(l.page_name||"")}</a>`
    : escapeHtml(l.page_name || "");
  const website = l.website
    ? `<a href="${escapeHtml(l.website)}" target="_blank" class="text-blue-600 hover:underline">${escapeHtml(new URL(l.website).hostname)}</a>`
    : "";
  const status = l.is_active ? '<span class="text-emerald-600">Active</span>' : '<span class="text-rose-600">Inactive</span>';
  const adCount = l.active_ad_count != null && l.active_ad_count >= 0 ? l.active_ad_count : "—";
  const adLibLink = l.ad_library_url
    ? `<a href="${escapeHtml(l.ad_library_url)}" target="_blank" class="text-blue-600 hover:underline">View</a>`
    : "—";
  tr.innerHTML = `<td class="p-1">${pageLink}</td>
                  <td class="p-1">${website}</td>
                  <td class="p-1">${escapeHtml(l.start_date||"")}</td>
                  <td class="p-1">${status}</td>
                  <td class="p-1">${escapeHtml(l.platforms||"")}</td>
                  <td class="p-1 font-medium">${adCount}</td>
                  <td class="p-1">${adLibLink}</td>`;
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
    fetch("/api/facebook/sessions").then(r=>r.json()),
    fetch("/api/facebook/queries").then(r=>r.json()),
  ]);
  $("sessions").innerHTML = s.map(r =>
    `<div class="border rounded p-1 flex justify-between items-center">
       <div>#${r.id} <span class="text-slate-500">${r.started_at||""}</span><br>
            <span class="text-slate-600">${r.leads_count||0} ads · ${r.duplicates||0} dupes</span></div>
       <a href="/api/facebook/export/${r.id}" class="bg-sky-100 hover:bg-sky-200 px-2 py-1 rounded text-sky-800">CSV</a>
     </div>`
  ).join("") || '<div class="text-slate-400">none yet</div>';
  $("queries").innerHTML = q.map(r =>
    `<div class="flex justify-between"><span>${escapeHtml(r.keyword)} (${escapeHtml(r.country||"")})</span>
     <span class="text-slate-500">${r.lead_count||0}</span></div>`
  ).join("") || '<div class="text-slate-400">none yet</div>';
}

async function loadRecent() {
  const r = await fetch("/api/facebook/recent").then(r=>r.json());
  leadsBody.innerHTML = "";
  r.reverse().forEach(addLead);
}

// SSE — shared stream with Google Maps scraper, filter by fb_ events
const es = new EventSource("/stream");
es.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "fb_metrics") {
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
  } else if (ev.type === "fb_lead") {
    addLead(ev.lead);
  } else if (ev.type === "log") {
    addLog(ev.level, ev.msg, ev.ts);
  } else if (ev.type === "fb_enrich_start") {
    $("status-banner").textContent = "Counting active ads per page... (0/" + ev.total + ")";
    $("status-banner").className = "text-sm font-medium text-blue-600 mt-2 animate-pulse";
  } else if (ev.type === "fb_enrich_update") {
    $("status-banner").textContent = "Counting active ads: " + ev.page_name + " = " + ev.count + " (" + ev.done + "/" + ev.total + ")";
    loadRecent();
  } else if (ev.type === "fb_enrich_done") {
    $("status-banner").textContent = "Enrichment complete — loading final data...";
    loadRecent();
  } else if (ev.type === "fb_done") {
    addLog("info", "Facebook job finished.", new Date().toLocaleTimeString());
    refreshHistory();
    loadRecent();
    startedAt = null;
    $("status-banner").textContent = "Done";
    $("status-banner").className = "text-sm font-medium text-slate-500 mt-2";
  }
};

// Config persistence
async function loadConfig() {
  try {
    const c = await fetch("/api/facebook/config").then(r => r.json());
    if (!c || Object.keys(c).length === 0) return;
    const map = {
      keywords: "keywords",
      host: "px-host", port: "px-port",
      username: "px-user", password: "px-pass",
      rotate_every: "px-rotate",
      max_results: "max-results",
      delay_min: "d-min", delay_max: "d-max",
    };
    for (const [k, id] of Object.entries(map)) {
      if (c[k] !== undefined && c[k] !== null && $(id)) $(id).value = c[k];
    }
    if (c.sticky !== undefined && $("px-sticky")) $("px-sticky").checked = !!c.sticky;
    if (c.headless !== undefined && $("headless")) $("headless").checked = !!c.headless;
    if (c.force_rescrape !== undefined && $("force")) $("force").checked = !!c.force_rescrape;
    if (c.count_ads !== undefined && $("count-ads")) $("count-ads").checked = !!c.count_ads;
    if (c.countries) {
      const codes = c.countries.split(",");
      for (const opt of countrySelect.options) {
        opt.selected = codes.includes(opt.value);
      }
      $("countries").value = c.countries;
    }
  } catch (e) { /* no config yet */ }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch("/api/facebook/config", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(cfg()),
    });
  }, 600);
}
["px-host","px-port","px-user","px-pass","px-rotate","px-sticky",
 "max-results","d-min","d-max","headless","force","count-ads","keywords"].forEach(id => {
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
