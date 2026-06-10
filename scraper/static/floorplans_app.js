const $ = (id) => document.getElementById(id);

let properties = [];
let selectedIdx = -1;
let fpImages = [];
let fpPage = 0;
let logOpen = false;
let activeTab = "unreviewed";

// ─── Load properties ─────────────────────────────────────────────
async function loadProperties() {
  const r = await fetch("/api/floorplans/properties");
  properties = await r.json();
  renderTabs();
  renderList();
  updateStats();
}

function filtered() {
  return properties.filter(p => {
    const s = p.status || "unreviewed";
    if (activeTab === "unreviewed") return !p.status || p.status === "unreviewed";
    return s === activeTab;
  });
}

function realIndex(filteredIdx) {
  const fp = filtered();
  if (filteredIdx < 0 || filteredIdx >= fp.length) return -1;
  return properties.indexOf(fp[filteredIdx]);
}

function renderTabs() {
  let unrev = 0, pot = 0, skip = 0;
  properties.forEach(p => {
    if (p.status === "potential") pot++;
    else if (p.status === "skip") skip++;
    else unrev++;
  });

  const tabs = [
    { id: "unreviewed", label: "Unreviewed", count: unrev },
    { id: "potential", label: "Potential", count: pot },
    { id: "skip", label: "Skipped", count: skip },
  ];

  const container = $("tab-bar");
  container.innerHTML = "";
  tabs.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "tab-btn px-3 py-1.5 text-xs font-medium rounded-t transition "
      + (t.id === activeTab
        ? "bg-white text-slate-800 border border-b-0 border-slate-200 -mb-px"
        : "bg-slate-100 text-slate-500 hover:text-slate-700");
    btn.textContent = `${t.label} (${t.count})`;
    btn.onclick = () => {
      activeTab = t.id;
      selectedIdx = -1;
      renderTabs();
      renderList();
    };
    container.appendChild(btn);
  });
}

// renderList-batched (Hugo 2026-06-03): build the whole list as ONE
// HTML string and set innerHTML in a single pass. With 2k+ rows the
// old per-row createElement/appendChild was blocking the main thread
// for 1-2s on each tab switch. Single-string render brings it down
// to ~100-200ms. Click handling moved to event delegation on the
// container so we don't attach 2k separate onclicks.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _prop_items_delegated = false;

function renderList() {
  const container = $("prop-items");
  const fp = filtered();
  $("list-count").textContent = fp.length;

  const parts = [];
  for (let fi = 0; fi < fp.length; fi++) {
    const p = fp[fi];
    const ri = properties.indexOf(p);
    const isActive = ri === selectedIdx;
    const badge = statusBadge(p.status);
    const price = p.price_qualifier
      ? escapeHtml(p.price_qualifier) + ' ' + escapeHtml(p.price)
      : (p.price ? escapeHtml(p.price) : "No price");

    let tags = '';
    if (p.is_auction === '1') tags += '<span class="text-[10px] bg-amber-100 text-amber-800 px-1 rounded font-semibold">AUCTION</span> ';
    if (p.days_on_market) tags += '<span class="text-[10px] bg-blue-50 text-blue-700 px-1 rounded">' + escapeHtml(p.days_on_market) + 'd</span> ';

    const sizeStr = p.floor_area_sqm
      ? escapeHtml(p.floor_area_sqm) + ' sqm'
      : (p.floor_area_sqft ? escapeHtml(p.floor_area_sqft) + ' sqft' : '');
    const sizeBadge = sizeStr ? '<span class="text-[10px] bg-emerald-50 text-emerald-700 px-1 rounded">' + sizeStr + '</span> ' : '';

    parts.push(
      '<div class="prop-item p-3 border-b border-slate-100 text-sm' + (isActive ? ' active' : '') +
      '" data-idx="' + ri + '">' +
        '<div class="flex items-start justify-between">' +
          '<div>' +
            '<div class="font-bold text-slate-800">' + price + '</div>' +
            '<div class="text-xs text-slate-500 mt-0.5">' + escapeHtml(p.address || "No address") + '</div>' +
            '<div class="text-xs text-slate-400 mt-0.5">' + escapeHtml(p.bedrooms || "?") + ' bed &middot; ' + escapeHtml(p.property_type || "Unknown") + ' ' + sizeBadge + tags + '</div>' +
          '</div>' +
          badge +
        '</div>' +
      '</div>'
    );
  }
  container.innerHTML = parts.join('');

  // Attach a single delegated click handler the first time we render.
  // Subsequent renders only swap innerHTML — the listener stays bound
  // to the container so it picks up the new children automatically.
  if (!_prop_items_delegated) {
    _prop_items_delegated = true;
    container.addEventListener('click', (ev) => {
      let node = ev.target;
      while (node && node !== container && !node.dataset?.idx) node = node.parentNode;
      if (node && node.dataset && node.dataset.idx != null) {
        selectProperty(parseInt(node.dataset.idx, 10));
      }
    });
  }
}

function statusBadge(status) {
  if (status === "potential") return '<span class="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Potential</span>';
  if (status === "skip") return '<span class="text-xs px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 font-medium">Skipped</span>';
  return '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Unreviewed</span>';
}

// ─── Select property ─────────────────────────────────────────────
async function selectProperty(idx) {
  if (idx < 0 || idx >= properties.length) return;
  selectedIdx = idx;
  const p = properties[idx];

  // Highlight in list
  document.querySelectorAll(".prop-item").forEach(el => {
    el.classList.toggle("active", parseInt(el.dataset.idx) === idx);
  });

  // Scroll selected item into view
  const active = document.querySelector(".prop-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });

  // Fill detail bar
  const price = p.price_qualifier ? `${p.price_qualifier} ${p.price}` : (p.price || "No price");
  $("d-price").textContent = price;
  $("d-address").textContent = p.address || "";
  $("d-beds").textContent = `${p.bedrooms || "?"} bed`;
  $("d-type").textContent = p.property_type || "";

  // Auction badge
  if (p.is_auction === '1') {
    $("d-auction").classList.remove("hidden");
  } else {
    $("d-auction").classList.add("hidden");
  }

  // Floor area
  if (p.floor_area_sqm) {
    $("d-size").textContent = `${p.floor_area_sqm} sqm (${p.floor_area_sqft || Math.round(p.floor_area_sqm * 10.764)} sqft)`;
    $("d-size").classList.remove("hidden");
  } else if (p.floor_area_sqft) {
    $("d-size").textContent = `${p.floor_area_sqft} sqft`;
    $("d-size").classList.remove("hidden");
  } else {
    $("d-size").classList.add("hidden");
  }

  // Days on market
  if (p.days_on_market) {
    $("d-days").textContent = `${p.days_on_market} days on market`;
    $("d-days").classList.remove("hidden");
  } else if (p.listed_date) {
    $("d-days").textContent = `Listed ${p.listed_date}`;
    $("d-days").classList.remove("hidden");
  } else {
    $("d-days").classList.add("hidden");
  }

  if (p.listing_url) {
    $("d-link").href = p.listing_url;
    $("d-link").classList.remove("hidden");
  } else {
    $("d-link").classList.add("hidden");
  }

  // Load floor plan images
  fpImages = [];
  fpPage = 0;

  try {
    const r = await fetch(`/api/floorplans/images/${p.property_id}`);
    const data = await r.json();
    fpImages = data.map(fp => fp.image_url).filter(url => url && url.trim());
  } catch (e) {
    fpImages = [];
  }

  renderFloorPlan();
}

// ─── Floor plan viewer ───────────────────────────────────────────
function renderFloorPlan() {
  $("fp-empty").classList.add("hidden");
  $("fp-no-plan").classList.add("hidden");
  $("fp-image").classList.add("hidden");
  $("fp-prev").classList.add("hidden");
  $("fp-next").classList.add("hidden");
  $("fp-dots").classList.add("hidden");
  $("fp-dots").innerHTML = "";

  if (fpImages.length === 0) {
    $("fp-no-plan").classList.remove("hidden");
    return;
  }

  $("fp-image").src = fpImages[fpPage];
  $("fp-image").classList.remove("hidden");

  if (fpImages.length > 1) {
    $("fp-prev").classList.remove("hidden");
    $("fp-next").classList.remove("hidden");
    $("fp-dots").classList.remove("hidden");

    fpImages.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.className = "w-2.5 h-2.5 rounded-full cursor-pointer "
        + (i === fpPage ? "bg-emerald-500" : "bg-white/60");
      dot.onclick = () => { fpPage = i; renderFloorPlan(); };
      $("fp-dots").appendChild(dot);
    });
  }
}

$("fp-prev").onclick = () => {
  if (fpImages.length < 2) return;
  fpPage = (fpPage - 1 + fpImages.length) % fpImages.length;
  renderFloorPlan();
};

$("fp-next").onclick = () => {
  if (fpImages.length < 2) return;
  fpPage = (fpPage + 1) % fpImages.length;
  renderFloorPlan();
};

// ─── Review actions ──────────────────────────────────────────────
async function review(status) {
  if (selectedIdx < 0) return;
  const p = properties[selectedIdx];

  await fetch("/api/floorplans/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ property_id: p.property_id, status })
  });

  p.status = status;
  renderTabs();
  renderList();
  updateStats();
  advanceToNext();
}

function advanceToNext() {
  const fp = filtered();
  if (fp.length === 0) {
    $("fp-image").classList.add("hidden");
    $("fp-empty").textContent = "No more properties in this tab";
    $("fp-empty").classList.remove("hidden");
    return;
  }
  // Select first item in the current filtered list
  selectProperty(properties.indexOf(fp[0]));
}

$("btn-skip").onclick = () => review("skip");
$("btn-potential").onclick = () => review("potential");

// ─── Stats ───────────────────────────────────────────────────────
async function updateStats() {
  try {
    const r = await fetch("/api/floorplans/stats");
    const d = await r.json();
    $("s-potential").textContent = d.potential || 0;
    $("s-skipped").textContent = d.skipped || 0;
    $("s-remaining").textContent = d.unreviewed || 0;
  } catch (e) {
    let pot = 0, skip = 0, unrev = 0;
    properties.forEach(p => {
      if (p.status === "potential") pot++;
      else if (p.status === "skip") skip++;
      else unrev++;
    });
    $("s-potential").textContent = pot;
    $("s-skipped").textContent = skip;
    $("s-remaining").textContent = unrev;
  }
}

// ─── Keyboard shortcuts ──────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      review("skip");
      break;
    case "ArrowRight":
      e.preventDefault();
      review("potential");
      break;
    case "ArrowUp":
      e.preventDefault();
      if (selectedIdx > 0) {
        const fp = filtered();
        const curFi = fp.findIndex(p => properties.indexOf(p) === selectedIdx);
        if (curFi > 0) selectProperty(properties.indexOf(fp[curFi - 1]));
      }
      break;
    case "ArrowDown":
      e.preventDefault();
      {
        const fp = filtered();
        const curFi = fp.findIndex(p => properties.indexOf(p) === selectedIdx);
        if (curFi < fp.length - 1) selectProperty(properties.indexOf(fp[curFi + 1]));
      }
      break;
  }
});

// ─── Fetch floor plans ──────────────────────────────────────────
$("btn-fetch").onclick = () => $("fetch-modal").classList.remove("hidden");
$("f-cancel").onclick = () => $("fetch-modal").classList.add("hidden");

$("f-start").onclick = async () => {
  $("fetch-modal").classList.add("hidden");

  const body = {
    headless: $("f-headless").checked,
    delay_min: parseFloat($("f-dmin").value || "2"),
    delay_max: parseFloat($("f-dmax").value || "5"),
    exclude_auction: $("f-no-auction").checked,
    exclude_tenanted: $("f-no-tenanted").checked
  };

  await fetch("/api/floorplans/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!logOpen) toggleLog();
  addLog("Floor plan fetch started...", "info");
};

// ─── SSE ─────────────────────────────────────────────────────────
const es = new EventSource("/stream");
es.onmessage = (e) => {
  const d = JSON.parse(e.data);

  if (d.type === "fp_metrics") {
    addLog(`Progress: ${d.done}/${d.total} properties checked, ${d.found} floor plans found`, "info");
  }

  if (d.type === "fp_found") {
    addLog(`Floor plan found: ${d.address || d.property_id}`, "info");
  }

  if (d.type === "fp_done") {
    addLog("--- Floor plan fetch complete ---", "info");
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

// ─── Init ────────────────────────────────────────────────────────
loadProperties();


// ── hover-zoom-magnifier (Hugo 2026-05-27) ──────────────────────────
// Scale the floor plan toward the cursor on hover so the VA can read
// kitchen sizes / room dimensions / lease text without launching a
// separate viewer. mousemove updates transform-origin to follow the
// cursor; mouseleave snaps back.
(function () {
  const ZOOM = 2.5;
  const img = document.getElementById("fp-image");
  if (!img) return;
  img.style.cursor = "zoom-in";
  img.style.transition = "transform 120ms ease-out";
  img.style.willChange = "transform";

  img.addEventListener("mouseenter", () => {
    img.style.transform = `scale(${ZOOM})`;
  });
  img.addEventListener("mouseleave", () => {
    img.style.transform = "";
    img.style.transformOrigin = "center center";
  });
  img.addEventListener("mousemove", (e) => {
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    img.style.transformOrigin = `${x}% ${y}%`;
  });
})();
