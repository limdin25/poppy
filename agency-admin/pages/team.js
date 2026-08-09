/* TEAM tab: allocation lanes per client + capacity tracker. */
(function () {
  var ROLES = ["CHANNEL_MANAGER", "SHORT_FORM_EDITOR", "LONG_FORM_EDITOR", "THUMBNAIL_DESIGNER"];

  function addMemberModal(clientId) {
    var name = h("input", { class: "input", placeholder: "Full name" });
    var role = h("select", { class: "select" }, ROLES.map(function (r) {
      return h("option", { value: r }, Util.roleLabel(r));
    }));
    var cost = h("input", { class: "input", type: "number", step: "100", min: "0", value: "1200", placeholder: "Monthly cost" });
    var m = openModal({
      title: "Add team member",
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Name"), name),
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Role"), role),
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Monthly cost (USD)"), cost)
      ),
      actions: [
        h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
        h("button", {
          class: "btn primary", onclick: function () {
            if (!name.value.trim()) { toast("Name is required", "error"); return; }
            DB.team.push({ id: uid(), clientId: clientId, role: role.value, name: name.value.trim(), cost: parseInt(cost.value, 10) || 0 });
            m.close(); toast("Member added"); App.refresh();
          }
        }, "Add member")
      ]
    });
  }

  function memberRow(t) {
    return h("div", { class: "member" },
      avatar(t.name, 34),
      h("div", { style: { flex: "1", minWidth: "0" } },
        h("div", { style: { fontWeight: "500", fontSize: "14px" }, class: "ellipsis" }, t.name),
        h("div", { class: "caption" }, Util.roleLabel(t.role))
      ),
      h("span", { class: "mono", style: { fontSize: "14px" } }, fmtMoney(t.cost)),
      h("button", {
        class: "btn ghost icon small", html: Icons.trash, title: "Remove",
        onclick: function () {
          confirmModal({
            title: "Remove " + t.name + "?",
            message: "They are removed from this client only. Their seats on other clients stay.",
            danger: true, confirmText: "Remove",
            onConfirm: function () {
              DB.team = DB.team.filter(function (x) { return x.id !== t.id; });
              toast("Member removed"); App.refresh();
            }
          });
        }
      })
    );
  }

  function lane(c) {
    var members = Util.teamFor(c.id);
    var total = Util.teamCostFor(c.id);
    var margin = c.monthlyFee - total;
    return h("div", { class: "card lane" },
      h("div", { class: "lane-head" },
        avatar(c.name, 38),
        h("div", { style: { flex: "1" } },
          h("div", { style: { fontWeight: "600", fontSize: "15px" } }, c.name),
          h("div", { class: "caption" }, planLabel(c))
        ),
        h("span", { class: "tag" }, "Team cost " + fmtMoney(total) + "/mo"),
        h("span", { class: "tag", style: { color: margin >= 0 ? "var(--green)" : "var(--red)" } }, "Margin " + fmtMoney(margin))
      ),
      members.length
        ? h("div", { class: "grid cols-2" }, members.map(memberRow))
        : h("div", { class: "caption", style: { padding: "6px 2px" } }, "No team assigned yet."),
      h("div", { style: { marginTop: "12px" } },
        h("button", { class: "btn small ghost", onclick: function () { addMemberModal(c.id); } },
          h("span", { html: Icons.plus }), "Add member")
      )
    );
  }

  function capacityCard() {
    var byName = {};
    DB.team.forEach(function (t) {
      if (!byName[t.name]) byName[t.name] = { name: t.name, roles: [], clients: [], cost: 0 };
      var p = byName[t.name];
      if (p.roles.indexOf(Util.roleLabel(t.role)) < 0) p.roles.push(Util.roleLabel(t.role));
      if (p.clients.indexOf(t.clientId) < 0) p.clients.push(t.clientId);
      p.cost += t.cost;
    });
    var people = Object.keys(byName).map(function (k) { return byName[k]; })
      .sort(function (a, b) { return b.clients.length - a.clients.length; });
    function loadPill(n) {
      if (n >= 4) return pill("Overloaded", "#FF453A");
      if (n === 3) return pill("At capacity", "#FF9F0A");
      if (n === 2) return pill("Normal", "#0A84FF");
      return pill("Available", "#30D158");
    }
    var flagged = people.filter(function (p) { return p.clients.length >= 3; }).map(function (p) { return p.name; });
    return h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("div", { class: "card-title" }, "Capacity"), h("div", { class: "card-sub" }, "How many clients each member carries")),
      ),
      h("div", { class: "table-wrap" },
        h("table", { class: "table" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Member"), h("th", {}, "Roles"), h("th", { class: "num" }, "Clients"),
            h("th", { class: "num" }, "Total cost/mo"), h("th", {}, "Load"))),
          h("tbody", {}, people.map(function (p) {
            return h("tr", {},
              h("td", {}, h("div", { class: "row" }, avatar(p.name, 30), h("span", { style: { fontWeight: "500" } }, p.name))),
              h("td", { class: "muted", style: { fontSize: "13px" } }, p.roles.join(", ")),
              h("td", { class: "num mono" }, String(p.clients.length)),
              h("td", { class: "num mono" }, fmtMoney(p.cost)),
              h("td", {}, loadPill(p.clients.length))
            );
          }))
        )
      ),
      h("div", { class: "caption", style: { marginTop: "10px" } },
        flagged.length ? "Members on 3 or more clients are flagged: " + flagged.join(", ") + "." : "Nobody is over capacity.")
    );
  }

  window.Pages.team = {
    css: ".page-team .lane { margin-bottom: 16px; } .page-team .member .btn.icon { opacity: 0; transition: opacity 0.15s; } .page-team .member:hover .btn.icon { opacity: 1; }",
    render: function (root) {
      var page = h("div", { class: "page-team" });
      var actives = Util.activeClients();
      var totalCost = DB.team.reduce(function (s, t) { return s + t.cost; }, 0);
      var uniqueNames = {};
      DB.team.forEach(function (t) { uniqueNames[t.name] = 1; });
      page.appendChild(h("div", { class: "grid cols-3" },
        kpiCard({ label: "Total team cost", value: fmtMoney(totalCost), sub: "per month, all clients" }),
        kpiCard({ label: "Team members", value: String(Object.keys(uniqueNames).length), sub: DB.team.length + " seats across clients" }),
        kpiCard({ label: "Avg cost per client", value: fmtMoney(actives.length ? Math.round(totalCost / actives.length) : 0), sub: "across " + actives.length + " active clients" })
      ));
      page.appendChild(sectionHead("By client"));
      actives.forEach(function (c) { page.appendChild(lane(c)); });
      page.appendChild(sectionHead("Capacity"));
      page.appendChild(capacityCard());
      root.appendChild(page);
    }
  };
})();
