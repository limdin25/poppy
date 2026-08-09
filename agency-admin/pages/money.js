(function () {
  /* year-month index for fast "is this month covered" comparisons */
  function ymOf(iso) {
    return parseInt(iso.slice(0, 4), 10) * 12 + (parseInt(iso.slice(5, 7), 10) - 1);
  }
  /* a client counts toward a month when they had started by then and had not churned before it */
  function activeInMonth(c, ym) {
    if (ymOf(c.startDate) > ym) return false;
    if (c.status === "ACTIVE") return true;
    if (c.churnDate) return ymOf(c.churnDate) >= ym;
    return false;
  }

  window.Pages.money = {
    css: [
      ".page-money .stack { display: flex; flex-direction: column; gap: 16px; }",
      ".page-money .split { display: grid; grid-template-columns: 360px 1fr; gap: 16px; align-items: stretch; }",
      "@media (max-width: 980px) { .page-money .split { grid-template-columns: 1fr; } }",
      ".page-money .donut-card { display: flex; flex-direction: column; }",
      ".page-money .donut-card .donut-hold { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 8px 0 4px; }",
      ".page-money .mrr-row { display: flex; align-items: center; gap: 12px; padding: 13px 4px; }",
      ".page-money .mrr-row .who { flex: 1; min-width: 0; }",
      ".page-money .mrr-row .who .nm { font-size: 14px; font-weight: 600; }",
      ".page-money .mrr-row .fee { font-weight: 600; font-size: 15px; font-variant-numeric: tabular-nums; }",
      ".page-money .margin-cell { display: flex; align-items: center; gap: 10px; min-width: 150px; }",
      ".page-money .margin-cell .progress { flex: 1; min-width: 70px; }",
      ".page-money .margin-cell .pct { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; width: 40px; text-align: right; }",
      ".page-money tr.totals td { font-weight: 700; border-top: 1px solid var(--hairline); }",
      ".page-money .cell-client { display: flex; align-items: center; gap: 10px; }"
    ].join("\n"),

    render: function (root) {
      var page = h("div", { class: "page-money" });
      var stack = h("div", { class: "stack" });

      /* ---------- derive everything from DB at render time ---------- */
      var todayYm = ymOf(DB.TODAY);
      var active = Util.activeClients();
      var mrr = Util.mrr();

      var paidPayments = DB.payments.filter(function (p) { return p.status === "PAID"; });
      var totalCollected = paidPayments.reduce(function (s, p) { return s + p.amount; }, 0);

      /* six chart months, Mar to Aug 2026 */
      var monthDefs = [];
      for (var mi = 2; mi <= 7; mi++) monthDefs.push({ label: MONTHS[mi], ym: 2026 * 12 + mi });

      var mrrSeries = monthDefs.map(function (md) {
        return DB.clients.reduce(function (s, c) { return s + (activeInMonth(c, md.ym) ? c.monthlyFee : 0); }, 0);
      });
      var revenueSeries = monthDefs.map(function (md) {
        return DB.payments.reduce(function (s, p) {
          return s + (p.type === "MONTHLY" && p.status === "PAID" && ymOf(p.dueDate) === md.ym ? p.amount : 0);
        }, 0);
      });
      var costSeries = monthDefs.map(function (md) {
        return DB.clients.reduce(function (s, c) { return s + (activeInMonth(c, md.ym) ? Util.teamCostFor(c.id) : 0); }, 0);
      });

      var dueToDate = DB.payments.filter(function (p) { return p.dueDate <= DB.TODAY; });
      var dueCollected = dueToDate.filter(function (p) { return p.status === "PAID"; }).length;
      var collectionRate = dueToDate.length ? dueCollected / dueToDate.length : 1;

      /* ---------- KPI row ---------- */
      stack.appendChild(h("div", { class: "grid cols-3" },
        kpiCard({
          label: "Total revenue collected",
          value: fmtMoney(totalCollected),
          sub: paidPayments.length + " invoices collected to date"
        }),
        kpiCard({
          label: "Current MRR",
          value: fmtMoney(mrr),
          sub: active.length + " active clients"
        }),
        kpiCard({
          label: "Projected annual revenue",
          value: fmtMoney(mrr * 12),
          sub: "Current MRR x 12"
        })
      ));

      /* ---------- charts ---------- */
      stack.appendChild(h("div", { class: "grid cols-2" },
        h("div", { class: "card" },
          h("div", { class: "card-head" },
            h("div", {},
              h("div", { class: "card-title" }, "MRR growth"),
              h("div", { class: "card-sub" }, "Active retainers, Mar to Aug 2026")
            )
          ),
          Charts.line({
            labels: monthDefs.map(function (md) { return md.label; }),
            series: [{ name: "MRR", color: CHART_COLORS[0], values: mrrSeries }],
            fmt: function (v) { return "$" + fmtNum(v); }
          })
        ),
        h("div", { class: "card" },
          h("div", { class: "card-head" },
            h("div", {},
              h("div", { class: "card-title" }, "Revenue vs team costs"),
              h("div", { class: "card-sub" }, "Collected retainers against monthly team payroll")
            )
          ),
          Charts.bars({
            labels: monthDefs.map(function (md) { return md.label; }),
            series: [
              { name: "Revenue", color: CHART_COLORS[0], values: revenueSeries },
              { name: "Costs", color: CHART_COLORS[1], values: costSeries }
            ],
            fmt: function (v) { return "$" + fmtNum(v); }
          })
        )
      ));

      /* ---------- collection rate + MRR breakdown ---------- */
      var donutColor = collectionRate >= 0.9 ? "#30D158" : "#FF9F0A";
      var donutCard = h("div", { class: "card donut-card" },
        h("div", { class: "card-head" },
          h("div", {},
            h("div", { class: "card-title" }, "Collection rate"),
            h("div", { class: "card-sub" }, "Invoices due through " + fmtDate(DB.TODAY))
          )
        ),
        h("div", { class: "donut-hold" },
          Charts.donut({ value: collectionRate, sublabel: "of invoices collected", color: donutColor, size: 160 }),
          h("div", { class: "caption" }, dueCollected + " of " + dueToDate.length + " invoices due to date are paid")
        )
      );

      var breakdownCard = h("div", { class: "card" },
        h("div", { class: "card-head" },
          h("div", {},
            h("div", { class: "card-title" }, "MRR breakdown"),
            h("div", { class: "card-sub" }, "Active retainers by client")
          ),
          pill(fmtMoney(mrr) + " / mo", "#0A84FF", false)
        )
      );
      if (active.length === 0) {
        breakdownCard.appendChild(emptyState({
          title: "No active clients",
          message: "Close a lead and the retainer shows up here automatically."
        }));
      } else {
        var list = h("div", { class: "hairline-list" });
        active.slice().sort(function (a, b) { return b.monthlyFee - a.monthlyFee; }).forEach(function (c) {
          list.appendChild(h("div", { class: "mrr-row" },
            avatar(c.name, 34),
            h("div", { class: "who" },
              h("div", { class: "nm ellipsis" }, c.name),
              h("div", { class: "caption ellipsis" }, planLabel(c))
            ),
            c.setupFeePaid ? statusPill("PAID") : pill("Setup outstanding", "#FF9F0A"),
            h("div", { class: "fee" }, fmtMoney(c.monthlyFee))
          ));
        });
        breakdownCard.appendChild(list);
      }
      stack.appendChild(h("div", { class: "split" }, donutCard, breakdownCard));

      /* ---------- payment tracker ---------- */
      var rank = { OVERDUE: 0, PENDING: 1, PAID: 2 };
      var tracked = DB.payments.slice().sort(function (a, b) {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        if (a.status === "PAID") return a.dueDate > b.dueDate ? -1 : a.dueDate < b.dueDate ? 1 : 0;
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      }).slice(0, 15);
      var openCount = DB.payments.filter(function (p) { return p.status !== "PAID"; }).length;

      var trackerCard = h("div", { class: "card" },
        h("div", { class: "card-head" },
          h("div", {},
            h("div", { class: "card-title" }, "Payment tracker"),
            h("div", { class: "card-sub" }, "Overdue and pending invoices first, latest 15 shown")
          ),
          openCount > 0 ? pill(openCount + " open", "#FF9F0A") : pill("All collected", "#30D158")
        )
      );
      if (tracked.length === 0) {
        trackerCard.appendChild(emptyState({
          title: "No invoices yet",
          message: "Invoices appear here as soon as a client is onboarded."
        }));
      } else {
        var tbody = h("tbody", {});
        tracked.forEach(function (p) {
          var c = Util.clientById(p.clientId);
          var actionCell;
          if (p.status === "PAID") {
            actionCell = h("span", { class: "caption" }, "Paid " + fmtDateShort(p.paidDate));
          } else {
            actionCell = h("button", {
              class: "btn small",
              onclick: function () {
                p.status = "PAID";
                p.paidDate = DB.TODAY;
                toast("Payment recorded");
                App.refresh();
              }
            }, "Mark paid");
          }
          tbody.appendChild(h("tr", {},
            h("td", {}, h("div", { class: "cell-client" }, avatar(c ? c.name : "?", 26), h("span", {}, c ? c.name : "Unknown"))),
            h("td", {}, h("span", { class: "tag" }, p.type === "SETUP" ? "Setup fee" : "Monthly")),
            h("td", { class: "num mono" }, fmtMoney(p.amount)),
            h("td", {}, fmtDate(p.dueDate)),
            h("td", {}, statusPill(p.status)),
            h("td", { class: "right" }, actionCell)
          ));
        });
        trackerCard.appendChild(h("div", { class: "table-wrap" },
          h("table", { class: "table" },
            h("thead", {}, h("tr", {},
              h("th", {}, "Client"),
              h("th", {}, "Type"),
              h("th", { class: "num" }, "Amount"),
              h("th", {}, "Due date"),
              h("th", {}, "Status"),
              h("th", {}, "")
            )),
            tbody
          )
        ));
      }
      stack.appendChild(trackerCard);

      /* ---------- profit per client ---------- */
      var profitCard = h("div", { class: "card" },
        h("div", { class: "card-head" },
          h("div", {},
            h("div", { class: "card-title" }, "Profit per client"),
            h("div", { class: "card-sub" }, "Monthly retainer minus assigned team cost")
          )
        )
      );
      if (active.length === 0) {
        profitCard.appendChild(emptyState({
          title: "No active clients",
          message: "Profitability appears here once a client is active."
        }));
      } else {
        function marginCell(marginPct) {
          var color = marginPct >= 60 ? "#30D158" : marginPct >= 40 ? "#FF9F0A" : "#FF453A";
          return h("div", { class: "margin-cell" },
            h("div", { class: "progress" },
              h("i", { style: { width: Math.max(0, Math.min(100, marginPct)) + "%", background: color } })
            ),
            h("span", { class: "pct", style: { color: color } }, Math.round(marginPct) + "%")
          );
        }
        var totRev = 0, totCost = 0;
        var ptbody = h("tbody", {});
        active.slice().sort(function (a, b) {
          return (b.monthlyFee - Util.teamCostFor(b.id)) - (a.monthlyFee - Util.teamCostFor(a.id));
        }).forEach(function (c) {
          var cost = Util.teamCostFor(c.id);
          var profit = c.monthlyFee - cost;
          var marginPct = c.monthlyFee > 0 ? (profit / c.monthlyFee) * 100 : 0;
          totRev += c.monthlyFee;
          totCost += cost;
          ptbody.appendChild(h("tr", {},
            h("td", {}, h("div", { class: "cell-client" }, avatar(c.name, 26), h("span", {}, c.name))),
            h("td", { class: "num mono" }, fmtMoney(c.monthlyFee)),
            h("td", { class: "num mono" }, fmtMoney(cost)),
            h("td", { class: "num mono" }, fmtMoney(profit)),
            h("td", {}, marginCell(marginPct))
          ));
        });
        var totProfit = totRev - totCost;
        var totMargin = totRev > 0 ? (totProfit / totRev) * 100 : 0;
        ptbody.appendChild(h("tr", { class: "totals" },
          h("td", {}, "Total"),
          h("td", { class: "num mono" }, fmtMoney(totRev)),
          h("td", { class: "num mono" }, fmtMoney(totCost)),
          h("td", { class: "num mono" }, fmtMoney(totProfit)),
          h("td", {}, marginCell(totMargin))
        ));
        profitCard.appendChild(h("div", { class: "table-wrap" },
          h("table", { class: "table" },
            h("thead", {}, h("tr", {},
              h("th", {}, "Client"),
              h("th", { class: "num" }, "Revenue / mo"),
              h("th", { class: "num" }, "Team cost / mo"),
              h("th", { class: "num" }, "Profit / mo"),
              h("th", {}, "Margin")
            )),
            ptbody
          )
        ));
      }
      stack.appendChild(profitCard);

      page.appendChild(stack);
      root.appendChild(page);
    }
  };
})();
