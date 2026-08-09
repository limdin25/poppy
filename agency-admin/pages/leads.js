/* Leads: outreach pipeline kanban. */
(function () {
  var ORDER = ["TO_CONTACT", "CONTACTED", "IN_TALKS", "CLOSED", "LOST"];
  var LABELS = {
    TO_CONTACT: "To contact",
    CONTACTED: "Contacted",
    IN_TALKS: "In talks",
    CLOSED: "Closed",
    LOST: "Lost"
  };
  /* survives App.refresh so the search does not reset on every mutation */
  var searchQ = "";

  function sumBy(list, key) {
    return list.reduce(function (s, l) { return s + (l[key] || 0); }, 0);
  }

  function openLeadModal(lead) {
    var isEdit = !!lead;
    var nameI = h("input", { class: "input", placeholder: "Channel or business name" });
    var urlI = h("input", { class: "input", placeholder: "https://youtube.com/@channel" });
    var notesT = h("textarea", { class: "textarea", placeholder: "Context, next step, who referred them..." });
    var upI = h("input", { class: "input", type: "number", min: "0", step: "500", placeholder: "0" });
    var moI = h("input", { class: "input", type: "number", min: "0", step: "500", placeholder: "0" });
    var statusS = h("select", { class: "select" }, ORDER.map(function (k) {
      return h("option", { value: k }, LABELS[k]);
    }));
    if (isEdit) {
      nameI.value = lead.name || "";
      urlI.value = lead.channelUrl || "";
      notesT.value = lead.notes || "";
      upI.value = String(lead.upfrontCash || 0);
      moI.value = String(lead.monthlyRecurring || 0);
      statusS.value = lead.status;
    } else {
      statusS.value = "TO_CONTACT";
    }

    function field(label, control) {
      return h("div", { class: "field" }, h("span", { class: "label-text" }, label), control);
    }

    var m = openModal({
      title: isEdit ? "Edit Lead" : "Add Lead",
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        field("Name", nameI),
        field("Channel URL", urlI),
        field("Notes", notesT),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } },
          field("Upfront cash", upI),
          field("Monthly recurring", moI)
        ),
        field("Status", statusS)
      ),
      actions: [
        h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
        h("button", { class: "btn primary", onclick: save }, isEdit ? "Save Changes" : "Add Lead")
      ]
    });
    nameI.focus();

    function save() {
      var name = nameI.value.trim();
      if (!name) { toast("Give the lead a name first", "error"); return; }
      var up = Math.max(0, parseInt(upI.value, 10) || 0);
      var mo = Math.max(0, parseInt(moI.value, 10) || 0);
      var values = {
        name: name,
        channelUrl: urlI.value.trim(),
        notes: notesT.value.trim(),
        upfrontCash: up,
        monthlyRecurring: mo,
        status: statusS.value
      };
      if (isEdit) {
        Object.assign(lead, values);
        toast("Lead updated");
      } else {
        values.id = uid();
        DB.leads.push(values);
        toast("Lead added");
      }
      m.close();
      App.refresh();
    }
  }

  function moveLead(lead, dir) {
    var i = ORDER.indexOf(lead.status);
    var ni = i + dir;
    if (ni < 0 || ni >= ORDER.length) return;
    lead.status = ORDER[ni];
    toast("Moved to " + LABELS[lead.status]);
    App.refresh();
  }

  function deleteLead(lead) {
    confirmModal({
      title: "Delete lead?",
      message: "This removes " + lead.name + " from the pipeline for good. If they might come back later, move the card to Lost instead.",
      danger: true,
      confirmText: "Delete",
      onConfirm: function () {
        var i = DB.leads.indexOf(lead);
        if (i >= 0) DB.leads.splice(i, 1);
        toast("Lead deleted");
        App.refresh();
      }
    });
  }

  function iconBtn(svg, title, onClick, disabled) {
    return h("button", {
      class: "btn ghost icon",
      html: svg,
      title: title,
      disabled: disabled ? "disabled" : null,
      onclick: function (e) { e.stopPropagation(); onClick(); }
    });
  }

  function leadCard(lead) {
    var up = lead.upfrontCash || 0;
    var mo = lead.monthlyRecurring || 0;
    var money = (up > 0 || mo > 0) ? h("div", { class: "row lead-money" },
      up > 0 ? h("span", { class: "tag" }, "$" + fmtNum(up) + " upfront") : null,
      mo > 0 ? h("span", { class: "tag" }, "$" + fmtNum(mo) + "/mo") : null
    ) : null;
    var first = lead.status === ORDER[0];
    var last = lead.status === ORDER[ORDER.length - 1];
    return h("div", { class: "kan-card glass", onclick: function () { openLeadModal(lead); } },
      h("div", { class: "lead-name" }, lead.name),
      lead.channelUrl ? h("div", { class: "caption ellipsis lead-url" }, lead.channelUrl) : null,
      lead.notes ? h("div", { class: "lead-notes" }, lead.notes) : null,
      money,
      h("div", { class: "lead-foot" },
        iconBtn(Icons.chevronLeft, "Move back", function () { moveLead(lead, -1); }, first),
        iconBtn(Icons.chevronRight, "Move forward", function () { moveLead(lead, 1); }, last),
        h("span", { class: "spacer" }),
        iconBtn(Icons.edit, "Edit lead", function () { openLeadModal(lead); }),
        iconBtn(Icons.trash, "Delete lead", function () { deleteLead(lead); })
      )
    );
  }

  window.Pages.leads = {
    css: [
      ".page-leads .leads-toolbar { margin: 24px 0 16px; }",
      ".page-leads .leads-toolbar .search-wrap { width: 300px; max-width: 100%; }",
      ".page-leads .lead-name { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }",
      ".page-leads .lead-url { margin-top: 2px; }",
      ".page-leads .lead-notes { margin-top: 8px; font-size: 13px; color: var(--text2); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }",
      ".page-leads .lead-money { margin-top: 10px; gap: 6px; flex-wrap: wrap; }",
      ".page-leads .lead-foot { display: flex; align-items: center; gap: 2px; margin-top: 12px; padding-top: 8px; border-top: 0.5px solid var(--border); }",
      ".page-leads .lead-foot .btn.icon { padding: 5px; }",
      ".page-leads .lead-foot .btn.icon svg { width: 14px; height: 14px; }",
      ".page-leads .kan-none { border: 1px dashed var(--border); border-radius: var(--r-sm); padding: 20px 12px; text-align: center; font-size: 13px; color: var(--text2); }",
      ".page-leads .kan-col-foot { padding: 4px 4px 0; font-variant-numeric: tabular-nums; }"
    ].join("\n"),
    render: function (root) {
      var page = h("div", { class: "page-leads" });

      /* ---- KPIs ---- */
      var open = DB.leads.filter(function (l) {
        return l.status === "TO_CONTACT" || l.status === "CONTACTED" || l.status === "IN_TALKS";
      });
      var won = DB.leads.filter(function (l) { return l.status === "CLOSED"; });
      page.appendChild(h("div", { class: "grid cols-4" },
        kpiCard({
          label: "Pipeline upfront cash",
          value: fmtMoney(sumBy(open, "upfrontCash")),
          sub: open.length + " open lead" + (open.length === 1 ? "" : "s")
        }),
        kpiCard({
          label: "Pipeline MRR",
          value: fmtMoney(sumBy(open, "monthlyRecurring")),
          sub: "If every open lead closes"
        }),
        kpiCard({
          label: "Closed won upfront",
          value: fmtMoney(sumBy(won, "upfrontCash")),
          sub: won.length + " signed"
        }),
        kpiCard({
          label: "Closed won MRR",
          value: fmtMoney(sumBy(won, "monthlyRecurring")),
          color: "var(--green)",
          sub: "New recurring revenue"
        })
      ));

      /* ---- toolbar ---- */
      var searchI = h("input", { class: "input", placeholder: "Search leads by name", value: searchQ });
      searchI.addEventListener("input", function () {
        searchQ = searchI.value;
        renderBoard();
      });
      page.appendChild(h("div", { class: "row leads-toolbar" },
        h("div", { class: "search-wrap" }, h("span", { html: Icons.search }), searchI),
        h("span", { class: "spacer" }),
        h("button", { class: "btn primary", onclick: function () { openLeadModal(null); } },
          h("span", { html: Icons.plus }), "Add Lead")
      ));

      /* ---- kanban ---- */
      var board = h("div");
      page.appendChild(board);

      function renderBoard() {
        board.innerHTML = "";
        var q = searchQ.trim().toLowerCase();
        var visible = DB.leads.filter(function (l) {
          return !q || l.name.toLowerCase().indexOf(q) >= 0;
        });

        if (q && visible.length === 0) {
          board.appendChild(emptyState({
            icon: Icons.search,
            title: "No leads match \"" + searchQ.trim() + "\"",
            message: "Try a different name, or clear the search to see the whole pipeline.",
            action: h("button", {
              class: "btn small",
              onclick: function () { searchQ = ""; searchI.value = ""; renderBoard(); }
            }, "Clear search")
          }));
          return;
        }

        var kanban = h("div", { class: "kanban" });
        ORDER.forEach(function (status) {
          var inCol = visible.filter(function (l) { return l.status === status; });
          var col = h("div", { class: "kan-col" },
            h("div", { class: "kan-col-head" },
              statusPill(status),
              h("span", { class: "count" }, String(inCol.length))
            )
          );
          if (inCol.length === 0) {
            col.appendChild(h("div", { class: "kan-none" }, q ? "No matches here" : "No leads yet"));
          } else {
            inCol.forEach(function (lead) { col.appendChild(leadCard(lead)); });
          }
          col.appendChild(h("div", { class: "caption kan-col-foot" },
            "$" + fmtNum(sumBy(inCol, "upfrontCash")) + " upfront . $" + fmtNum(sumBy(inCol, "monthlyRecurring")) + "/mo"
          ));
          kanban.appendChild(col);
        });
        board.appendChild(kanban);
      }

      renderBoard();
      root.appendChild(page);
    }
  };
})();
