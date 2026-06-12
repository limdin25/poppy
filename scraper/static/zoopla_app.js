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
  await Promise.all([loadListings(), loadPotential(), refreshCounts()]);
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

// ── Potential listings: valuation verdict + Enquire ──────────────
const VERDICT_LABEL = {
  great_deal: ["bg-emerald-100 text-emerald-700", "Great deal"],
  great_deal_suspicious: ["bg-amber-100 text-amber-700", "Cheap — verify"],
  fair: ["bg-blue-100 text-blue-700", "Fair"],
  overpriced: ["bg-rose-100 text-rose-700", "Overpriced"],
  insufficient_data: ["bg-slate-100 text-slate-400", "No evidence"],
};

async function loadPotential() {
  const [props, vals, enquired] = await Promise.all([
    fetch("/api/zoopla/comps/properties").then(r => r.json()),
    fetch("/api/zoopla/valuation/batch").then(r => r.json()).catch(() => ({})),
    fetch("/api/zoopla/enquired").then(r => r.json()).catch(() => ({})),
  ]);
  $("pot-count").textContent = props.length;
  const box = $("potential");
  box.innerHTML = "";
  $("pot-empty").classList.toggle("hidden", props.length > 0);
  for (const p of props) {
    const v = vals[p.property_id] || {};
    const vl = v.verdict && VERDICT_LABEL[v.verdict];
    const badge = vl ? `<span class="text-xs px-1.5 py-0.5 rounded font-medium ${vl[0]}">${vl[1]}</span>`
      : `<span class="text-xs text-slate-400">${(p.comps || []).length ? "comps ready" : "no comps yet"}</span>`;
    const sent = enquired[p.property_id];
    const div = document.createElement("div");
    div.className = "p-3 flex items-center justify-between gap-3";
    div.innerHTML = `
      <div class="min-w-0">
        <div class="font-bold text-slate-800 text-sm">${p.price || ""}
          <span class="text-xs font-normal text-slate-400">· ${p.bedrooms ?? "?"} bed · ${p.property_type || "—"}</span> ${badge}</div>
        <div class="text-xs text-slate-500 truncate">${p.address || ""}</div>
        <a href="${p.listing_url}" target="_blank" class="text-xs text-purple-600 underline">View on Zoopla</a>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${sent
          ? `<span class="text-xs text-emerald-700 font-semibold">✉️ Enquired ✓</span>`
          : `<button data-id="${p.property_id}" class="enq-btn bg-sky-600 hover:bg-sky-700 text-white rounded px-3 py-1 text-xs font-semibold">✉️ Enquire</button>`}
        <button data-id="${p.property_id}" class="unpot-btn bg-slate-200 hover:bg-slate-300 rounded px-2 py-1 text-xs">↩︎</button>
      </div>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".enq-btn").forEach(b => b.onclick = () => enquire(b.dataset.id, b));
  box.querySelectorAll(".unpot-btn").forEach(b => b.onclick = () => review(b.dataset.id, "pending"));
}

async function enquire(pid, btn) {
  if (!confirm("Send a real Zoopla enquiry to this agent? (cash-buyer, asks them to call us back)")) return;
  btn.disabled = true; btn.textContent = "Enquiring…";
  try {
    const r = await (await fetch("/api/zoopla/enquire", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: pid, dry_run: false }),
    })).json();
    if (r.ok) { btn.textContent = "✉️ Enquired ✓"; loadPotential(); }
    else { btn.disabled = false; btn.textContent = "✉️ Enquire"; alert("Enquiry failed: " + (r.error || "")); }
  } catch (e) { btn.disabled = false; btn.textContent = "✉️ Enquire"; alert("Enquiry failed: " + e); }
}

$("btn-comps").onclick = async () => {
  const r = await (await fetch("/api/zoopla/comps/fetch", { method: "POST" })).json();
  if (!r.ok) { alert(r.error || "no potential listings"); return; }
  if (!logOpen) toggleLog();
  addLog(`Fetching comps for ${r.count} potential listings…`, "info");
};

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
  if (d.type === "comp_done") { addLog("--- comps complete ---", "info"); loadPotential(); }
};

// ═══════════ RENT mode ═══════════
function setMode(mode) {
  const sale = mode === "sale";
  $("sale-view").classList.toggle("hidden", !sale);
  $("rent-view").classList.toggle("hidden", sale);
  $("mode-sale").className = "px-4 py-1.5 " + (sale ? "bg-purple-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50");
  $("mode-rent").className = "px-4 py-1.5 " + (!sale ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50");
  if (!sale) { loadRentCounts(); loadRentAgents(); loadBlacklist(); }
}
$("mode-sale").onclick = () => setMode("sale");
$("mode-rent").onclick = () => setMode("rent");

async function loadRentCounts() {
  try {
    const c = await (await fetch("/api/zoopla/rent/counts")).json();
    $("r-c-agents").textContent = c.agents;
    $("r-c-tomsg").textContent = c.to_message;
    $("r-c-bl").textContent = c.blacklisted;
  } catch (e) {}
}

async function loadRentAgents() {
  const agents = await (await fetch("/api/zoopla/rent/agents")).json();
  $("r-agent-count").textContent = agents.length;
  const box = $("r-agents"); box.innerHTML = "";
  $("r-empty").classList.toggle("hidden", agents.length > 0);
  for (const a of agents) {
    const div = document.createElement("div");
    div.className = "p-3 flex items-center justify-between gap-3";
    div.innerHTML = `
      <div class="min-w-0">
        <div class="font-bold text-slate-800 text-sm">${a.agent_name || "Unknown agent"}</div>
        <div class="text-xs text-slate-500 truncate">cheapest: <strong>${a.price || ""}</strong> · ${a.address || ""}
          · <a href="${a.listing_url}" target="_blank" class="text-emerald-600 underline">view</a></div>
      </div>
      <button data-id="${a.property_id}" data-key="${a.agent_key}" data-name="${(a.agent_name||'').replace(/"/g,'&quot;')}" data-addr="${(a.address||'').replace(/"/g,'&quot;')}"
        class="r-enq bg-sky-600 hover:bg-sky-700 text-white rounded px-3 py-1 text-xs font-semibold shrink-0">✉️ Message</button>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".r-enq").forEach(b => b.onclick = () => messageOneAgent(b));
}

async function messageOneAgent(btn) {
  if (!confirm(`Message ${btn.dataset.name} (rent-to-rent pitch)? They'll be blacklisted after.`)) return;
  btn.disabled = true; btn.textContent = "Messaging…";
  try {
    const r = await (await fetch("/api/zoopla/enquire", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: btn.dataset.id, dry_run: false, kind: "rent" }),
    })).json();
    if (r.ok) {
      await fetch("/api/zoopla/blacklist/add", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_key: btn.dataset.key, agent_name: btn.dataset.name, property_id: btn.dataset.id, address: btn.dataset.addr }) }).catch(()=>{});
      loadRentAgents(); loadBlacklist(); loadRentCounts();
    } else { btn.disabled = false; btn.textContent = "✉️ Message"; alert("Failed: " + (r.error || "")); }
  } catch (e) { btn.disabled = false; btn.textContent = "✉️ Message"; alert("Failed: " + e); }
}

$("r-msgall").onclick = async () => {
  if (!confirm("Message every new agent with the rent-to-rent pitch? Each is messaged once, then blacklisted.")) return;
  const r = await (await fetch("/api/zoopla/rent/message-all", { method: "POST" })).json();
  if (!r.ok) { alert(r.error || "nothing to message"); return; }
  if (!logOpen) toggleLog();
  addLog(`Messaging ${r.count} new agents (rent-to-rent)…`, "info");
};

async function loadBlacklist() {
  const bl = await (await fetch("/api/zoopla/blacklist")).json();
  $("r-bl-count").textContent = bl.length;
  const box = $("r-blacklist"); box.innerHTML = "";
  $("r-bl-empty").classList.toggle("hidden", bl.length > 0);
  for (const b of bl) {
    const div = document.createElement("div");
    div.className = "p-3 flex items-center justify-between gap-3 text-sm";
    const days = b.days_on_blacklist == null ? "" : `${b.days_on_blacklist} day${b.days_on_blacklist === 1 ? "" : "s"} ago`;
    div.innerHTML = `
      <div class="min-w-0"><span class="font-semibold text-slate-800">${b.agent_name || b.agent_key}</span>
        <span class="text-xs text-slate-400 ml-2">messaged ${days}</span></div>
      <button data-key="${b.agent_key}" class="r-unbl bg-slate-200 hover:bg-rose-200 rounded px-2 py-1 text-xs">Remove</button>`;
    box.appendChild(div);
  }
  box.querySelectorAll(".r-unbl").forEach(b => b.onclick = async () => {
    await fetch("/api/zoopla/blacklist/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_key: b.dataset.key }) });
    loadBlacklist(); loadRentAgents(); loadRentCounts();
  });
}

$("r-start").onclick = async () => {
  const urls = $("r-urls").value.trim();
  if (!urls) { alert("Paste at least one Zoopla to-rent URL"); return; }
  const r = await (await fetch("/api/zoopla/rent/start", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, max_pages: parseInt($("r-max").value) || 5 }) })).json();
  if (!r.ok) { alert("Start failed: " + (r.error || "")); return; }
  $("r-stop").classList.remove("hidden");
  if (!logOpen) toggleLog();
  addLog(`Scraping ${r.count} rental search URL(s)…`, "info");
};
$("r-stop").onclick = async () => { await fetch("/api/zoopla/rent/stop", { method: "POST" }); $("r-stop").classList.add("hidden"); };

// ── Pitch editor ──
$("btn-pitch").onclick = async () => {
  const p = await (await fetch("/api/zoopla/pitch")).json();
  $("pitch-sale").value = p.sale || ""; $("pitch-rent").value = p.rent || "";
  $("pitch-modal").classList.remove("hidden");
};
$("pitch-cancel").onclick = () => $("pitch-modal").classList.add("hidden");
$("pitch-save").onclick = async () => {
  await fetch("/api/zoopla/pitch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "sale", text: $("pitch-sale").value }) });
  await fetch("/api/zoopla/pitch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "rent", text: $("pitch-rent").value }) });
  $("pitch-modal").classList.add("hidden");
};

// rent SSE hooks
const _origOnMsg = es.onmessage;
es.onmessage = (e) => {
  _origOnMsg(e);
  const d = JSON.parse(e.data);
  if (d.type === "zoopla_rent_msg_done") { addLog(`--- messaged ${d.sent} agents ---`, "info"); loadRentAgents(); loadBlacklist(); loadRentCounts(); }
  if ((d.type === "zoopla_done" || d.type === "zoopla_metrics") && !$("rent-view").classList.contains("hidden")) { loadRentCounts(); loadRentAgents(); }
};

refreshCounts();
loadListings();
loadPotential();
