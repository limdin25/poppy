const $ = (id) => document.getElementById(id);
let logOpen = false;

async function refreshCounts() {
  try {
    const c = await (await fetch("/api/zillow/counts")).json();
    $("c-total").textContent = c.total;
    $("c-agents").textContent = c.agents;
    $("c-tomsg").textContent = c.to_enquire;
    $("c-bl").textContent = c.blacklisted;
  } catch (e) {}
}

// ── Realtors to enquire (one cheapest listing each) ──────────────
async function loadAgents() {
  const agents = await (await fetch("/api/zillow/agents")).json();
  $("agent-count").textContent = agents.length;
  const box = $("agents"); box.innerHTML = "";
  $("empty").classList.toggle("hidden", agents.length > 0);
  for (const a of agents) {
    const div = document.createElement("div");
    div.className = "p-3 flex items-center justify-between gap-3";
    const phone = a.agent_phone ? `<span class="text-xs text-blue-600">📞 ${a.agent_phone}</span>` : `<span class="text-xs text-slate-400">no phone</span>`;
    div.innerHTML = `
      <div class="min-w-0">
        <div class="font-bold text-slate-800 text-sm">${a.agent_name || "Unknown realtor"} ${phone}
          ${a.brokerage ? `<span class="text-xs font-normal text-slate-400">· ${a.brokerage}</span>` : ""}</div>
        <div class="text-xs text-slate-500 truncate">cheapest: <strong>${a.price || ""}</strong> · ${a.address || ""}
          · <a href="${a.listing_url}" target="_blank" class="text-blue-600 underline">view on Zillow</a></div>
      </div>
      <button data-zpid="${a.zpid}" data-name="${(a.agent_name||'').replace(/"/g,'&quot;')}"
        class="enq bg-emerald-600 hover:bg-emerald-700 text-white rounded px-3 py-1 text-xs font-semibold shrink-0">📨 Enquire</button>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".enq").forEach(b => b.onclick = () => enquireOne(b));
}

async function enquireOne(btn) {
  if (!confirm(`Send a buyer enquiry to ${btn.dataset.name}? Their phone gets our US line (+1 272 347 1167). They'll be marked done after.`)) return;
  btn.disabled = true; btn.textContent = "Enquiring…";
  try {
    const r = await (await fetch("/api/zillow/enquire", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zpid: btn.dataset.zpid, dry_run: false }),
    })).json();
    if (r.ok) { loadAgents(); loadBlacklist(); refreshCounts(); }
    else { btn.disabled = false; btn.textContent = "📨 Enquire"; alert("Enquiry failed: " + (r.error || "")); }
  } catch (e) { btn.disabled = false; btn.textContent = "📨 Enquire"; alert("Enquiry failed: " + e); }
}

$("btn-msgall").onclick = async () => {
  if (!confirm("Send a buyer enquiry to every new realtor? Each is enquired once (own fresh US session), then marked done.")) return;
  const r = await (await fetch("/api/zillow/message-all", { method: "POST" })).json();
  if (!r.ok) { alert(r.error || "nothing to enquire"); return; }
  $("btn-msgall-stop").classList.remove("hidden");
  if (!logOpen) toggleLog();
  addLog(`Enquiring ${r.count} new realtors…`, "info");
};
$("btn-msgall-stop").onclick = async () => { await fetch("/api/zillow/message-all/stop", { method: "POST" }); $("btn-msgall-stop").classList.add("hidden"); };

// ── Already enquired (blacklist) ─────────────────────────────────
async function loadBlacklist() {
  const bl = await (await fetch("/api/zillow/blacklist")).json();
  $("bl-count").textContent = bl.length;
  const box = $("blacklist"); box.innerHTML = "";
  $("bl-empty").classList.toggle("hidden", bl.length > 0);
  for (const b of bl) {
    const div = document.createElement("div");
    div.className = "p-3 flex items-center justify-between gap-3 text-sm";
    const days = b.days_on_blacklist == null ? "" : (b.days_on_blacklist === 0 ? "today" : `${b.days_on_blacklist} day${b.days_on_blacklist === 1 ? "" : "s"} ago`);
    const status = b.confirmed
      ? `<span class="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✅ Sent confirmed</span>`
      : `<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium" title="Marked done but Zillow's 'Message sent' page wasn't seen">⚠ not confirmed</span>`;
    div.innerHTML = `
      <div class="min-w-0 flex items-center gap-2">
        <span class="font-semibold text-slate-800 truncate">${b.agent_name || b.agent_key}</span>
        ${b.agent_phone ? `<span class="text-xs text-slate-500">📞 ${b.agent_phone}</span>` : ""}
        ${status}
        <span class="text-xs text-slate-400">${days}</span>
      </div>
      <button data-key="${b.agent_key}" class="unbl bg-slate-200 hover:bg-rose-200 rounded px-2 py-1 text-xs shrink-0">Remove</button>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".unbl").forEach(b => b.onclick = async () => {
    await fetch("/api/zillow/blacklist/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_key: b.dataset.key }) });
    loadBlacklist(); loadAgents(); refreshCounts();
  });
}

// ── Scrape control ───────────────────────────────────────────────
$("btn-start").onclick = async () => {
  const urls = $("urls").value.trim();
  if (!urls) { alert("Paste at least one Zillow search URL"); return; }
  const auto = $("auto-enquire").checked;
  const r = await (await fetch("/api/zillow/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, max_pages: parseInt($("max-pages").value) || 5,
                           fetch_agents: $("fetch-agents").checked, enquire: auto }),
  })).json();
  if (!r.ok) { alert("Start failed: " + (r.error || "")); return; }
  $("btn-stop").classList.remove("hidden");
  if (!logOpen) toggleLog();
  addLog(auto
    ? `Scraping + enquiring ${r.count} search URL(s) in one pass… (each new realtor gets a buyer enquiry, duplicates skipped)`
    : `Scraping ${r.count} search URL(s)… (a Chrome window opens — Zillow needs a real US browser)`, "info");
};
$("btn-stop").onclick = async () => { await fetch("/api/zillow/stop", { method: "POST" }); $("btn-stop").classList.add("hidden"); };
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
  if (d.type === "zillow_metrics") { refreshCounts(); loadAgents(); }
  if (d.type === "zillow_done") { addLog("--- scrape complete ---", "info"); $("btn-stop").classList.add("hidden"); refreshCounts(); loadAgents(); }
  if (d.type === "zillow_msg_done") { addLog(`--- enquired ${d.sent} realtors ---`, "info"); $("btn-msgall-stop").classList.add("hidden"); loadAgents(); loadBlacklist(); refreshCounts(); }
};

refreshCounts();
loadAgents();
loadBlacklist();
