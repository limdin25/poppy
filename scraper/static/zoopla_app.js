const $ = (id) => document.getElementById(id);
let logOpen = false;

async function refreshCounts() {
  try {
    const c = await (await fetch("/api/zoopla/counts")).json();
    $("c-total").textContent = c.total;
    $("c-pending").textContent = c.pending;
    $("c-potential").textContent = c.potential;
  } catch (e) {}
}

async function loadListings() {
  const list = await (await fetch("/api/zoopla/listings?status=pending")).json();
  $("review-count").textContent = list.length;
  const box = $("listings");
  box.innerHTML = "";
  $("empty").classList.toggle("hidden", list.length > 0);
  for (const l of list) {
    const div = document.createElement("div");
    div.className = "card p-3 flex items-center justify-between gap-3";
    const beds = l.bedrooms != null ? `${l.bedrooms} bed` : "? bed";
    const type = l.property_type || "—";
    div.innerHTML = `
      <div class="min-w-0">
        <div class="font-bold text-slate-800 text-sm">${l.price || "No price"}
          <span class="text-xs font-normal text-slate-400">· ${beds} · ${type}</span></div>
        <div class="text-xs text-slate-500 truncate">${l.address || "No address"}</div>
        <a href="${l.listing_url}" target="_blank" class="text-xs text-purple-600 underline">View on Zoopla</a>
        <span id="ai-${l.property_id}" class="text-xs ml-2"></span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button data-id="${l.property_id}" class="ai-btn bg-slate-100 hover:bg-slate-200 rounded px-2 py-1 text-xs" title="AI: can the kitchen become a bedroom?">🛏️ AI score</button>
        <button data-id="${l.property_id}" class="pot-btn bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1 text-xs font-semibold">Potential</button>
        <button data-id="${l.property_id}" class="skip-btn bg-slate-200 hover:bg-slate-300 rounded px-2 py-1 text-xs">Skip</button>
      </div>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".pot-btn").forEach(b => b.onclick = () => review(b.dataset.id, "potential"));
  box.querySelectorAll(".skip-btn").forEach(b => b.onclick = () => review(b.dataset.id, "skip"));
  box.querySelectorAll(".ai-btn").forEach(b => b.onclick = () => aiScore(b.dataset.id));
}

async function review(pid, status) {
  await fetch("/api/zoopla/review", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ property_id: pid, status }),
  });
  await Promise.all([loadListings(), refreshCounts()]);
}

async function aiScore(pid) {
  const el = $("ai-" + pid);
  el.textContent = " · scoring…";
  try {
    const r = await (await fetch("/api/zoopla/floorplan-score", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: pid }),
    })).json();
    if (!r.ok) { el.textContent = " · " + (r.error || "no score"); return; }
    const col = r.uplift_score >= 6 ? "text-emerald-700" : r.uplift_score >= 4 ? "text-amber-700" : "text-slate-500";
    el.innerHTML = ` · <span class="${col} font-semibold">🛏️ ${r.uplift_score}/10</span> `
      + `<span class="text-slate-500" title="${(r.conversion_idea || '').replace(/"/g, "'")}">${r.can_add_bedroom ? "can add bedroom" : "no easy add"}</span>`;
  } catch (e) { el.textContent = " · score failed"; }
}

// ── Scrape control ───────────────────────────────────────────────
$("btn-start").onclick = async () => {
  const urls = $("urls").value.trim();
  if (!urls) { alert("Paste at least one Zoopla search URL"); return; }
  const r = await (await fetch("/api/zoopla/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, max_pages: parseInt($("max-pages").value) || 5 }),
  })).json();
  if (!r.ok) { alert("Start failed: " + (r.error || "")); return; }
  $("btn-stop").classList.remove("hidden");
  if (!logOpen) toggleLog();
  addLog(`Scraping ${r.count} search URL(s)… (a Chrome window opens — Zoopla needs a real browser)`, "info");
};
$("btn-stop").onclick = async () => { await fetch("/api/zoopla/stop", { method: "POST" }); $("btn-stop").classList.add("hidden"); };
$("btn-fp").onclick = async () => {
  const r = await (await fetch("/api/zoopla/floorplans/fetch", { method: "POST" })).json();
  if (!r.ok) { alert(r.error || "no pending listings"); return; }
  if (!logOpen) toggleLog();
  addLog(`Fetching floor plans + details for ${r.count} listings…`, "info");
};
$("btn-log").onclick = () => toggleLog();

function toggleLog() { logOpen = !logOpen; $("log-box").classList.toggle("hidden", !logOpen); }
function addLog(msg, level) {
  const d = document.createElement("div");
  const colors = { warn: "text-amber-400", error: "text-rose-400", info: "text-slate-300" };
  d.className = "log-line " + (colors[level] || "text-slate-400");
  d.textContent = msg;
  $("log").appendChild(d);
  $("log").scrollTop = $("log").scrollHeight;
}

// ── SSE: live log + auto-refresh on progress ─────────────────────
const es = new EventSource("/stream");
es.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.type === "log") addLog(`[${d.ts || ""}] ${d.msg}`, d.level);
  if (d.type === "zoopla_metrics" || d.type === "zoopla_fp_metrics") { refreshCounts(); }
  if (d.type === "zoopla_done") { addLog("--- scrape complete ---", "info"); $("btn-stop").classList.add("hidden"); loadListings(); refreshCounts(); }
  if (d.type === "zoopla_fp_done") { addLog("--- floor plans complete ---", "info"); loadListings(); }
};

refreshCounts();
loadListings();
