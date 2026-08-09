/* Dashboard (home): KPIs, client pipeline, daily objectives + 30-day guarantee tracker. */

(function () {
  window.Pages.dashboard = {
    css: [
      ".page-dashboard .pipe-card { cursor: pointer; transition: transform 0.15s ease, background 0.15s; }",
      ".page-dashboard .pipe-card:hover { transform: translateY(-2px); background: var(--glass-strong); }",
      ".page-dashboard .tag.auto { color: var(--blue); background: rgba(10, 132, 255, 0.1); border-color: rgba(10, 132, 255, 0.25); }",
      ".page-dashboard .obj-row { display: flex; align-items: flex-start; gap: 12px; padding: 11px 2px; }",
      ".page-dashboard .obj-check { width: 22px; height: 22px; flex: none; margin-top: 1px; padding: 0; border-radius: 50%; border: 1.5px solid var(--hairline); background: transparent; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s, border-color 0.15s, transform 0.12s; }",
      ".page-dashboard .obj-check:hover { border-color: var(--green); transform: scale(1.08); }",
      ".page-dashboard .obj-check.on { background: var(--green); border-color: var(--green); }",
      ".page-dashboard .obj-check svg { width: 12px; height: 12px; opacity: 0; transition: opacity 0.15s; }",
      ".page-dashboard .obj-check.on svg { opacity: 1; }",
      ".page-dashboard .obj-text { flex: 1; min-width: 0; font-size: 14px; line-height: 1.5; padding-top: 1px; transition: color 0.15s; }",
      ".page-dashboard .obj-text.done { color: var(--text2); text-decoration: line-through; }",
      ".page-dashboard .guar-row { display: flex; flex-direction: column; gap: 9px; padding: 13px 15px; border-radius: var(--r-sm); background: var(--glass); border: 0.5px solid var(--border); }",
      ".page-dashboard .guar-row.warn { background: rgba(255, 159, 10, 0.08); border-color: rgba(255, 159, 10, 0.3); }",
      ".page-dashboard .guar-row .warn-ic { display: flex; color: var(--orange); }",
      ".page-dashboard .guar-row .warn-ic svg { width: 15px; height: 15px; }"
    ].join("\n"),

    render: function (root) {
      var page = h("div", { class: "page-dashboard" });

      /* ---------- KPI row ---------- */
      var active = Util.activeClients();
      var churned = DB.clients.filter(function (c) { return c.status === "CHURNED"; }).length;

      var revenueAug = DB.payments.filter(function (p) {
        return p.status === "PAID" && p.paidDate && p.paidDate.indexOf("2026-08") === 0;
      }).reduce(function (s, p) { return s + p.amount; }, 0);

      var outRows = DB.payments.filter(function (p) { return p.status === "PENDING" || p.status === "OVERDUE"; });
      var outstanding = outRows.reduce(function (s, p) { return s + p.amount; }, 0);
      var pendCount = outRows.filter(function (p) { return p.status === "PENDING"; }).length;
      var overCount = outRows.filter(function (p) { return p.status === "OVERDUE"; }).length;

      page.appendChild(h("div", { class: "grid cols-4" },
        kpiCard({
          label: "Total MRR",
          value: fmtMoney(Util.mrr()),
          sub: "Across " + active.length + " active client" + (active.length === 1 ? "" : "s")
        }),
        kpiCard({
          label: "Active clients",
          value: String(active.length),
          sub: churned === 0 ? "No churn to date" : churned + " churned"
        }),
        kpiCard({
          label: "Revenue this month",
          value: fmtMoney(revenueAug),
          sub: "Collected in August, setup fees included"
        }),
        kpiCard({
          label: "Outstanding",
          value: fmtMoney(outstanding),
          color: "var(--orange)",
          sub: pendCount + " pending, " + overCount + " overdue"
        })
      ));

      /* ---------- Client pipeline ---------- */
      page.appendChild(sectionHead("Client pipeline",
        h("span", { class: "caption" }, active.length + " active client" + (active.length === 1 ? "" : "s"))));

      if (active.length === 0) {
        page.appendChild(h("div", { class: "card" }, emptyState({
          icon: Icons.clients,
          title: "No active clients",
          message: "Close a lead and it lands here with its production stage."
        })));
      } else {
        page.appendChild(h("div", { class: "grid cols-3" }, active.map(function (c) {
          var auto = c.stageSource === "AI_DISCORD";
          return h("div", {
            class: "card glass pipe-card",
            onclick: function () { location.hash = "#/clients/" + c.id; }
          },
            h("div", { class: "row", style: { alignItems: "flex-start", gap: "12px" } },
              avatar(c.name, 40),
              h("div", { style: { flex: "1", minWidth: "0" } },
                h("div", { class: "ellipsis", style: { fontWeight: "600", fontSize: "15px" } }, c.name),
                h("div", { class: "caption ellipsis" }, c.person)
              )
            ),
            h("div", { class: "row wrap", style: { marginTop: "14px" } },
              stagePill(c.stage),
              h("span", { class: "tag" }, planLabel(c))
            ),
            h("div", { class: "row", style: { marginTop: "12px" } },
              h("span", { class: "tag" + (auto ? " auto" : "") }, auto ? "Auto from Discord" : "Manual"),
              h("span", { class: "caption" }, timeAgo(c.stageUpdatedAt))
            )
          );
        })));
      }

      /* ---------- Daily objectives ---------- */
      page.appendChild(sectionHead("Daily objectives"));

      var countEl = h("span", { class: "caption" });
      var listWrap = h("div", { class: "hairline-list" });

      function renderObjList() {
        listWrap.innerHTML = "";
        var open = DB.objectives.filter(function (o) { return !o.done; }).length;
        countEl.textContent = open === 0 ? "All done" : open + " open";
        if (DB.objectives.length === 0) {
          listWrap.appendChild(emptyState({
            icon: Icons.check,
            title: "Nothing on the list",
            message: "Add the first objective for today below."
          }));
          return;
        }
        DB.objectives.forEach(function (o) {
          listWrap.appendChild(h("div", { class: "obj-row" },
            h("button", {
              class: "obj-check" + (o.done ? " on" : ""),
              html: Icons.check,
              "aria-label": o.done ? "Mark as not done" : "Mark as done",
              onclick: function () { o.done = !o.done; renderObjList(); }
            }),
            h("div", { class: "obj-text" + (o.done ? " done" : "") }, o.text)
          ));
        });
      }
      renderObjList();

      var addInput = h("input", {
        class: "input",
        placeholder: "Add an objective for today...",
        onkeydown: function (e) { if (e.key === "Enter") addObjective(); }
      });
      function addObjective() {
        var text = addInput.value.trim();
        if (!text) return;
        DB.objectives.push({ id: uid(), text: text, done: false });
        addInput.value = "";
        renderObjList();
      }
      var addRow = h("div", { class: "row", style: { marginTop: "12px" } },
        h("div", { style: { flex: "1" } }, addInput),
        h("button", { class: "btn", onclick: addObjective }, h("span", { html: Icons.plus }), "Add")
      );

      /* ---------- 30-day guarantee tracker ---------- */
      var inWindow = active.filter(function (c) {
        var d = daysSince(c.startDate);
        return d >= 0 && d <= 30;
      }).sort(function (a, b) { return daysSince(b.startDate) - daysSince(a.startDate); });
      var pastCount = active.length - inWindow.length;

      var guarBody = h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" } });
      if (inWindow.length === 0) {
        guarBody.appendChild(h("div", { class: "caption" }, "No clients are inside their first 30 days right now."));
      } else {
        inWindow.forEach(function (c) {
          var day = daysSince(c.startDate);
          var warn = day >= 24;
          var pct = Math.min(100, Math.round((day / 30) * 100));
          guarBody.appendChild(h("div", { class: "guar-row" + (warn ? " warn" : "") },
            h("div", { class: "row" },
              avatar(c.name, 26),
              h("div", { style: { flex: "1", minWidth: "0", fontWeight: "600", fontSize: "14px" }, class: "ellipsis" }, c.name),
              warn ? h("span", { class: "warn-ic", html: Icons.warning }) : null,
              h("span", {
                class: "caption mono",
                style: warn ? { color: "var(--orange)", fontWeight: "600" } : null
              }, "Day " + day + " of 30")
            ),
            h("div", { class: "progress" },
              h("i", { style: { width: pct + "%", background: warn ? "var(--orange)" : "var(--blue)" } })
            )
          ));
        });
      }
      if (pastCount > 0) {
        guarBody.appendChild(h("div", { class: "caption" },
          pastCount === 1
            ? "1 active client is past its 30-day window."
            : pastCount + " active clients are past their 30-day window."));
      }

      page.appendChild(h("div", { class: "card" },
        h("div", { class: "card-head", style: { marginBottom: "6px" } },
          h("div", {},
            h("div", { class: "card-title" }, "Daily objectives"),
            h("div", { class: "card-sub" }, "Tuesday, August 5")
          ),
          countEl
        ),
        listWrap,
        addRow,
        h("div", { style: { height: "0.5px", background: "var(--border)", margin: "20px 0 16px" } }),
        h("div", { style: { fontSize: "15px", fontWeight: "600" } }, "30-day guarantee tracker"),
        h("div", { class: "caption", style: { marginTop: "3px" } },
          "We guarantee a full refund if a client does not see a views increase in their first 30 days."),
        guarBody
      ));

      root.appendChild(page);
    }
  };
})();
