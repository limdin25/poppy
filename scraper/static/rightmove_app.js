const $ = (id) => document.getElementById(id);
const leadsBody = $("leads-body");
const logEl = $("log");
let startedAt = null;

function cfg() {
  return {
    search_urls: $("search-urls").value,
    host: $("px-host").value, port: $("px-port").value,
    username: $("px-user").value, password: $("px-pass").value,
    rotate_every: parseInt($("px-rotate").value || "25"),
    sticky: $("px-sticky").checked,
    max_pages: parseInt($("max-pages").value || "50"),
    delay_min: parseFloat($("d-min").value || "3"),
    delay_max: parseFloat($("d-max").value || "6"),
    headless: $("headless").checked,
    force_rescrape: $("force").checked,
  };
}

function countUrls() {
  const urls = $("search-urls").value.split("\n").filter(l => l.trim());
  $("preview").textContent = `${urls.length} search URL${urls.length !== 1 ? "s" : ""} to scrape`;
}
$("search-urls").addEventListener("input", countUrls);

$("btn-start").onclick = async () => {
  $("status-banner").textContent = "Starting...";
  $("status-banner").className = "bg-emerald-500 text-white text-sm px-3 py-1 rounded";
  const r = await fetch("/api/rightmove/start", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(cfg())
  });
  const d = await r.json();
  if (!d.ok) { alert(d.error); return; }
  startedAt = Date.now();
  $("status-banner").textContent = `Scraping ${d.urls} search URLs...`;
};

$("btn-pause").onclick = async () => {
  const r = await fetch("/api/rightmove/pause", { method: "POST" });
  const d = await r.json();
  $("status-banner").textContent = d.paused ? "Paused" : "Resumed";
  $("status-banner").className = d.paused
    ? "bg-amber-500 text-white text-sm px-3 py-1 rounded"
    : "bg-emerald-500 text-white text-sm px-3 py-1 rounded";
};

$("btn-stop").onclick = async () => {
  await fetch("/api/rightmove/stop", { method: "POST" });
  $("status-banner").textContent = "Stopping...";
  $("status-banner").className = "bg-rose-500 text-white text-sm px-3 py-1 rounded";
};

$("btn-export").onclick = () => { window.location = "/api/rightmove/export"; };

$("btn-clear").onclick = async () => {
  if (!confirm("Delete all Rightmove data?")) return;
  await fetch("/api/rightmove/clear", { method: "POST" });
  leadsBody.innerHTML = "";
  $("m-new").textContent = "0";
  $("m-dupes").textContent = "0";
  $("m-pages").textContent = "0";
  $("m-errors").textContent = "0";
  $("m-time").textContent = "00:00";
  loadRecent();
};

function addLog(msg, level) {
  const d = document.createElement("div");
  d.className = "log-line " + ({warn: "text-amber-600", error: "text-rose-600"}[level] || "text-slate-600");
  d.textContent = msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function addRow(l) {
  const tr = document.createElement("tr");
  tr.className = "border-b text-xs";
  const price = l.price_qualifier ? `${l.price_qualifier} ${l.price}` : l.price;
  let tags = '';
  if (l.is_auction === '1') tags += '<span class="bg-amber-100 text-amber-800 px-1 rounded text-[10px] font-semibold">AUCTION</span> ';
  if (l.is_tenanted === '1') tags += '<span class="bg-rose-100 text-rose-700 px-1 rounded text-[10px] font-semibold">TENANTED</span> ';
  if (l.days_on_market) tags += `<span class="bg-blue-50 text-blue-700 px-1 rounded text-[10px]">${l.days_on_market}d</span>`;
  let agent = '<span class="text-slate-300">—</span>';
  if (l.agent_phone || l.agent_name) {
    const phoneHtml = l.agent_phone
      ? `<a href="tel:${l.agent_phone.replace(/\s+/g,'')}" class="text-emerald-700 font-mono">${l.agent_phone}</a>`
      : '';
    const nameHtml = l.agent_name ? `<div class="text-[10px] text-slate-500">${l.agent_name}</div>` : '';
    agent = `${phoneHtml}${nameHtml}`;
  }
  tr.innerHTML = `
    <td class="p-1"><a href="${l.listing_url}" target="_blank" class="text-blue-600 underline">${l.property_id}</a></td>
    <td class="p-1 font-semibold">${price}</td>
    <td class="p-1">${l.address || ""}</td>
    <td class="p-1 text-center">${l.bedrooms || "-"}</td>
    <td class="p-1">${l.property_type || ""}</td>
    <td class="p-1">${agent}</td>
    <td class="p-1">${tags}</td>
  `;
  leadsBody.prepend(tr);
}

function elapsed() {
  if (!startedAt) return;
  const s = Math.floor((Date.now() - startedAt) / 1000);
  $("m-time").textContent = `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}
setInterval(elapsed, 1000);

// SSE
const es = new EventSource("/stream");
es.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.type === "rm_metrics") {
    $("m-pages").textContent = d.pages;
    $("m-new").textContent = d.new;
    $("m-dupes").textContent = d.duplicates;
    $("m-errors").textContent = d.errors;
    $("m-urls-done").textContent = `${d.urls_done}/${d.urls_total}`;
  }
  if (d.type === "rm_listing") addRow(d);
  if (d.type === "log") addLog(`[${d.ts || ""}] ${d.msg}`, d.level);
  if (d.type === "rm_done") {
    $("status-banner").textContent = "Done!";
    $("status-banner").className = "bg-slate-500 text-white text-sm px-3 py-1 rounded";
    addLog("--- Scrape complete ---", "info");
  }
};

async function loadRecent() {
  const r = await fetch("/api/rightmove/recent");
  const data = await r.json();
  leadsBody.innerHTML = "";
  data.forEach(addRow);
}

async function loadConfig() {
  const r = await fetch("/api/rightmove/config");
  const d = await r.json();
  if (d.search_urls) $("search-urls").value = d.search_urls;
  if (d.host) $("px-host").value = d.host;
  if (d.port) $("px-port").value = d.port;
  if (d.username) $("px-user").value = d.username;
  if (d.password) $("px-pass").value = d.password;
  if (d.rotate_every) $("px-rotate").value = d.rotate_every;
  if (d.sticky) $("px-sticky").checked = d.sticky;
  if (d.max_pages) $("max-pages").value = d.max_pages;
  if (d.delay_min) $("d-min").value = d.delay_min;
  if (d.delay_max) $("d-max").value = d.delay_max;
  if (d.headless !== undefined) $("headless").checked = d.headless;
  countUrls();
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fetch("/api/rightmove/config", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(cfg())
    });
  }, 1000);
}

document.querySelectorAll("input, textarea").forEach(el => {
  el.addEventListener("input", scheduleSave);
  el.addEventListener("change", scheduleSave);
});

loadConfig();
loadRecent();
