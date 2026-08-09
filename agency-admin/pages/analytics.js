/* Analytics page: channel stats across the roster, per-client drilldown. */
(function () {
  /* module-level view state survives App.refresh() */
  var selected = "all";

  function connectedClients() {
    return DB.clients.filter(function (c) { return !!DB.analytics[c.id]; });
  }
  function latestSnap(a) { return a.snapshots[a.snapshots.length - 1]; }

  /* ---------- top card: connect a channel ---------- */
  function connectCard() {
    var card = h("div", { class: "card" },
      h("div", { class: "card-title" }, "Connect a channel"),
      h("div", { class: "card-sub" }, "Pulls public stats via the YouTube Data API v3.")
    );
    if (!Util.isConnected("youtube")) {
      var banner = integrationBanner({ integration: "the YouTube Data API" });
      banner.style.marginTop = "14px";
      card.appendChild(banner);
      return card;
    }
    var input = h("input", { class: "input", placeholder: "YouTube channel URL or ID" });
    function connect() {
      var v = input.value.trim();
      if (!v) { input.focus(); return; }
      input.value = "";
      toast("Channel queued. Stats appear after the first pull.");
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") connect(); });
    card.appendChild(h("div", { class: "connect-row" },
      h("div", { class: "connect-input" }, input),
      h("button", { class: "btn primary", onclick: connect }, "Connect")
    ));
    return card;
  }

  /* ---------- view switcher ---------- */
  function viewSwitcher() {
    var seg = h("div", { class: "seg" });
    function chip(label, key) {
      seg.appendChild(h("button", {
        class: selected === key ? "active" : "",
        onclick: function () { selected = key; App.refresh(); }
      }, label));
    }
    chip("All", "all");
    connectedClients().forEach(function (c) { chip(c.name, c.id); });
    return h("div", { class: "view-seg" }, seg);
  }

  /* ---------- ALL view ---------- */
  function allView() {
    var wrap = h("div", { class: "vstack" });
    var roster = connectedClients();
    if (!roster.length) {
      wrap.appendChild(h("div", { class: "card" }, emptyState({
        icon: Icons.analytics,
        title: "No channels connected yet",
        message: "Connect a client channel above and stats appear here after the first pull."
      })));
      return wrap;
    }

    var labels = DB.analytics[roster[0].id].snapshots.map(function (s) { return monthLabel(s.date); });

    /* 1. views by client */
    var series = roster.map(function (c, i) {
      return {
        name: c.name,
        color: CHART_COLORS[i % CHART_COLORS.length],
        values: DB.analytics[c.id].snapshots.map(function (s) { return s.views; })
      };
    });
    wrap.appendChild(h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {},
          h("div", { class: "card-title" }, "Views by client"),
          h("div", { class: "card-sub" }, "Monthly views across every connected channel.")
        )
      ),
      Charts.line({ labels: labels, series: series, height: 260, fmt: fmtNum })
    ));

    /* 2. roster table */
    var tbody = h("tbody");
    roster.forEach(function (c, i) {
      var a = DB.analytics[c.id];
      var la = latestSnap(a);
      tbody.appendChild(h("tr", { class: "clickable", onclick: function () { selected = c.id; App.refresh(); } },
        h("td", {}, h("div", { class: "row" },
          avatar(c.name, 30),
          h("div", {},
            h("div", { style: { fontWeight: "600" } }, c.name),
            h("div", { class: "caption" }, c.person)
          )
        )),
        h("td", { class: "num" }, fmtNum(la.subscribers)),
        h("td", { class: "num" }, fmtNum(la.views)),
        h("td", { class: "num" }, la.impressionsCTR.toFixed(1) + "%"),
        h("td", { class: "num" }, fmtNum(la.watchHours)),
        h("td", { class: "num" }, Charts.spark({
          values: a.snapshots.map(function (s) { return s.views; }),
          color: CHART_COLORS[i % CHART_COLORS.length], width: 110, height: 32
        }))
      ));
    });
    wrap.appendChild(h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {},
          h("div", { class: "card-title" }, "Roster"),
          h("div", { class: "card-sub" }, "Latest pull per channel. Click a row to drill in.")
        )
      ),
      h("div", { class: "table-wrap" },
        h("table", { class: "table" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Client"),
            h("th", { class: "num" }, "Subscribers"),
            h("th", { class: "num" }, "Views (Aug)"),
            h("th", { class: "num" }, "CTR"),
            h("th", { class: "num" }, "Watch hours"),
            h("th", { class: "num" }, "Trend")
          )),
          tbody
        )
      )
    ));

    /* 3. totals */
    var totalSubs = 0, totalViews = 0, ctrSum = 0;
    roster.forEach(function (c) {
      var la = latestSnap(DB.analytics[c.id]);
      totalSubs += la.subscribers; totalViews += la.views; ctrSum += la.impressionsCTR;
    });
    wrap.appendChild(h("div", { class: "grid cols-3" },
      kpiCard({ label: "Total subscribers", value: fmtNum(totalSubs), sub: "Across " + roster.length + " connected channels" }),
      kpiCard({ label: "Total views this month", value: fmtNum(totalViews), sub: "August pull, all channels" }),
      kpiCard({ label: "Average CTR", value: (ctrSum / roster.length).toFixed(1) + "%", sub: "Impressions click-through, latest pull" })
    ));
    return wrap;
  }

  /* ---------- CLIENT view ---------- */
  function addDataModal(c) {
    function numField(label, placeholder, step) {
      var input = h("input", { class: "input", type: "number", min: "0", step: step || "1", placeholder: placeholder });
      var field = h("div", { class: "field" }, h("span", { class: "label-text" }, label), input);
      return { field: field, input: input };
    }
    var views = numField("Views", "e.g. 120000");
    var subs = numField("Subscribers", "e.g. 45000");
    var hours = numField("Watch hours", "e.g. 8500");
    var ctr = numField("CTR (%)", "e.g. 4.2", "0.1");
    var m = openModal({
      title: "Add data manually",
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        h("p", { class: "muted", style: { fontSize: "13px", lineHeight: "1.6" } },
          "Record a snapshot for " + c.name + " while the API pull is not set up. It lands as the August entry."),
        h("div", { class: "grid cols-2" }, views.field, subs.field, hours.field, ctr.field)
      ),
      actions: [
        h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
        h("button", {
          class: "btn primary", onclick: function () {
            if (!DB.analytics[c.id]) DB.analytics[c.id] = { snapshots: [], topVideos: [] };
            DB.analytics[c.id].snapshots.push({
              date: "2026-08-01",
              views: Math.max(0, Math.round(Number(views.input.value) || 0)),
              subscribers: Math.max(0, Math.round(Number(subs.input.value) || 0)),
              watchHours: Math.max(0, Math.round(Number(hours.input.value) || 0)),
              impressionsCTR: Math.max(0, +(Number(ctr.input.value) || 0).toFixed(1))
            });
            m.close();
            toast("Snapshot added for " + c.name + ".");
            App.refresh();
          }
        }, "Add snapshot")
      ]
    });
  }

  function clientView(c) {
    var wrap = h("div", { class: "vstack" });
    var a = DB.analytics[c.id];

    if (!a || !a.snapshots.length) {
      wrap.appendChild(h("div", { class: "card" }, emptyState({
        icon: Icons.analytics,
        title: "No data pulled yet for this channel",
        message: "The first API pull has not run for " + c.name + ". You can record a snapshot by hand in the meantime.",
        action: h("button", { class: "btn primary small", onclick: function () { addDataModal(c); } }, "Add data manually")
      })));
      return wrap;
    }

    var la = latestSnap(a);
    var fa = a.snapshots[0];
    var labels = a.snapshots.map(function (s) { return monthLabel(s.date); });

    /* header */
    wrap.appendChild(h("div", { class: "client-head" },
      avatar(c.name, 44),
      h("div", {},
        h("h3", {}, c.name),
        h("div", { class: "caption" }, c.channelUrl.replace("https://", ""))
      ),
      h("span", { class: "spacer" }),
      h("span", { class: "caption" }, "Last pull " + fmtDateShort(la.date))
    ));

    /* kpi row */
    var subDelta;
    if (a.snapshots.length < 2) {
      subDelta = "First pull recorded " + fmtDateShort(fa.date);
    } else {
      var d = la.subscribers - fa.subscribers;
      subDelta = '<span class="' + (d >= 0 ? "up" : "down") + '">' + (d >= 0 ? "+" : "-") + fmtNum(Math.abs(d)) +
        "</span> since " + monthLabel(fa.date);
    }
    var ctrAvg = a.snapshots.reduce(function (s, x) { return s + x.impressionsCTR; }, 0) / a.snapshots.length;
    wrap.appendChild(h("div", { class: "grid cols-4" },
      kpiCard({ label: "Subscribers", value: fmtNum(la.subscribers), sub: subDelta }),
      kpiCard({ label: "Views", value: fmtNum(la.views), sub: "Latest month" }),
      kpiCard({ label: "Avg CTR", value: ctrAvg.toFixed(1) + "%", sub: "Average of " + a.snapshots.length + (a.snapshots.length === 1 ? " pull" : " monthly pulls") }),
      kpiCard({ label: "Watch hours", value: fmtNum(la.watchHours), sub: "Latest month" })
    ));

    /* charts */
    wrap.appendChild(h("div", { class: "grid cols-2" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", {},
          h("div", { class: "card-title" }, "Views over time"),
          h("div", { class: "card-sub" }, "Monthly views from each pull.")
        )),
        Charts.line({
          labels: labels, height: 230, fmt: fmtNum,
          series: [{ name: "Views", color: CHART_COLORS[0], values: a.snapshots.map(function (s) { return s.views; }) }]
        })
      ),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", {},
          h("div", { class: "card-title" }, "Watch time trend"),
          h("div", { class: "card-sub" }, "Hours watched per month.")
        )),
        Charts.line({
          labels: labels, height: 230, fmt: fmtNum,
          series: [{ name: "Watch hours", color: CHART_COLORS[3], values: a.snapshots.map(function (s) { return s.watchHours; }) }]
        })
      )
    ));

    /* top videos */
    var videosCard = h("div", { class: "card" },
      h("div", { class: "card-head" }, h("div", {},
        h("div", { class: "card-title" }, "Top videos"),
        h("div", { class: "card-sub" }, "Best performers on the channel right now.")
      ))
    );
    var vids = (a.topVideos || []).slice().sort(function (x, y) { return y.views - x.views; });
    if (!vids.length) {
      videosCard.appendChild(emptyState({
        icon: Icons.play,
        title: "No videos pulled yet",
        message: "Video-level stats arrive with the next API pull."
      }));
    } else {
      var vbody = h("tbody");
      vids.forEach(function (v) {
        vbody.appendChild(h("tr", {},
          h("td", {}, h("div", { class: "ellipsis", style: { fontWeight: "500", maxWidth: "420px" } }, v.title)),
          h("td", { class: "nowrap" }, fmtDate(v.published)),
          h("td", { class: "num" }, fmtNum(v.views)),
          h("td", { class: "num" }, v.minutes + "m"),
          h("td", {}, Util.isLongForm(v)
            ? h("span", { class: "tag longform" }, "Long-form")
            : h("span", { class: "tag" }, "Short-form"))
        ));
      });
      videosCard.appendChild(h("div", { class: "table-wrap" },
        h("table", { class: "table" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Title"),
            h("th", {}, "Published"),
            h("th", { class: "num" }, "Views"),
            h("th", { class: "num" }, "Length"),
            h("th", {}, "Format")
          )),
          vbody
        )
      ));
    }
    wrap.appendChild(videosCard);
    return wrap;
  }

  window.Pages.analytics = {
    css: [
      ".page-analytics .connect-row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }",
      ".page-analytics .connect-input { flex: 1; min-width: 0; }",
      ".page-analytics .view-seg { display: flex; margin: 22px 0 16px; overflow-x: auto; }",
      ".page-analytics .vstack { display: flex; flex-direction: column; gap: 16px; }",
      ".page-analytics .client-head { display: flex; align-items: center; gap: 14px; padding: 2px 4px; }",
      ".page-analytics .tag.longform { color: var(--blue); background: rgba(10, 132, 255, 0.12); border-color: rgba(10, 132, 255, 0.28); }"
    ].join("\n"),
    render: function (root, param) {
      /* allow deep links like #/analytics/c1 and recover if a client disappears */
      if (param && DB.clients.some(function (c) { return c.id === param; })) selected = param;
      if (selected !== "all" && !Util.clientById(selected)) selected = "all";
      var page = h("div", { class: "page-analytics" });
      page.appendChild(connectCard());
      page.appendChild(viewSwitcher());
      if (selected === "all") page.appendChild(allView());
      else page.appendChild(clientView(Util.clientById(selected)));
      root.appendChild(page);
    }
  };
})();
