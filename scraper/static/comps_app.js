const $ = (id) => document.getElementById(id);

let properties = [];
let selectedIdx = -1;
let logOpen = false;
let elsieSent = {};          // property_id -> sent_at (sent to Elsie to CALL)
let elsieEnquired = {};      // property_id -> enquired_at (email/form enquiry sent)
let currentValuation = null; // server-side valuation for the selected property
let currentValuationPromise = null; // pending fetch — Enter-to-send awaits it
let valuations = {};         // property_id -> {pursue, verdict, has_offer} from /api/valuation/batch
let activeTab = "tosend";    // "tosend" | "sent"
let hideNoEvidence = localStorage.getItem("compsHideNoEvidence") !== "0";

// Small per-card verdict labels (mirrors VERDICT_STYLES on the banner)
const CARD_VERDICTS = {
  great_deal:            ["bg-emerald-100 text-emerald-700", "Great deal"],
  great_deal_suspicious: ["bg-amber-100 text-amber-700", "Cheap — verify"],
  fair:                  ["bg-blue-100 text-blue-700", "Fair"],
  overpriced:            ["bg-rose-100 text-rose-700", "Overpriced"],
  insufficient_data:     ["bg-slate-100 text-slate-400", "No evidence"],
};

function isNoEvidence(p) {
  const v = valuations[p.property_id];
  return !!v && (v.verdict === "insufficient_data" || v.has_offer === false);
}

// Indices into `properties` currently visible under the active tab + filter.
function visibleIndices() {
  const out = [];
  properties.forEach((p, i) => {
    const sent = !!elsieSent[p.property_id];
    if (activeTab === "sent") { if (sent) out.push(i); return; }
    if (sent) return;
    if (hideNoEvidence && isNoEvidence(p)) return;
    out.push(i);
  });
  return out;
}

function updateCounts() {
  let sent = 0, skipped = 0, tosend = 0;
  properties.forEach((p) => {
    if (elsieSent[p.property_id]) { sent++; return; }
    if (isNoEvidence(p)) { skipped++; if (!hideNoEvidence) tosend++; return; }
    tosend++;
  });
  $("count-tosend").textContent = tosend;
  $("count-sent").textContent = sent;
  $("count-skipped").textContent = skipped;
}

const MAX_COMP_DISTANCE = 200;
function isNearby(c) {
  const label = c.distance_label || "";
  if (label.includes("Same building") || label.includes("Same road")) return true;
  const parsed = parseInt(c.distance_m);
  const dist = isNaN(parsed) ? 999999 : parsed;
  return dist <= MAX_COMP_DISTANCE;
}

// ─── Load properties ─────────────────────────────────────────────
async function loadProperties() {
  const r = await fetch("/api/comps/properties");
  properties = await r.json();
  try { elsieSent = await (await fetch("/api/elsie/sent")).json(); } catch (e) { elsieSent = {}; }
  try { elsieEnquired = await (await fetch("/api/elsie/enquired")).json(); } catch (e) { elsieEnquired = {}; }
  try { valuations = await (await fetch("/api/valuation/batch")).json(); } catch (e) { valuations = {}; }
  $("s-count").textContent = properties.length;

  if (properties.length === 0) {
    $("empty-msg").classList.remove("hidden");
    $("prop-list").innerHTML = "";
    updateCounts();
    return;
  }

  $("empty-msg").classList.add("hidden");
  renderList();
}

function renderList() {
  const container = $("prop-list");
  container.innerHTML = "";
  updateCounts();

  const vis = visibleIndices();
  if (vis.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-400 py-8 text-sm">'
      + (activeTab === "sent" ? "Nothing sent to Elsie yet" : "Nothing left to send") + "</div>";
    return;
  }

  vis.forEach((i) => {
    const p = properties[i];
    const div = document.createElement("div");
    const hasComps = p.comps && p.comps.length > 0;
    div.className = "prop-card p-3 rounded-lg border "
      + (i === selectedIdx ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white");
    div.dataset.idx = i;

    const price = p.price_qualifier ? `${p.price_qualifier} ${p.price}` : (p.price || "No price");

    let badge;
    if (activeTab === "sent") {
      const when = (elsieSent[p.property_id] || "").slice(0, 10);
      badge = `<span class="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Sent ✓${when ? " " + when : ""}</span>`;
    } else {
      const v = valuations[p.property_id];
      const style = v && v.verdict && CARD_VERDICTS[v.verdict];
      if (style) {
        badge = `<span class="text-xs px-1.5 py-0.5 rounded font-medium ${style[0]}">${style[1]}</span>`;
      } else {
        badge = hasComps
          ? '<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Comps ready</span>'
          : '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">No comps</span>';
      }
    }

    div.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <div class="font-bold text-slate-800 text-sm">${price}</div>
          <div class="text-xs text-slate-500 mt-0.5">${p.address || "No address"}</div>
          <div class="text-xs text-slate-400 mt-0.5">${p.bedrooms || "?"} bed &middot; ${p.property_type || "Unknown"}</div>
        </div>
        ${badge}
      </div>`;
    div.onclick = () => selectProperty(i);
    container.appendChild(div);
    if (i === selectedIdx) div.scrollIntoView({ block: "nearest" });
  });
}

// ─── Tabs + filter ───────────────────────────────────────────────
function setTab(tab) {
  activeTab = tab;
  const on = "flex-1 px-2 py-1 rounded text-xs font-semibold bg-emerald-600 text-white";
  const off = "flex-1 px-2 py-1 rounded text-xs font-semibold bg-white text-slate-500 border border-slate-200 hover:bg-slate-50";
  $("tab-tosend").className = tab === "tosend" ? on : off;
  $("tab-sent").className = tab === "sent" ? on : off;
  renderList();
}
$("tab-tosend").onclick = () => setTab("tosend");
$("tab-sent").onclick = () => setTab("sent");

$("filter-skips").checked = hideNoEvidence;
$("filter-skips").onchange = (e) => {
  hideNoEvidence = e.target.checked;
  localStorage.setItem("compsHideNoEvidence", hideNoEvidence ? "1" : "0");
  renderList();
};

// ─── Select property ─────────────────────────────────────────────
function selectProperty(idx) {
  if (idx < 0 || idx >= properties.length) return;
  selectedIdx = idx;
  const p = properties[idx];

  renderList();

  $("no-selection").classList.add("hidden");
  $("comps-panel").classList.remove("hidden");

  const price = p.price_qualifier ? `${p.price_qualifier} ${p.price}` : (p.price || "No price");
  $("cp-price").textContent = price;
  $("cp-address").textContent = p.address || "";
  const beds = parseInt(p.bedrooms) || 1;
  const targetBeds = beds + 1;
  $("cp-info").textContent = `${beds} bed ${p.property_type || ""} → converting to ${targetBeds}-bed`;
  $("cp-same-beds").textContent = beds;
  $("cp-target-beds-sale").textContent = targetBeds;
  $("cp-target-beds-rent").textContent = targetBeds;

  if (p.listing_url) {
    $("cp-link").href = p.listing_url;
    $("cp-link").classList.remove("hidden");
  } else {
    $("cp-link").classList.add("hidden");
  }

  const sendBtn = $("btn-send-elsie");
  sendBtn.classList.remove("hidden");
  if (elsieSent[p.property_id]) {
    sendBtn.textContent = "📞 Sent to call ✓";
    sendBtn.disabled = true;
  } else {
    sendBtn.textContent = "📞 Call";
    sendBtn.disabled = false;
  }

  const enqBtn = $("btn-enquire");
  if (enqBtn) {
    enqBtn.classList.remove("hidden");
    if (elsieEnquired[p.property_id]) {
      enqBtn.textContent = "✉️ Enquired ✓";
      enqBtn.disabled = true;
    } else {
      enqBtn.textContent = "✉️ Enquire";
      enqBtn.disabled = false;
    }
  }

  const comps = p.comps || [];
  const soldSame = comps.filter(c => c.comp_type === "sale_same" && isNearby(c));
  const soldTarget = comps.filter(c => c.comp_type === "sale_target" && isNearby(c));
  const soldLegacy = comps.filter(c => c.comp_type === "sale" && isNearby(c));
  const rent = comps.filter(c => c.comp_type === "rent");

  populateCalcFromProperty(p);
  calcGdv();
  updateBadges(p);
  currentValuationPromise = loadValuation(p);

  if (comps.length === 0) {
    $("cp-no-comps").classList.remove("hidden");
    $("sold-section").classList.add("hidden");
    $("rent-section").classList.add("hidden");
    $("offer-banner").classList.add("hidden");
    return;
  }

  $("cp-no-comps").classList.add("hidden");

  const hasSold = soldSame.length > 0 || soldTarget.length > 0 || soldLegacy.length > 0;
  if (hasSold) {
    $("sold-section").classList.remove("hidden");

    // Same-bed column
    if (soldSame.length > 0) {
      const sameMedian = getMedianPrice(soldSame);
      $("sold-same-list").innerHTML = soldSame.map(c => compCard(c, "sale", sameMedian)).join("");
      $("sold-same-empty").classList.add("hidden");
    } else {
      $("sold-same-list").innerHTML = "";
      $("sold-same-empty").classList.remove("hidden");
    }

    // Target-bed column (fallback to legacy "sale" type)
    const targetComps = soldTarget.length > 0 ? soldTarget : soldLegacy;
    if (targetComps.length > 0) {
      let targetWarning = "";
      if (targetComps.length < 3) {
        targetWarning = '<div class="bg-amber-100 text-amber-800 text-sm font-semibold rounded-lg p-3 mb-3">WARNING: Only ' + targetComps.length + ' target-bed comp' + (targetComps.length === 1 ? '' : 's') + ' — not enough evidence</div>';
      }
      const targetMedian = getMedianPrice(targetComps);
      $("sold-target-list").innerHTML = targetWarning + targetComps.map(c => compCard(c, "sale", targetMedian)).join("");
      $("sold-target-empty").classList.add("hidden");
    } else {
      $("sold-target-list").innerHTML = "";
      $("sold-target-empty").classList.remove("hidden");
    }
  } else {
    $("sold-section").classList.add("hidden");
  }

  if (rent.length > 0) {
    $("rent-section").classList.remove("hidden");
    $("rent-list").innerHTML = rent.map(c => compCard(c, "rent")).join("");
  } else {
    $("rent-section").classList.add("hidden");
  }
}

function getMedianPrice(comps) {
  const prices = comps.map(c => parseInt((c.price || "").replace(/[^0-9]/g, "")) || 0).filter(v => v > 0);
  if (prices.length === 0) return 0;
  prices.sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)];
}

function compCard(comp, type, groupMedian) {
  const color = type === "sale" ? "blue" : "purple";
  const label = type === "sale" ? "Sold" : "Rent";
  const dateLabel = type === "sale" ? comp.date_info : (comp.date_info || "pcm");

  let linkHtml = "";
  if (comp.url) {
    const linkLabel = comp.url.includes("zoopla") ? "View on Zoopla" : "View on Rightmove";
    linkHtml = `<a href="${comp.url}" target="_blank" class="text-${color}-600 text-xs underline">${linkLabel}</a>`;
  }

  const distLabel = comp.distance_label
    ? `<span class="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">${comp.distance_label}</span>`
    : "";

  const source = comp.source || "Rightmove";
  let sourceBadge = '';
  if (source === "Land Registry") {
    sourceBadge = '<span class="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">Land Registry</span>';
  } else if (source === "Zoopla") {
    sourceBadge = '<span class="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">Zoopla Verified</span>';
  }

  // BMV detection — flag comps that sold 25%+ below group median
  let bmvBadge = "";
  if (type === "sale" && groupMedian > 0) {
    const compPrice = parseInt((comp.price || "").replace(/[^0-9]/g, "")) || 0;
    if (compPrice > 0 && compPrice < groupMedian * 0.75) {
      bmvBadge = '<span class="text-xs px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium">Probably sold BMV</span>';
    }
  }

  return `
    <div class="bg-white rounded-lg border border-slate-200 p-3 flex items-center justify-between">
      <div>
        <div class="font-bold text-slate-800">${comp.price || "N/A"}</div>
        <div class="text-xs text-slate-500">${comp.address || "No address"}</div>
        <div class="text-xs text-slate-400 mt-0.5">${comp.bedrooms || "?"} bed &middot; ${comp.property_type || ""} &middot; ${dateLabel}${comp.floor_area_sqm ? " &middot; " + comp.floor_area_sqm + " sq m (" + Math.round(comp.floor_area_sqm * 10.764) + " sq ft)" : ""}</div>
      </div>
      <div class="flex flex-col items-end gap-1">
        ${distLabel}
        ${bmvBadge}
        ${sourceBadge}
        <span class="text-xs px-2 py-0.5 rounded bg-${color}-100 text-${color}-700 font-medium">${label}</span>
        ${linkHtml}
      </div>
    </div>`;
}

// ─── Fetch comps ────────────────────────────────────────────────
// ─── Send to Elsie (BRRR qualifier) ──────────────────────────────
// Sends the selected property + the calculator's current numbers to Elsie,
// where the AI voice agent can call the listing agent and qualify it.
// Triggered by the button or the Enter key; advances to the next property
// after a successful send so the down-enter-down-enter flow is seamless.
async function sendSelectedToElsie() {
  if (selectedIdx < 0) return;
  const p = properties[selectedIdx];
  if (elsieSent[p.property_id]) return; // already sent
  const btn = $("btn-send-elsie");

  // Enter can land before the valuation fetch finishes — wait for it so the
  // deal payload carries real numbers instead of a false "no valuation".
  if (currentValuationPromise) { try { await currentValuationPromise; } catch (e) { /* banner shows the error */ } }

  const v = currentValuation;
  if (!v || !v.offer || !v.offer.max) {
    if (!confirm("No reliable valuation for this property (insufficient sold evidence). " +
                 "Elsie will have NO offer numbers for the call. Send anyway?")) return;
  } else if (v.pursue === false) {
    if (!confirm(`The engine says SKIP this one (${(v.offer.verdict || "").replace(/_/g, " ")}). Send anyway?`)) return;
  }

  btn.disabled = true;
  btn.textContent = "Sending…";

  const num = (id) => parseFloat($(id).value) || 0;
  const parseMoney = (t) => parseInt((t || "").replace(/[^0-9-]/g, "")) || 0;
  const deal = {
    // Research-backed valuation engine output (valuation.py) — offers are a
    // % of worth-now value, never of GDV, never above asking.
    asking_price: parseMoney(p.price),
    cmv: v && v.cmv ? v.cmv.estimate : null,
    cmv_confidence: v && v.cmv ? v.cmv.confidence : null,
    offer_min: v && v.offer ? (v.offer.open ?? v.offer.max) : null,
    offer_max: v && v.offer ? v.offer.max : null,
    offer_price: v && v.offer ? v.offer.max : null,   // back-compat for displays
    offer_mode: v && v.offer ? v.offer.mode : null,
    valuation_verdict: v && v.offer ? v.offer.verdict : null,
    pursue: v ? v.pursue : null,
    gdv: v && v.gdv ? v.gdv.estimate : null,
    stack_verdict: v && v.stack ? v.stack.verdict : null,
    // Negotiation pack for Elsie's call: the ladder she climbs, the sold
    // evidence she can quote, and the engine's warnings in raw form.
    ladder: v && v.offer && v.offer.ladder ? v.offer.ladder : [],
    evidence: v && v.cmv && v.cmv.audit
      ? v.cmv.audit.filter(a => a.included)
          .sort((a, b) => (b.weight || 0) - (a.weight || 0))
          .slice(0, 3)
          .map(a => `${a.address} sold £${Number(a.price).toLocaleString()} (${String(a.date).slice(0, 7)})`)
      : [],
    flags: v ? [...((v.offer && v.offer.flags) || []), ...((v.gdv && v.gdv.flags) || [])] : [],
    refurb: num("calc-refurb"),
    rent: v && v.rent && v.rent.estimate ? v.rent.estimate : num("calc-rent"),
    term_months: num("calc-term"),
    total_cash: parseMoney($("r-total-cash").textContent),
    verdict: $("calc-verdict").textContent || "",
  };

  try {
    const r = await fetch("/api/elsie/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: p.property_id, deal }),
    });
    const body = await r.json();
    if (body.ok) {
      // Remember where we were in the visible list, mark sent (which moves the
      // card to the Sent tab), then select whatever now sits in that slot.
      const posBefore = visibleIndices().indexOf(selectedIdx);
      elsieSent[p.property_id] = new Date().toISOString();
      btn.textContent = "Sent to Elsie ✓";
      const vis = visibleIndices();
      if (activeTab === "tosend" && vis.length > 0) {
        selectProperty(vis[Math.min(Math.max(posBefore, 0), vis.length - 1)]);
      } else {
        renderList();
      }
    } else {
      btn.textContent = "Failed — retry";
      btn.disabled = false;
      alert("Send to Elsie failed: " + (body.error || r.status));
    }
  } catch (e) {
    btn.textContent = "Failed — retry";
    btn.disabled = false;
    alert("Send to Elsie failed: " + e);
  }
}

$("btn-send-elsie").onclick = sendSelectedToElsie;

// ─── Enquire by email/form (alternative to calling) ──────────────────────────
// Fills the property's Rightmove enquiry form as a cash-buyer enquiry asking
// the agent to call us back. One at a time; agent replies route to Elsie.
async function enquireSelected() {
  if (selectedIdx < 0) return;
  const p = properties[selectedIdx];
  if (elsieEnquired[p.property_id]) return;
  const btn = $("btn-enquire");

  if (!confirm(`Send a real enquiry on "${p.address || "this property"}"?\n\n` +
               `This fills the Rightmove contact form and submits it to the agent ` +
               `as a cash-buyer enquiry asking them to call us back. One genuine enquiry.`)) {
    return;
  }

  btn.disabled = true;
  btn.textContent = "Enquiring…";
  try {
    const r = await fetch("/api/elsie/enquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: p.property_id, dry_run: false }),
    });
    const body = await r.json();
    if (body.ok) {
      elsieEnquired[p.property_id] = new Date().toISOString();
      btn.textContent = "✉️ Enquired ✓";
      renderList();
    } else {
      btn.textContent = "Failed — retry";
      btn.disabled = false;
      alert("Enquiry failed: " + (body.error || r.status));
    }
  } catch (e) {
    btn.textContent = "Failed — retry";
    btn.disabled = false;
    alert("Enquiry failed: " + e);
  }
}

$("btn-enquire").onclick = enquireSelected;

// ─── Action chooser: Enter (or click) asks Call vs Enquire ──────────────────
let chooserOpen = false;
function openActionChooser() {
  if (selectedIdx < 0) return;
  const p = properties[selectedIdx];
  if (!p) return;
  closeActionChooser();
  chooserOpen = true;
  const el = document.createElement("div");
  el.id = "action-chooser";
  el.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/40";
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl p-5 w-80" onclick="event.stopPropagation()">
      <div class="text-sm font-semibold text-slate-800 mb-1">How should Elsie make contact?</div>
      <div class="text-xs text-slate-500 mb-4 truncate">${p.address || "this property"}</div>
      <div class="grid grid-cols-2 gap-3">
        <button id="choose-call" class="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-3 text-sm font-semibold">
          📞 Call <span class="block text-[11px] font-normal opacity-80">press C</span>
        </button>
        <button id="choose-enquire" class="bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-3 text-sm font-semibold">
          ✉️ Enquire <span class="block text-[11px] font-normal opacity-80">press E</span>
        </button>
      </div>
      <div class="text-[11px] text-slate-400 text-center mt-3">Esc to cancel</div>
    </div>`;
  el.onclick = closeActionChooser;
  document.body.appendChild(el);
  $("choose-call").onclick = () => { closeActionChooser(); sendSelectedToElsie(); };
  $("choose-enquire").onclick = () => { closeActionChooser(); enquireSelected(); };
}
function closeActionChooser() {
  const el = $("action-chooser");
  if (el) el.remove();
  chooserOpen = false;
}

// ─── Keyboard flow: ↑↓ move, Enter opens the Call/Enquire chooser ──────────
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  if (!$("fetch-modal").classList.contains("hidden")) return;

  if (chooserOpen) {
    if (e.key === "Escape") { e.preventDefault(); closeActionChooser(); }
    else if (e.key === "c" || e.key === "C") { e.preventDefault(); closeActionChooser(); sendSelectedToElsie(); }
    else if (e.key === "e" || e.key === "E") { e.preventDefault(); closeActionChooser(); enquireSelected(); }
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const vis = visibleIndices();
    if (vis.length === 0) return;
    const pos = vis.indexOf(selectedIdx);
    let next;
    if (pos === -1) {
      next = vis[0];
    } else if (e.key === "ArrowDown") {
      next = vis[Math.min(pos + 1, vis.length - 1)];
    } else {
      next = vis[Math.max(pos - 1, 0)];
    }
    selectProperty(next);
  }

  if (e.key === "Enter") {
    e.preventDefault();
    openActionChooser();
  }
});

$("btn-fetch").onclick = () => $("fetch-modal").classList.remove("hidden");
$("f-cancel").onclick = () => $("fetch-modal").classList.add("hidden");

$("f-start").onclick = async () => {
  $("fetch-modal").classList.add("hidden");

  const body = {
    headless: $("f-headless").checked,
    delay_min: parseFloat($("f-dmin").value || "3"),
    delay_max: parseFloat($("f-dmax").value || "6")
  };

  const r = await fetch("/api/comps/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();

  if (!data.ok) {
    addLog(data.error || "No properties to fetch comps for", "warn");
    return;
  }

  $("btn-stop").classList.remove("hidden");
  if (!logOpen) toggleLog();
  addLog(`Fetching comps for ${data.count} properties...`, "info");
};

$("btn-stop").onclick = async () => {
  await fetch("/api/comps/stop", { method: "POST" });
  $("btn-stop").classList.add("hidden");
};

// ─── SSE ─────────────────────────────────────────────────────────
const es = new EventSource("/stream");
es.onmessage = (e) => {
  const d = JSON.parse(e.data);

  if (d.type === "comp_metrics") {
    addLog(`Progress: ${d.done}/${d.total} — ${d.current}`, "info");
  }

  if (d.type === "comp_found") {
    addLog(`Comps found: ${d.sold} sold, ${d.rent} rental`, "info");
    loadProperties();
  }

  if (d.type === "comp_done") {
    addLog("--- Comps fetch complete ---", "info");
    $("btn-stop").classList.add("hidden");
    loadProperties();
  }

  if (d.type === "log") {
    addLog(`[${d.ts || ""}] ${d.msg}`, d.level);
  }
};

// ─── Log panel ───────────────────────────────────────────────────
function addLog(msg, level) {
  const div = document.createElement("div");
  const colors = { warn: "text-amber-400", error: "text-rose-400", info: "text-slate-300" };
  div.className = "log-line " + (colors[level] || "text-slate-400");
  div.textContent = msg;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}

function toggleLog() {
  logOpen = !logOpen;
  $("log-panel").style.height = logOpen ? "200px" : "0";
  $("log-toggle").textContent = logOpen ? "Hide Log" : "Log";
}

$("log-toggle").onclick = toggleLog;

// ─── Deal Calculator ────────────────────────────────────────────
const SOLICITOR = 3200;
const SURVEYS = 1350;
const SDLT_RATE = 0.05;
const BRIDGE_RATE = 0.01;
const ARR_FEE_RATE = 0.02;
const BTL_RATE = 0.055;
const INSURANCE = 50;

function fmt(n) {
  if (n < 0) return "-£" + Math.abs(Math.round(n)).toLocaleString();
  return "£" + Math.round(n).toLocaleString();
}

function syncSlider(inputId, sliderId) {
  const inp = $(inputId), sl = $(sliderId);
  inp.oninput = () => { sl.value = inp.value; calcDeal(); };
  sl.oninput = () => { inp.value = sl.value; calcDeal(); };
}

syncSlider("calc-mv", "calc-mv-slider");
syncSlider("calc-refurb", "calc-refurb-slider");
syncSlider("calc-rent", "calc-rent-slider");
syncSlider("calc-term", "calc-term-slider");

function calcDeal() {
  const mv = parseFloat($("calc-mv").value) || 0;
  const refurb = parseFloat($("calc-refurb").value) || 0;
  const rent = parseFloat($("calc-rent").value) || 0;
  const term = parseInt($("calc-term").value) || 6;

  const purchase = mv * 0.75;
  const bridge = mv * 0.75;
  const arrFee = bridge * ARR_FEE_RATE;
  const interest = bridge * BRIDGE_RATE * term;
  const netLoan = bridge - arrFee - interest;
  const gap = purchase - netLoan;
  const sdlt = purchase * SDLT_RATE;
  const totalCash = gap + sdlt + SOLICITOR + SURVEYS;

  $("r-purchase").textContent = fmt(purchase);
  $("r-bridge").textContent = fmt(bridge);
  $("r-arr-fee").textContent = "-" + fmt(arrFee);
  $("r-term-label").textContent = term;
  $("r-interest").textContent = "-" + fmt(interest);
  $("r-net-loan").textContent = fmt(netLoan);
  $("r-gap").textContent = fmt(gap);
  $("r-gap2").textContent = fmt(gap);
  $("r-sdlt").textContent = fmt(sdlt);
  $("r-total-cash").textContent = fmt(totalCash);
  $("r-jv-in").textContent = fmt(totalCash);

  const scenarios = [
    { label: "Best case (40% uplift)", pct: 0.40, cls: "bg-emerald-50" },
    { label: "Good case (35% uplift)", pct: 0.35, cls: "bg-emerald-50/50" },
    { label: "Okay case (30% uplift)", pct: 0.30, cls: "bg-amber-50" },
    { label: "Worst case (25% uplift)", pct: 0.25, cls: "bg-rose-50" },
  ];

  const refiBody = $("refi-rows");
  refiBody.innerHTML = "";

  let bestMortgage = 0;
  scenarios.forEach((s, i) => {
    const arv = mv * (1 + s.pct);
    const newMortgage = arv * 0.75;
    const payoff = bridge + refurb;
    const cashBack = newMortgage - payoff;
    const result = cashBack - totalCash;

    if (i === 0) bestMortgage = newMortgage;

    const resultColor = result >= 0 ? "text-emerald-700 font-bold" : "text-rose-600 font-bold";
    const resultText = result >= 0 ? "+" + fmt(result) : fmt(result);

    refiBody.innerHTML += `
      <tr class="${s.cls} border-b">
        <td class="px-3 py-2 font-medium text-slate-700">${s.label}</td>
        <td class="px-3 py-2 text-right">${fmt(arv)}</td>
        <td class="px-3 py-2 text-right">${fmt(newMortgage)}</td>
        <td class="px-3 py-2 text-right text-rose-600">${fmt(-payoff)}</td>
        <td class="px-3 py-2 text-right font-semibold">${fmt(cashBack)}</td>
        <td class="px-3 py-2 text-right ${resultColor}">${resultText}</td>
      </tr>`;

    if (i === 0) {
      refiBody.innerHTML += `
        <tr class="bg-emerald-100 border-b">
          <td colspan="4" class="px-3 py-1.5 text-xs text-emerald-700">Investor originally put in</td>
          <td class="px-3 py-1.5 text-right text-xs font-semibold text-emerald-700">${fmt(totalCash)}</td>
          <td></td>
        </tr>`;
    }
    if (i === scenarios.length - 1) {
      refiBody.innerHTML += `
        <tr class="bg-rose-100">
          <td colspan="4" class="px-3 py-1.5 text-xs text-rose-700">Investor originally put in</td>
          <td class="px-3 py-1.5 text-right text-xs font-semibold text-rose-700">${fmt(totalCash)}</td>
          <td></td>
        </tr>`;
    }
  });

  const moMortgage = (bestMortgage * BTL_RATE) / 12;
  const moProfit = rent - moMortgage - INSURANCE;
  $("r-mo-rent").textContent = fmt(rent);
  $("r-mo-mortgage").textContent = "-" + fmt(moMortgage);
  $("r-mo-profit").textContent = fmt(moProfit);
  $("r-mo-investor").textContent = fmt(moProfit * 0.4);
  $("r-mo-partner1").textContent = fmt(moProfit * 0.3);
  $("r-mo-partner2").textContent = fmt(moProfit * 0.3);

  const verdict = $("calc-verdict");
  if (mv > 160000) {
    verdict.className = "rounded-lg p-4 text-center font-bold text-lg bg-rose-100 text-rose-700";
    verdict.textContent = "Above £160k market value cap — walk away";
  } else if (purchase > 120000) {
    verdict.className = "rounded-lg p-4 text-center font-bold text-lg bg-rose-100 text-rose-700";
    verdict.textContent = "Purchase price above £120k hard ceiling — walk away";
  } else if (totalCash > 25000) {
    verdict.className = "rounded-lg p-4 text-center font-bold text-lg bg-amber-100 text-amber-700";
    verdict.textContent = "Cash needed exceeds £25k budget — needs JV from day 1";
  } else {
    verdict.className = "rounded-lg p-4 text-center font-bold text-lg bg-emerald-100 text-emerald-700";
    verdict.textContent = "Deal fits within £25k budget";
  }
}

function populateCalcFromProperty(p) {
  const priceStr = (p.price || "").replace(/[^0-9]/g, "");
  const askingPrice = parseInt(priceStr) || 0;

  if (askingPrice > 0) {
    $("calc-mv").value = askingPrice;
    $("calc-mv-slider").value = Math.min(200000, Math.max(50000, askingPrice));
  }

  // Auto-populate property size from listing data first, then same-bed comp EPC
  if (p.floor_area_sqft && parseInt(p.floor_area_sqft) > 0) {
    $("gdv-sqft").value = parseInt(p.floor_area_sqft);
    $("gdv-sqft-slider").value = Math.min(1200, Math.max(300, parseInt(p.floor_area_sqft)));
    $("gdv-sqm").value = Math.round(parseInt(p.floor_area_sqft) / 10.764);
  } else if (p.floor_area_sqm && parseFloat(p.floor_area_sqm) > 0) {
    const sqft = Math.round(parseFloat(p.floor_area_sqm) * 10.764);
    $("gdv-sqft").value = sqft;
    $("gdv-sqft-slider").value = Math.min(1200, Math.max(300, sqft));
    $("gdv-sqm").value = Math.round(parseFloat(p.floor_area_sqm));
  } else {
    const comps = p.comps || [];
    const sameBedComps = comps.filter(c => c.comp_type === "sale_same" && isNearby(c) && c.floor_area_sqm && parseFloat(c.floor_area_sqm) > 0);
    if (sameBedComps.length > 0) {
      const avgSqm = sameBedComps.reduce((a, c) => a + parseFloat(c.floor_area_sqm), 0) / sameBedComps.length;
      const sqft = Math.round(avgSqm * 10.764);
      $("gdv-sqft").value = sqft;
      $("gdv-sqft-slider").value = Math.min(1200, Math.max(300, sqft));
      $("gdv-sqm").value = Math.round(avgSqm);
    }
  }

  // Default refurb to £10,000
  $("calc-refurb").value = 10000;
  $("calc-refurb-slider").value = 10000;

  const comps = p.comps || [];
  const rentComps = comps.filter(c => c.comp_type === "rent");
  if (rentComps.length > 0) {
    const prices = rentComps.map(c => parseInt((c.price || "").replace(/[^0-9]/g, "")) || 0).filter(v => v > 0);
    if (prices.length > 0) {
      const avgRent = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      $("calc-rent").value = avgRent;
      $("calc-rent-slider").value = Math.min(1500, Math.max(500, avgRent));
    }
  }

  calcDeal();
}

// ─── Badges ─────────────────────────────────────────────────────
function updateBadges(p) {
  const comps = p ? (p.comps || []) : [];
  const targetComps = comps.filter(c => c.comp_type === "sale_target" && isNearby(c));
  const legacyComps = comps.filter(c => c.comp_type === "sale" && isNearby(c));
  const soldComps = targetComps.length > 0 ? targetComps : legacyComps;
  const rentComps = comps.filter(c => c.comp_type === "rent");

  const green = "bg-emerald-100 text-emerald-700";
  const amber = "bg-amber-100 text-amber-700";
  const orange = "bg-orange-100 text-orange-700";

  // Market Value
  const mvBadge = $("badge-mv");
  if (soldComps.length >= 3) {
    mvBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + green;
    mvBadge.textContent = "Verified";
  } else if (soldComps.length > 0) {
    mvBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + amber;
    mvBadge.textContent = "Estimated";
  } else {
    mvBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + orange;
    mvBadge.textContent = "Not verified";
  }

  // Rent
  const rentBadge = $("badge-rent");
  if (rentComps.length > 0) {
    rentBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + green;
    rentBadge.textContent = "Verified";
  } else {
    rentBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + orange;
    rentBadge.textContent = "Not verified";
  }

  // Refurb — always estimate
  const refurbBadge = $("badge-refurb");
  refurbBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + orange;
  refurbBadge.textContent = "Not verified";

  // Bridge — verified (from broker)
  const bridgeBadge = $("badge-bridge");
  bridgeBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + green;
  bridgeBadge.textContent = "Verified (Aria Finance)";

  // Property Size — check listing data, then same-bed comps (same size flat)
  const sizeBadge = $("badge-size");
  const sameBedComps = comps.filter(c => c.comp_type === "sale_same" && isNearby(c));
  const sameWithArea = sameBedComps.filter(c => c.floor_area_sqm && parseFloat(c.floor_area_sqm) > 0);
  if ((p.floor_area_sqft && parseInt(p.floor_area_sqft) > 0) || (p.floor_area_sqm && parseFloat(p.floor_area_sqm) > 0)) {
    sizeBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + green;
    sizeBadge.textContent = "Verified";
  } else if (sameWithArea.length > 0) {
    sizeBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + amber;
    sizeBadge.textContent = "From comps";
  } else {
    sizeBadge.className = "text-xs px-1.5 py-0.5 rounded font-medium " + orange;
    sizeBadge.textContent = "Not verified";
  }
}

// ─── Server-side valuation (research-backed engine in valuation.py) ─────────
// Owns the offer banner. Offers derive from CURRENT market value only;
// GDV never touches the offer; nothing is ever offered above asking.
async function loadValuation(p) {
  currentValuation = null;
  const banner = $("offer-banner");
  banner.classList.remove("hidden");
  banner.className = "rounded-lg p-4 text-center border-2 border-slate-300 bg-slate-50";
  $("offer-range").textContent = "Valuing from sold comps…";
  $("offer-range").className = "text-xl font-bold text-slate-500";
  $("offer-detail").textContent = "";
  try {
    const r = await fetch(`/api/valuation/${p.property_id}`);
    const v = await r.json();
    if (!v.ok) throw new Error(v.error || `HTTP ${r.status}`);
    if (selectedIdx < 0 || properties[selectedIdx].property_id !== p.property_id) return; // stale response
    currentValuation = v;
    renderValuationBanner(v);
    // The deal calculator's "market value" is the worth-now value — never GDV.
    if (v.cmv && v.cmv.estimate) {
      $("calc-mv").value = v.cmv.estimate;
      $("calc-mv-slider").value = Math.min(200000, Math.max(50000, v.cmv.estimate));
      calcDeal();
    }
  } catch (e) {
    banner.className = "rounded-lg p-4 text-center border-2 border-rose-300 bg-rose-50";
    $("offer-range").textContent = "Valuation unavailable";
    $("offer-range").className = "text-xl font-bold text-rose-700";
    $("offer-detail").textContent = String(e.message || e);
  }
}

const VERDICT_STYLES = {
  great_deal:            ["emerald", "GREAT DEAL — asking is at or below our money"],
  great_deal_suspicious: ["amber", "LOOKS VERY CHEAP — verify why before trusting (lease? condition? cash-only?)"],
  fair:                  ["blue", "FAIR — winnable if the seller is motivated"],
  overpriced:            ["rose", "OVERPRICED — our money is far below asking; watch for price cuts"],
  insufficient_data:     ["slate", "NOT ENOUGH SOLD EVIDENCE — cannot value this safely"],
};

function renderValuationBanner(v) {
  const banner = $("offer-banner");
  const [color, headline] = VERDICT_STYLES[v.offer.verdict] || VERDICT_STYLES.insufficient_data;
  banner.className = `rounded-lg p-4 text-center border-2 border-${color}-500 bg-${color}-50`;
  $("offer-range").className = `text-xl font-bold text-${color}-800`;
  $("offer-detail").className = `text-sm text-${color}-700 mt-1`;

  const parts = [];
  if (v.cmv.estimate) {
    parts.push(`Worth now ${fmt(v.cmv.estimate)} (${v.cmv.confidence} confidence, ${v.cmv.n_used} sales)`);
    if (v.offer.mode === "auction") {
      parts.push(`Max auction bid ${fmt(v.offer.max)}`);
      if (v.offer.expected_hammer) parts.push(`guide likely reaches ~${fmt(v.offer.expected_hammer)}`);
    } else if (v.offer.max) {
      parts.push(`Open at ${fmt(v.offer.open)}, walk away above ${fmt(v.offer.max)}`);
    }
  }
  parts.push(v.gdv.estimate
    ? `After works ~${fmt(v.gdv.estimate)} (${v.gdv.confidence})`
    : "After-works value: not enough evidence");
  if (v.stack.verdict !== "insufficient_data") parts.push(`BRRR stack: ${v.stack.verdict.replace(/_/g, " ")}`);
  parts.push(v.pursue ? "✓ Worth calling the agent" : "✗ Skip — not worth a call");

  $("offer-range").textContent = headline;
  $("offer-detail").textContent = parts.join(" · ");

  const flags = [...(v.offer.flags || []), ...(v.gdv.flags || [])];
  if (flags.length) {
    $("offer-detail").textContent += " — " + flags.map(f => f.replace(/_/g, " ")).join(", ");
  }
}

// ─── GDV Calculator (Price per sq ft) ────────────────────────────
function syncGdvInputs() {
  const sqftInp = $("gdv-sqft"), sqftSlider = $("gdv-sqft-slider"), sqmInp = $("gdv-sqm");
  sqftInp.oninput = () => { sqftSlider.value = sqftInp.value; sqmInp.value = Math.round(parseFloat(sqftInp.value) / 10.764); calcGdv(); };
  sqftSlider.oninput = () => { sqftInp.value = sqftSlider.value; sqmInp.value = Math.round(parseFloat(sqftSlider.value) / 10.764); calcGdv(); };
  sqmInp.oninput = () => { const ft = Math.round(parseFloat(sqmInp.value) * 10.764); sqftInp.value = ft; sqftSlider.value = Math.min(1200, Math.max(300, ft)); calcGdv(); };
  $("gdv-ppsf").oninput = () => calcGdv();
}
syncGdvInputs();

function calcGdv() {
  const sqft = parseFloat($("gdv-sqft").value) || 0;
  const manualPpsf = parseFloat($("gdv-ppsf").value) || 0;

  const p = selectedIdx >= 0 ? properties[selectedIdx] : null;
  // Use target-bed comps for GDV (confirmed by Hugo), fallback to legacy "sale"
  const targetComps = p ? (p.comps || []).filter(c => c.comp_type === "sale_target" && isNearby(c)) : [];
  const legacyComps = p ? (p.comps || []).filter(c => c.comp_type === "sale" && isNearby(c)) : [];
  const comps = targetComps.length > 0 ? targetComps : legacyComps;

  let compPpsf = 0;
  let compRows = "";
  if (comps.length > 0) {
    const compsWithArea = comps.filter(c => c.floor_area_sqm && parseFloat(c.floor_area_sqm) > 0);
    const prices = comps.map(c => parseInt((c.price || "").replace(/[^0-9]/g, "")) || 0).filter(v => v > 0);

    if (compsWithArea.length > 0) {
      const ppsfValues = compsWithArea.map(c => {
        const pr = parseInt((c.price || "").replace(/[^0-9]/g, "")) || 0;
        const sqm = parseFloat(c.floor_area_sqm);
        const compSqft = sqm * 10.764;
        return pr / compSqft;
      });
      compPpsf = Math.round(ppsfValues.reduce((a, b) => a + b, 0) / ppsfValues.length);
    } else if (prices.length > 0) {
      const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      compPpsf = sqft > 0 ? Math.round(avgPrice / sqft) : 0;
    }

    compRows = '<div class="bg-slate-50 rounded p-2 mt-2"><div class="text-xs font-medium text-slate-600 mb-1">Target-bed sold comp prices (for GDV):</div>';
    comps.forEach(c => {
      const pr = parseInt((c.price || "").replace(/[^0-9]/g, "")) || 0;
      const sqm = c.floor_area_sqm ? parseFloat(c.floor_area_sqm) : 0;
      const compSqft = sqm > 0 ? Math.round(sqm * 10.764) : 0;
      const ppsf = compSqft > 0 ? Math.round(pr / compSqft) : (sqft > 0 ? Math.round(pr / sqft) : 0);
      let src = '';
      if (c.source === "Land Registry") src = '<span class="text-xs px-1 rounded bg-indigo-100 text-indigo-700">LR</span>';
      else if (c.source === "Zoopla") src = '<span class="text-xs px-1 rounded bg-violet-100 text-violet-700">Z</span>';
      const areaTag = compSqft > 0
        ? `<span class="text-xs px-1 rounded bg-emerald-100 text-emerald-700">${compSqft} sqft</span>`
        : '<span class="text-xs px-1 rounded bg-slate-100 text-slate-400">no size</span>';
      compRows += `<div class="flex justify-between text-xs py-0.5 items-center">
        <span class="text-slate-500">${(c.address || "").substring(0, 40)} ${src} ${areaTag}</span>
        <span class="font-medium">${c.price} ${ppsf > 0 ? "(£" + ppsf + "/sqft)" : ""}</span>
      </div>`;
    });
    if (prices.length > 0) {
      const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      compRows += `<div class="flex justify-between text-xs py-1 mt-1 border-t font-semibold">
        <span>Average of ${prices.length} comps</span>
        <span>£${avgPrice.toLocaleString()}</span>
      </div>`;
    }
    if (compsWithArea.length > 0) {
      compRows += `<div class="text-xs text-emerald-600 mt-1">Price per sq ft based on ${compsWithArea.length} comp(s) with EPC floor area data</div>`;
    } else {
      compRows += `<div class="text-xs text-amber-600 mt-1">No EPC floor area data — using property size for price/sqft estimate</div>`;
    }
    compRows += '</div>';
  }

  const noCompData = comps.length === 0;
  if (noCompData) {
    compRows = '<div class="bg-rose-50 rounded p-3 mt-2 text-sm text-rose-700 font-semibold">No target-bed sold comps found — GDV uses manual price/sqft (not reliable). Find comps manually before making an offer.</div>';
  }

  $("gdv-comp-rows").innerHTML = compRows;

  const ppsf = manualPpsf > 0 ? manualPpsf : compPpsf;
  const gdv = ppsf * sqft;

  $("gdv-avg-ppsf").textContent = ppsf > 0 ? "£" + ppsf : "-";
  $("gdv-result").textContent = gdv > 0 ? "£" + Math.round(gdv).toLocaleString() : "-";

  // This sandbox calculator no longer touches the offer banner or the deal
  // calculator's market value — those come from the server valuation engine
  // (loadValuation). It remains as a manual what-if tool only.
  const verdict = $("gdv-verdict");
  verdict.className = "rounded-lg p-3 text-center text-xs font-medium bg-slate-100 text-slate-500";
  verdict.textContent = "Manual what-if only — the green/red banner above is the real valuation.";
}

// ─── Init ────────────────────────────────────────────────────────
loadProperties();
calcDeal();
