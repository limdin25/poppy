const $ = (id) => document.getElementById(id);

let shortlist = [];
let lbImages = [];
let lbPage = 0;

// ─── Load shortlisted properties ─────────────────────────────────
async function loadShortlist() {
  const r = await fetch("/api/shortlist/properties");
  shortlist = await r.json();
  $("s-count").textContent = shortlist.length;

  if (shortlist.length === 0) {
    $("empty-msg").classList.remove("hidden");
    $("grid").innerHTML = "";
    return;
  }

  $("empty-msg").classList.add("hidden");
  renderGrid();
}

async function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";

  for (const p of shortlist) {
    const card = document.createElement("div");
    card.className = "bg-white rounded-lg shadow overflow-hidden";

    const price = p.price_qualifier ? `${p.price_qualifier} ${p.price}` : (p.price || "No price");

    // Fetch thumbnail
    let thumbUrl = "";
    try {
      const r = await fetch(`/api/floorplans/images/${p.property_id}`);
      const data = await r.json();
      const imgs = data.map(fp => fp.image_url).filter(u => u && u.trim());
      if (imgs.length > 0) thumbUrl = imgs[0];
    } catch (e) { /* no thumbnail */ }

    card.innerHTML = `
      <div class="aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden cursor-pointer" data-pid="${p.property_id}">
        ${thumbUrl
          ? `<img src="${thumbUrl}" alt="Floor plan" class="w-full h-full object-contain">`
          : '<span class="text-slate-400 text-xs">No floor plan</span>'}
      </div>
      <div class="p-3 space-y-1">
        <div class="font-bold text-slate-800">${price}</div>
        <div class="text-xs text-slate-500">${p.address || "No address"}</div>
        <div class="text-xs text-slate-400">${p.bedrooms || "?"} bed &middot; ${p.property_type || "Unknown"}</div>
        <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
          ${p.listing_url
            ? `<a href="${p.listing_url}" target="_blank" class="text-blue-600 text-xs underline">Rightmove</a>`
            : '<span></span>'}
          <button class="text-xs text-rose-500 hover:text-rose-700 font-medium remove-btn" data-pid="${p.property_id}">Remove</button>
        </div>
      </div>`;

    // Thumbnail click -> lightbox
    card.querySelector("[data-pid]").onclick = () => openLightbox(p.property_id);

    // Remove button
    card.querySelector(".remove-btn").onclick = async (e) => {
      e.stopPropagation();
      await fetch("/api/floorplans/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: p.property_id, status: "unreviewed" })
      });
      loadShortlist();
    };

    grid.appendChild(card);
  }
}

// ─── Lightbox ────────────────────────────────────────────────────
async function openLightbox(propertyId) {
  try {
    const r = await fetch(`/api/floorplans/images/${propertyId}`);
    const data = await r.json();
    lbImages = data.map(fp => fp.image_url).filter(u => u && u.trim());
  } catch (e) {
    lbImages = [];
  }

  if (lbImages.length === 0) return;

  lbPage = 0;
  renderLightbox();
  $("lightbox").classList.remove("hidden");
}

function renderLightbox() {
  $("lb-img").src = lbImages[lbPage];
  $("lb-dots").innerHTML = "";

  $("lb-prev").classList.toggle("hidden", lbImages.length < 2);
  $("lb-next").classList.toggle("hidden", lbImages.length < 2);

  if (lbImages.length > 1) {
    lbImages.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.className = "w-3 h-3 rounded-full cursor-pointer "
        + (i === lbPage ? "bg-emerald-500" : "bg-white/50");
      dot.onclick = () => { lbPage = i; renderLightbox(); };
      $("lb-dots").appendChild(dot);
    });
  }
}

function closeLightbox() {
  $("lightbox").classList.add("hidden");
  lbImages = [];
}

$("lb-close").onclick = closeLightbox;
$("lb-prev").onclick = () => {
  lbPage = (lbPage - 1 + lbImages.length) % lbImages.length;
  renderLightbox();
};
$("lb-next").onclick = () => {
  lbPage = (lbPage + 1) % lbImages.length;
  renderLightbox();
};

// Close lightbox on Escape or background click
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
  if ($("lightbox").classList.contains("hidden")) return;
  if (e.key === "ArrowLeft") { $("lb-prev").click(); e.preventDefault(); }
  if (e.key === "ArrowRight") { $("lb-next").click(); e.preventDefault(); }
});

$("lightbox").onclick = (e) => {
  if (e.target === $("lightbox")) closeLightbox();
};

// ─── Export ──────────────────────────────────────────────────────
$("btn-export").onclick = () => { window.location = "/api/shortlist/export"; };

// ─── Init ────────────────────────────────────────────────────────
loadShortlist();
