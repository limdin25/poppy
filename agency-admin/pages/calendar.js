/* Calendar: payment collection calendar. Chips toggle collected state in memory. */
(function () {
  var MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* displayed month state, survives tab switches */
  var viewYear = 2026;
  var viewMonth = 7; /* August */

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function isoOf(y, m, d) { return y + "-" + pad2(m + 1) + "-" + pad2(d); }
  function shortName(name) {
    var n = (name || "").replace(/^The\s+/i, "");
    return n.split(/\s+/)[0] || name || "Client";
  }
  function typeLabel(p) { return p.type === "SETUP" ? "Setup fee" : "Monthly retainer"; }

  window.Pages.calendar = {
    css: [
      ".page-calendar .cal-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }",
      ".page-calendar .cal-title { min-width: 208px; }",
      ".page-calendar .cash-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; padding: 10px 18px 12px; border-radius: 14px; }",
      ".page-calendar .cash-stat .val { font-size: 26px; font-weight: 600; letter-spacing: -0.03em; color: var(--green); font-variant-numeric: tabular-nums; line-height: 1.25; }",
      ".page-calendar .cal-legend { display: flex; align-items: center; gap: 18px; margin: 4px 2px 14px; }",
      ".page-calendar .cal-legend-item { display: inline-flex; align-items: center; gap: 7px; }",
      ".page-calendar .legend-chip { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }",
      ".page-calendar .cal-grid { margin-bottom: 28px; }",
      ".page-calendar .cal-pay:hover { filter: brightness(1.18); }",
      ".page-calendar .month-row { padding: 12px 6px; }",
      ".page-calendar .day-tag { min-width: 32px; justify-content: center; font-variant-numeric: tabular-nums; font-size: 12px; }",
      ".page-calendar .month-row-name { font-weight: 500; font-size: 14px; }",
      ".page-calendar .month-row-amt { font-weight: 600; font-size: 14px; }"
    ].join("\n"),

    render: function (root) {
      var page = h("div", { class: "page-calendar" });
      var body = h("div", {});
      page.appendChild(body);

      function shift(delta) {
        viewMonth += delta;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        build();
      }

      function togglePayment(p) {
        var c = Util.clientById(p.clientId);
        if (p.status !== "PAID") {
          p.status = "PAID";
          p.paidDate = p.dueDate;
          toast("Collected " + fmtMoney(p.amount) + " from " + (c ? c.name : "client"));
        } else {
          p.status = p.dueDate < DB.TODAY ? "OVERDUE" : "PENDING";
          p.paidDate = null;
        }
        build();
      }

      function chip(p) {
        var c = Util.clientById(p.clientId) || { name: "Client" };
        var cls = "cal-pay" + (p.status === "PAID" ? " collected" : p.status === "OVERDUE" ? " overdue" : "");
        var late = daysSince(p.dueDate);
        var stateText;
        if (p.status === "PAID") stateText = "Collected on " + fmtDate(p.paidDate) + ". Click to undo.";
        else if (p.status === "OVERDUE") stateText = "Overdue" + (late > 0 ? " by " + late + (late === 1 ? " day" : " days") : "") + ". Click to mark collected.";
        else stateText = "Awaiting payment. Click to mark collected.";
        var tip = c.name + ", " + typeLabel(p) + ", " + fmtMoney(p.amount) + ", due " + fmtDate(p.dueDate) + ". " + stateText;
        return h("div", {
          class: cls,
          title: tip,
          onclick: function () { togglePayment(p); }
        }, shortName(c.name) + " $" + fmtNum(p.amount));
      }

      function legendItem(color, label) {
        return h("span", { class: "cal-legend-item caption" },
          h("span", { class: "legend-chip", style: { background: color } }),
          label);
      }

      function build() {
        body.innerHTML = "";

        var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        var mStart = isoOf(viewYear, viewMonth, 1);
        var mEnd = isoOf(viewYear, viewMonth, daysInMonth);
        var monthPays = DB.payments.filter(function (p) { return p.dueDate >= mStart && p.dueDate <= mEnd; });
        var paidPays = monthPays.filter(function (p) { return p.status === "PAID"; });
        var collectedSum = paidPays.reduce(function (s, p) { return s + p.amount; }, 0);
        var billedSum = monthPays.reduce(function (s, p) { return s + p.amount; }, 0);

        /* header: title, month nav, collected stat */
        body.appendChild(h("div", { class: "cal-head" },
          h("h2", { class: "cal-title" }, MONTH_FULL[viewMonth] + " " + viewYear),
          h("button", { class: "btn icon", title: "Previous month", html: Icons.chevronLeft, onclick: function () { shift(-1); } }),
          h("button", { class: "btn icon", title: "Next month", html: Icons.chevronRight, onclick: function () { shift(1); } }),
          h("div", { class: "spacer" }),
          h("div", { class: "glass cash-stat" },
            h("div", { class: "caption" }, "Cash collected"),
            h("div", { class: "val" }, fmtMoney(collectedSum)),
            monthPays.length ? h("div", { class: "caption" }, paidPays.length + " of " + monthPays.length + " payments") : null
          )
        ));

        /* legend */
        body.appendChild(h("div", { class: "cal-legend" },
          legendItem("var(--orange)", "Due"),
          legendItem("var(--green)", "Collected"),
          legendItem("var(--red)", "Overdue")
        ));

        /* calendar grid, weeks start Monday */
        var byDate = {};
        DB.payments.forEach(function (p) {
          (byDate[p.dueDate] = byDate[p.dueDate] || []).push(p);
        });

        var grid = h("div", { class: "cal-grid" });
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (d) {
          grid.appendChild(h("div", { class: "cal-dow" }, d));
        });

        var startDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
        var prevDays = new Date(viewYear, viewMonth, 0).getDate();
        var totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

        for (var i = 0; i < totalCells; i++) {
          var dnum, cy = viewYear, cm = viewMonth, other = false;
          if (i < startDow) { dnum = prevDays - startDow + 1 + i; cm -= 1; other = true; }
          else if (i - startDow < daysInMonth) { dnum = i - startDow + 1; }
          else { dnum = i - startDow - daysInMonth + 1; cm += 1; other = true; }
          if (cm < 0) { cm = 11; cy -= 1; }
          if (cm > 11) { cm = 0; cy += 1; }

          var iso = isoOf(cy, cm, dnum);
          var cell = h("div", {
            class: "cal-cell" + (other ? " other" : "") + (iso === DB.TODAY ? " today" : "")
          }, h("div", { class: "d" }, String(dnum)));
          (byDate[iso] || []).forEach(function (p) { cell.appendChild(chip(p)); });
          grid.appendChild(cell);
        }
        body.appendChild(grid);

        /* this month list */
        var listBody;
        if (monthPays.length === 0) {
          listBody = emptyState({
            icon: Icons.calendar,
            title: "No payments this month",
            message: "Nothing is due in " + MONTH_FULL[viewMonth] + " " + viewYear + ". Use the arrows above to move between months."
          });
        } else {
          listBody = h("div", { class: "hairline-list" });
          var sorted = monthPays.slice().sort(function (a, b) {
            if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
            var ca = Util.clientById(a.clientId), cb = Util.clientById(b.clientId);
            return (ca ? ca.name : "").localeCompare(cb ? cb.name : "");
          });
          sorted.forEach(function (p) {
            var c = Util.clientById(p.clientId) || { name: "Client" };
            listBody.appendChild(h("div", {
              class: "row clickable month-row",
              onclick: function () { togglePayment(p); }
            },
              h("span", { class: "tag day-tag" }, String(parseInt(p.dueDate.slice(8, 10), 10))),
              h("div", {},
                h("div", { class: "month-row-name" }, c.name),
                h("div", { class: "caption" }, typeLabel(p))
              ),
              h("div", { class: "spacer" }),
              h("span", { class: "mono month-row-amt" }, fmtMoney(p.amount)),
              statusPill(p.status)
            ));
          });
        }

        body.appendChild(h("div", { class: "card" },
          h("div", { class: "card-head" },
            h("div", {},
              h("div", { class: "card-title" }, "This month"),
              monthPays.length ? h("div", { class: "card-sub" }, monthPays.length + (monthPays.length === 1 ? " payment, " : " payments, ") + fmtMoney(billedSum) + " billed") : null
            )
          ),
          listBody
        ));
      }

      build();
      root.appendChild(page);
    }
  };
})();
