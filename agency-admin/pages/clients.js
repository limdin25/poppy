/* CLIENTS tab: list + add/edit modal with AI analysis, and the client detail page
   with strategy, pipeline, per-client Suggested Titles / Suggested Ideas tools. */
(function () {
  var search = "";
  var planFilter = "ALL";
  var editMode = false;

  /* ---------------- canned AI content ---------------- */
  function nicheOf(c) {
    var t = ((c.channelSummary || "") + " " + (c.offers || "") + " " + c.name).toLowerCase();
    if (/(invest|finance|market|stock|money)/.test(t)) return "finance";
    if (/(fitness|nutrition|workout|gym)/.test(t)) return "fitness";
    if (/(saas|founder|startup|b2b)/.test(t)) return "saas";
    if (/(car|motor|restor)/.test(t)) return "cars";
    if (/(dental|dentist|clinic|practice)/.test(t)) return "local expert";
    return "creator";
  }
  function coreOf(title) {
    return title.replace(/[.!?]+$/, "").replace(/^(How|Why|What|The)\s+/i, function (m) { return m; });
  }
  var TITLE_SETS = [
    [
      function (t) { return "The truth about " + lower(coreOf(t)); },
      function (t) { return coreOf(t) + " (nobody tells you this part)"; },
      function (t) { return "I was wrong about " + lower(coreOf(t)); }
    ],
    [
      function (t) { return "What " + lower(coreOf(t)) + " taught me about money and attention"; },
      function (t) { return coreOf(t) + ": the version that actually works"; },
      function (t) { return "Watch this before " + lower(coreOf(t)); }
    ]
  ];
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  var IDEA_POOLS = {
    finance: [
      ["I stress-tested the classic 60/40 portfolio", "Live analysis is his authority format, and the result is falsifiable."],
      ["What the last 5 rate cuts did to normal savers", "Contrarian data payoff, maps to the September series."],
      ["My own portfolio, uncut", "Personal stakes reveal, historically his best CTR."],
      ["The retirement math nobody runs", "High-search evergreen with a curiosity gap in the framing."],
      ["Reacting to this week's market move in 24 hours", "Reaction slot: reliably 3x median views in this niche."]
    ],
    fitness: [
      ["One change, 30 days: protein first", "The mid-form bridge series, trains Shorts viewers to click uploads."],
      ["What 90 days of walking actually does", "Outcome-framed, extends her best performing Short."],
      ["I trained like a beginner again for a week", "Empathy angle that widens the audience past regulars."],
      ["The gym mistakes I see every day", "Authority listicle with clip-friendly segments."],
      ["Before/after: the honest version", "Her proven visual pattern, packaged for long-form."]
    ],
    saas: [
      ["How a 4-person team hit $10M ARR", "Lesson-first framing, the guest is proof not the hook."],
      ["The pricing mistake killing your SaaS", "Pain-point title, converts to the mastermind."],
      ["I audited a stranger's startup live", "Live analysis format, endlessly repeatable."],
      ["Why most founders scale the wrong thing first", "Contrarian consensus-breaker."],
      ["The down round conversation nobody records", "Raw-honesty positioning, feeds the series brand."]
    ],
    cars: [
      ["This engine sat for 30 years. It starts today", "Payoff-in-title, the reveal is the product."],
      ["Saving a 1968 Mustang from a barn", "Series opener with an appointment-viewing hook."],
      ["What this restoration really cost", "Money transparency, converts viewers to buyers."],
      ["The part that nearly ended the build", "Cliffhanger episode, ends on the next problem."],
      ["Delivery day: the owner sees it first", "Emotional payoff episode that sells commissions."]
    ],
    "local expert": [
      ["What your dentist sees that you cannot", "Authority curiosity gap, books consults."],
      ["I reviewed 5 viral smile transformations", "Reaction format borrowing existing search demand."],
      ["The real cost of a perfect smile", "Price transparency builds trust for high-ticket."],
      ["Fixing a smile in one visit, start to finish", "Process content, the niche's proven format."],
      ["Questions patients are afraid to ask", "Comment-mining format, infinite series fuel."]
    ],
    creator: [
      ["The strategy behind our last 30 days", "Transparency format that compounds trust."],
      ["I copied the biggest channel in this niche", "Benchmark format with a built-in villain."],
      ["What actually grew this channel", "Retrospective with falsifiable numbers."],
      ["One video, three packaging tests", "Packaging-first philosophy on camera."],
      ["The upload that changed everything", "Origin-story format for new viewers."]
    ]
  };
  function cannedAnalysis(name, url) {
    var handle = (url.split("@")[1] || name || "this channel").replace(/[^a-zA-Z0-9]/g, " ").trim();
    return {
      summary: "\"" + (name || handle) + "\" publishes weekly long-form with an engaged core audience. Packaging lags the content: titles describe topics instead of stakes, and thumbnails carry too many words to read at feed size. Watch time on existing uploads suggests the audience is ready for a sharper promise.",
      offers: "Primary offer inferred from the channel and site links. Confirm on the kickoff call and record the funnel here.",
      bullets: [
        "Cut titles to one open loop under 55 characters.",
        "Move the payoff tease into the first 20 seconds.",
        "Rebuild thumbnails around one face and three words."
      ]
    };
  }

  /* ---------------- shared add / edit modal ---------------- */
  function stepperEl(value, min, max, step, onChange) {
    var val = value;
    var label = h("span", { class: "stepper-val" }, fmtMoney(val));
    function set(v) {
      val = Math.max(min, Math.min(max, v));
      label.textContent = fmtMoney(val);
      onChange(val);
    }
    return h("div", { class: "stepper" },
      h("button", { type: "button", onclick: function () { set(val - step); } }, "-"),
      label,
      h("button", { type: "button", onclick: function () { set(val + step); } }, "+")
    );
  }

  function clientModal(existing) {
    var draft = {
      name: existing ? existing.name : "",
      person: existing ? existing.person : "",
      channelUrl: existing ? existing.channelUrl : "",
      planType: existing ? existing.planType : "TEAM_ONLY",
      customPlanLabel: existing ? existing.customPlanLabel : "",
      monthlyFee: existing ? existing.monthlyFee : 8000,
      setupFee: existing ? existing.setupFee : 30000,
      startDate: existing ? existing.startDate : DB.TODAY,
      analysis: null
    };
    var nameInput = h("input", { class: "input", placeholder: "Client or channel name", value: draft.name, oninput: function (e) { draft.name = e.target.value; } });
    var personInput = h("input", { class: "input", placeholder: "Owner's name (optional)", value: draft.person, oninput: function (e) { draft.person = e.target.value; } });
    var urlInput = h("input", { class: "input", placeholder: "https://youtube.com/@channel", value: draft.channelUrl, oninput: function (e) { draft.channelUrl = e.target.value; } });

    var analysisBox = h("div", {});
    var analyzeBtn = h("button", {
      class: "btn", onclick: function () {
        if (!urlInput.value.trim()) { toast("Paste a channel URL first", "error"); return; }
        analyzeBtn.disabled = true;
        analysisBox.innerHTML = "";
        [70, 100, 85].forEach(function (w) {
          analysisBox.appendChild(h("div", { class: "shimmer", style: { height: "13px", width: w + "%", marginBottom: "8px" } }));
        });
        setTimeout(function () {
          draft.analysis = cannedAnalysis(draft.name, urlInput.value.trim());
          analyzeBtn.disabled = false;
          analysisBox.innerHTML = "";
          analysisBox.appendChild(h("div", { style: { fontSize: "13px", lineHeight: "1.6", color: "var(--text2)", display: "flex", flexDirection: "column", gap: "8px" } },
            h("div", {}, h("b", { style: { color: "var(--text)" } }, "Summary: "), draft.analysis.summary),
            h("div", {}, h("b", { style: { color: "var(--text)" } }, "Offers: "), draft.analysis.offers),
            h("div", {}, h("b", { style: { color: "var(--text)" } }, "First strategy moves:"),
              h("ul", { style: { paddingLeft: "16px", marginTop: "4px" } }, draft.analysis.bullets.map(function (b) { return h("li", {}, b); })))
          ));
        }, 1400);
      }
    }, h("span", { html: Icons.sparkle }), "Analyze channel");

    var feeRow = h("div", {});
    var planSeg = h("div", { class: "seg" });
    function renderPlan() {
      planSeg.innerHTML = "";
      [["TEAM_ONLY", "Team only"], ["PERSONAL_INVOLVED", "Personal involved"], ["CUSTOM", "Custom"]].forEach(function (p) {
        planSeg.appendChild(h("button", {
          type: "button", class: draft.planType === p[0] ? "active" : "",
          onclick: function () { draft.planType = p[0]; renderPlan(); }
        }, p[1]));
      });
      feeRow.innerHTML = "";
      feeRow.appendChild(h("div", { class: "field" },
        h("span", { class: "label-text" }, "Monthly fee"),
        stepperEl(draft.monthlyFee, 1000, 20000, 1000, function (v) { draft.monthlyFee = v; })
      ));
      if (draft.planType === "CUSTOM") {
        feeRow.appendChild(h("div", { class: "field", style: { marginTop: "12px" } },
          h("span", { class: "label-text" }, "Plan label"),
          h("input", {
            class: "input", placeholder: "$3,000. Only ideation and channel management",
            value: draft.customPlanLabel, oninput: function (e) { draft.customPlanLabel = e.target.value; }
          })
        ));
      }
    }
    renderPlan();

    var setupInput = h("input", { class: "input", type: "number", step: "1000", value: String(draft.setupFee), oninput: function (e) { draft.setupFee = parseInt(e.target.value, 10) || 0; } });
    var dateInput = h("input", { class: "input", type: "date", value: draft.startDate, oninput: function (e) { draft.startDate = e.target.value; } });

    var m = openModal({
      title: existing ? "Edit " + existing.name : "Add Client",
      wide: true,
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        h("div", { class: "grid cols-2" },
          h("div", { class: "field" }, h("span", { class: "label-text" }, "Client name"), nameInput),
          h("div", { class: "field" }, h("span", { class: "label-text" }, "Person"), personInput)
        ),
        h("div", { class: "field" }, h("span", { class: "label-text" }, "YouTube channel URL"), urlInput),
        h("div", { class: "row" }, analyzeBtn, h("span", { class: "caption" }, "Reads the channel and drafts summary, offers, and strategy.")),
        analysisBox,
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Plan"), planSeg),
        feeRow,
        h("div", { class: "grid cols-2" },
          h("div", { class: "field" }, h("span", { class: "label-text" }, "Setup fee (USD)"), setupInput),
          h("div", { class: "field" }, h("span", { class: "label-text" }, "Start date"), dateInput)
        )
      ),
      actions: [
        h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
        h("button", {
          class: "btn primary", onclick: function () {
            if (!draft.name.trim()) { toast("Client name is required", "error"); return; }
            if (existing) {
              existing.name = draft.name.trim(); existing.person = draft.person.trim();
              existing.channelUrl = urlInput.value.trim();
              existing.planType = draft.planType; existing.customPlanLabel = draft.customPlanLabel;
              existing.monthlyFee = draft.monthlyFee; existing.setupFee = draft.setupFee;
              existing.startDate = draft.startDate;
              if (draft.analysis) {
                existing.channelSummary = draft.analysis.summary;
                existing.offers = draft.analysis.offers;
              }
              toast("Client updated");
            } else {
              DB.clients.push({
                id: "c" + uid(), name: draft.name.trim(), person: draft.person.trim(),
                channelUrl: urlInput.value.trim(),
                planType: draft.planType, customPlanLabel: draft.customPlanLabel,
                setupFee: draft.setupFee, setupFeePaid: false, monthlyFee: draft.monthlyFee,
                startDate: draft.startDate, status: "ACTIVE",
                discordServer: "", googleAccountEmail: "",
                stage: "WAITING_FOR_FOOTAGE", stageSource: "MANUAL", stageUpdatedAt: DB.TODAY + "T12:00:00",
                channelSummary: draft.analysis ? draft.analysis.summary : null,
                offers: draft.analysis ? draft.analysis.offers : "",
                contentStrategy: draft.analysis ? draft.analysis.bullets.map(function (b) {
                  return { point: b, reasoning: "Drafted by the channel analysis. Expand after the kickoff call." };
                }) : [],
                notes: ""
              });
              DB.payments.push({ id: "p" + uid(), clientId: DB.clients[DB.clients.length - 1].id, amount: draft.setupFee, type: "SETUP", dueDate: draft.startDate, paidDate: null, status: "PENDING" });
              toast("Client added");
            }
            m.close(); App.refresh();
          }
        }, existing ? "Save changes" : "Add client")
      ]
    });
  }

  /* ---------------- list view ---------------- */
  function listView(page) {
    var header = h("div", { class: "row wrap", style: { marginBottom: "16px" } });
    var searchInput = h("input", {
      class: "input", placeholder: "Search clients...", value: search,
      oninput: function (e) { search = e.target.value; renderRows(); }
    });
    header.appendChild(h("div", { class: "search-wrap", style: { width: "240px" } }, h("span", { html: Icons.search }), searchInput));
    var seg = h("div", { class: "seg" });
    [["ALL", "All"], ["TEAM_ONLY", "Team only"], ["PERSONAL_INVOLVED", "Personal"], ["CUSTOM", "Custom"]].forEach(function (p) {
      seg.appendChild(h("button", {
        class: planFilter === p[0] ? "active" : "",
        onclick: function () { planFilter = p[0]; App.refresh(); }
      }, p[1]));
    });
    header.appendChild(seg);
    header.appendChild(h("button", {
      class: "btn" + (editMode ? " primary" : ""),
      onclick: function () { editMode = !editMode; App.refresh(); }
    }, h("span", { html: Icons.edit }), editMode ? "Done" : "Manage"));
    header.appendChild(h("span", { class: "spacer" }));
    header.appendChild(h("button", { class: "btn primary", onclick: function () { clientModal(null); } },
      h("span", { html: Icons.plus }), "Add Client"));
    page.appendChild(header);

    var listCard = h("div", { class: "card", style: { padding: "6px 0" } });
    var listBody = h("div", { class: "hairline-list" });
    listCard.appendChild(listBody);
    page.appendChild(listCard);

    function renderRows() {
      listBody.innerHTML = "";
      var q = search.trim().toLowerCase();
      var rows = DB.clients.filter(function (c) {
        if (planFilter !== "ALL" && c.planType !== planFilter) return false;
        if (!q) return true;
        return (c.name + " " + (c.person || "")).toLowerCase().indexOf(q) >= 0;
      });
      if (!rows.length) {
        listBody.appendChild(emptyState({ icon: Icons.search, title: "No clients match", message: "Try a different name or clear the plan filter." }));
        return;
      }
      rows.forEach(function (c) {
        var row = h("div", {
          class: "row clickable", style: { padding: "14px 20px", gap: "14px" },
          onclick: function () { location.hash = "#/clients/" + c.id; }
        },
          avatar(c.name, 40),
          h("div", { style: { flex: "1", minWidth: "0" } },
            h("div", { style: { fontWeight: "600", fontSize: "15px" }, class: "ellipsis" }, c.name),
            h("div", { class: "caption" }, c.person || "")
          ),
          h("span", { class: "caption ellipsis", style: { width: "150px", flex: "none" }, title: planLabel(c) }, planLabel(c)),
          stagePill(c.stage),
          h("span", { class: "mono nowrap", style: { fontWeight: "600", width: "110px", textAlign: "right" } }, fmtMoney(c.monthlyFee) + "/mo"),
          statusPill(c.status)
        );
        if (editMode) {
          row.appendChild(h("button", {
            class: "btn small icon", html: Icons.edit, title: "Edit",
            onclick: function (e) { e.stopPropagation(); clientModal(c); }
          }));
          if (c.status === "CHURNED") row.appendChild(h("button", {
            class: "btn small danger icon", html: Icons.trash, title: "Delete",
            onclick: function (e) {
              e.stopPropagation();
              confirmModal({
                title: "Delete churned client?",
                message: c.name + " and their history disappear from every tab. This cannot be undone.",
                danger: true, confirmText: "Delete",
                onConfirm: function () {
                  DB.clients = DB.clients.filter(function (x) { return x.id !== c.id; });
                  toast("Client deleted"); App.refresh();
                }
              });
            }
          }));
        }
        listBody.appendChild(row);
      });
    }
    renderRows();
  }

  /* ---------------- detail: suggested titles / ideas ---------------- */
  function longFormVideos(c) {
    var a = DB.analytics[c.id];
    if (!a || !a.topVideos) return [];
    return a.topVideos.filter(Util.isLongForm)
      .slice().sort(function (x, y) { return y.published < x.published ? -1 : 1; })
      .slice(0, 5);
  }
  function trainingChat(c, scope, placeholder) {
    var wrap = h("div", { style: { marginTop: "14px", borderTop: "0.5px solid var(--border)", paddingTop: "12px" } });
    wrap.appendChild(h("div", { class: "label-text", style: { marginBottom: "8px" } }, "Teach it this client's taste"));
    var hist = h("div", { style: { display: "flex", flexDirection: "column", gap: "5px", marginBottom: "10px" } });
    function renderHist() {
      hist.innerHTML = "";
      DB.knowledge.filter(function (k) { return k.scope === scope && k.clientId === c.id; }).forEach(function (k) {
        hist.appendChild(h("div", { class: "caption", style: { display: "flex", gap: "6px" } },
          h("span", { html: Icons.check, style: { width: "13px", flex: "none", color: "var(--green)", display: "inline-flex", marginTop: "2px" } }),
          k.learnedPrinciple));
      });
    }
    renderHist();
    wrap.appendChild(hist);
    var confirmLine = h("div", { class: "caption", style: { display: "none", marginBottom: "8px" } });
    wrap.appendChild(confirmLine);
    wrap.appendChild(chatInputBar({
      placeholder: placeholder,
      onSend: function (text) {
        DB.knowledge.push({
          id: uid(), scope: scope, clientId: c.id, userInput: text,
          learnedPrinciple: text.length > 90 ? text.slice(0, 87) + "..." : text,
          ts: "2026-08-05T12:00:00"
        });
        confirmLine.style.display = "block";
        confirmLine.textContent = "Learning...";
        setTimeout(function () {
          confirmLine.textContent = mockAiReply("training", text).split("\n")[0];
          renderHist();
        }, 700);
      }
    }));
    return wrap;
  }
  function titlesCard(c) {
    var card = h("div", { class: "card" });
    var vids = longFormVideos(c);
    card.appendChild(h("div", { class: "card-head" },
      h("div", {},
        h("div", { class: "card-title" }, "Suggested Titles"),
        h("div", { class: "card-sub" }, "3 alternatives for each of the last " + (vids.length || 5) + " long-form uploads")),
      h("button", {
        class: "btn small", onclick: function () { generate(true); }
      }, h("span", { html: Icons.sparkle }), c._titles ? "Regenerate" : "Generate titles")
    ));
    var body = h("div", {});
    card.appendChild(body);
    function renderResults() {
      body.innerHTML = "";
      if (!vids.length) {
        body.appendChild(h("div", { class: "caption" }, "Needs channel data. Connect the channel in Analytics and titles are generated from the latest long-form uploads."));
        return;
      }
      if (!c._titles) {
        body.appendChild(h("div", { class: "caption" }, "Nothing generated yet. Titles use the global video training plus this client's own taste notes below."));
        return;
      }
      c._titles.groups.forEach(function (g) {
        body.appendChild(h("div", { style: { marginBottom: "14px" } },
          h("div", { class: "caption", style: { marginBottom: "6px" } }, "Original: " + g.original),
          h("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } },
            g.alts.map(function (t) {
              return h("div", { class: "row", style: { fontSize: "14px", gap: "8px" } },
                h("span", { html: Icons.chevronRight, style: { width: "13px", flex: "none", color: "var(--blue)", display: "inline-flex" } }),
                h("span", { style: { flex: "1" } }, t),
                h("button", { class: "btn ghost icon small", html: Icons.copy, title: "Copy", onclick: function () { copyText(t); } })
              );
            }))
        ));
      });
    }
    function generate(force) {
      if (!vids.length) return;
      var roll = c._titles && force ? (c._titles.roll + 1) % TITLE_SETS.length : 0;
      body.innerHTML = "";
      [90, 75, 85].forEach(function (w) {
        body.appendChild(h("div", { class: "shimmer", style: { height: "13px", width: w + "%", marginBottom: "8px" } }));
      });
      setTimeout(function () {
        var set = TITLE_SETS[roll];
        c._titles = {
          roll: roll,
          groups: vids.map(function (v) {
            return { original: v.title, alts: set.map(function (f) { return f(v.title); }) };
          })
        };
        renderResults();
      }, 1200);
    }
    renderResults();
    card.appendChild(trainingChat(c, "CLIENT_TITLES", "e.g. Never promise returns, tension from information gaps only"));
    return card;
  }
  function ideasCard(c) {
    var card = h("div", { class: "card" });
    card.appendChild(h("div", { class: "card-head" },
      h("div", {},
        h("div", { class: "card-title" }, "Suggested Ideas"),
        h("div", { class: "card-sub" }, "Fresh long-form videos tailored to " + c.name)),
      h("button", {
        class: "btn small", onclick: function () { generate(); }
      }, h("span", { html: Icons.sparkle }), c._ideas ? "Regenerate" : "Generate ideas")
    ));
    var body = h("div", {});
    card.appendChild(body);
    function renderResults() {
      body.innerHTML = "";
      if (!c._ideas) {
        body.appendChild(h("div", { class: "caption" }, "Nothing generated yet. Ideas combine the global video training with this client's niche and taste notes."));
        return;
      }
      body.appendChild(h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
        c._ideas.items.map(function (it, i) {
          return h("div", { class: "row", style: { alignItems: "flex-start", gap: "10px" } },
            h("span", { class: "step-num", style: { marginTop: "1px" } }, String(i + 1)),
            h("div", { style: { flex: "1" } },
              h("div", { style: { fontWeight: "500", fontSize: "14px" } }, it.title),
              h("div", { class: "caption" }, it.why)
            ),
            h("button", { class: "btn ghost icon small", html: Icons.copy, title: "Copy", onclick: function () { copyText(it.title); } })
          );
        })));
    }
    function generate() {
      body.innerHTML = "";
      [85, 70, 90, 65, 80].forEach(function (w) {
        body.appendChild(h("div", { class: "shimmer", style: { height: "13px", width: w + "%", marginBottom: "8px" } }));
      });
      setTimeout(function () {
        var pool = IDEA_POOLS[nicheOf(c)] || IDEA_POOLS.creator;
        var offset = c._ideas ? (c._ideas.offset + 1) % pool.length : 0;
        var items = [];
        for (var i = 0; i < 5; i++) {
          var p = pool[(i + offset) % pool.length];
          items.push({ title: p[0], why: p[1] });
        }
        c._ideas = { offset: offset, items: items };
        renderResults();
      }, 1200);
    }
    renderResults();
    card.appendChild(trainingChat(c, "CLIENT_IDEAS", "e.g. He loves live analysis, hates reaction content"));
    return card;
  }

  /* ---------------- detail view ---------------- */
  function detailView(page, c) {
    page.appendChild(h("div", { class: "row", style: { marginBottom: "14px" } },
      h("button", { class: "btn ghost", onclick: function () { location.hash = "#/clients"; } },
        h("span", { html: Icons.chevronLeft }), "All clients")));

    var refreshBtn = h("button", {
      class: "btn", onclick: function () {
        refreshBtn.disabled = true;
        setTimeout(function () {
          refreshBtn.disabled = false;
          if (!c.channelSummary) {
            var a = cannedAnalysis(c.name, c.channelUrl);
            c.channelSummary = a.summary;
            if (!c.contentStrategy.length) c.contentStrategy = a.bullets.map(function (b) {
              return { point: b, reasoning: "Drafted by the channel analysis. Expand after the kickoff call." };
            });
            App.refresh();
          }
          toast("Re-analyzed with the latest uploads");
        }, 1200);
      }
    }, h("span", { html: Icons.refresh }), "Refresh Analysis");

    page.appendChild(h("div", { class: "row wrap", style: { marginBottom: "20px", gap: "14px" } },
      avatar(c.name, 56),
      h("div", { style: { flex: "1", minWidth: "200px" } },
        h("h1", { style: { fontSize: "26px" } }, c.name),
        h("div", { class: "row", style: { gap: "8px", marginTop: "2px" } },
          h("span", { class: "caption" }, c.person || ""),
          c.channelUrl ? h("a", { href: c.channelUrl, target: "_blank", class: "caption", style: { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--blue)" } },
            "Channel", h("span", { html: Icons.external, style: { width: "12px", display: "inline-flex" } })) : null
        )
      ),
      statusPill(c.status),
      h("span", { class: "tag" }, planLabel(c)),
      h("button", { class: "btn", onclick: function () { clientModal(c); } }, h("span", { html: Icons.edit }), "Edit"),
      refreshBtn
    ));

    /* overview + details */
    var overviewBody;
    if (c.channelSummary) {
      overviewBody = h("div", {},
        h("p", { style: { fontSize: "14px", lineHeight: "1.65" } }, c.channelSummary),
        h("div", { class: "label-text", style: { margin: "14px 0 4px" } }, "What they sell"),
        h("p", { class: "muted", style: { fontSize: "13px", lineHeight: "1.6" } }, c.offers || "Not recorded yet.")
      );
    } else {
      overviewBody = emptyState({
        icon: Icons.sparkle, title: "Analysis has not run yet",
        message: "Run the channel analysis to draft the summary, offers, and strategy.",
        action: h("button", { class: "btn small primary", onclick: function () { refreshBtn.click(); } }, "Run analysis")
      });
    }
    var notes = h("textarea", { class: "textarea", value: c.notes || "" });
    notes.value = c.notes || "";
    page.appendChild(h("div", { class: "grid cols-2", style: { marginBottom: "16px" } },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Overview")),
        overviewBody),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Details")),
        h("div", { class: "hairline-list" },
          detailRow("Monthly fee", fmtMoney(c.monthlyFee) + "/mo"),
          detailRow("Setup fee", h("span", { class: "row", style: { gap: "8px" } }, fmtMoney(c.setupFee), c.setupFeePaid ? statusPill("PAID") : pill("Outstanding", "#FF9F0A"))),
          detailRow("Start date", h("span", { class: "row", style: { gap: "8px" } }, fmtDate(c.startDate), h("span", { class: "tag" }, "day " + daysSince(c.startDate)))),
          detailRow("Discord server", c.discordServer || "Not linked"),
          detailRow("Google account", c.googleAccountEmail || "Not linked")
        ),
        h("div", { class: "label-text", style: { margin: "12px 0 6px" } }, "Notes"),
        notes,
        h("div", { style: { marginTop: "8px" } },
          h("button", { class: "btn small", onclick: function () { c.notes = notes.value; toast("Notes saved"); } }, "Save notes"))
      )
    ));

    /* strategy */
    var strat = h("div", { class: "card", style: { marginBottom: "16px" } });
    strat.appendChild(h("div", { class: "card-head" },
      h("div", {}, h("div", { class: "card-title" }, "Strategy"),
        h("div", { class: "card-sub" }, "One-line changes. Click a line for the full reasoning."))));
    if (c.contentStrategy.length) {
      var list = h("div", { class: "hairline-list" });
      c.contentStrategy.forEach(function (s) {
        var open = false;
        var chev = h("span", { html: Icons.chevronRight, style: { width: "14px", flex: "none", display: "inline-flex", transition: "transform 0.2s", color: "var(--text2)" } });
        var reason = h("div", { class: "muted", style: { fontSize: "13px", lineHeight: "1.6", padding: "0 0 12px 24px", display: "none" } }, s.reasoning);
        var rowEl = h("div", {},
          h("div", {
            class: "row clickable", style: { padding: "12px 4px", gap: "10px" },
            onclick: function () {
              open = !open;
              chev.style.transform = open ? "rotate(90deg)" : "";
              reason.style.display = open ? "block" : "none";
            }
          }, chev, h("span", { style: { fontWeight: "500", fontSize: "14px" } }, s.point)),
          reason
        );
        list.appendChild(rowEl);
      });
      strat.appendChild(list);
    } else {
      strat.appendChild(h("div", { class: "caption" }, "Strategy appears here after the first channel analysis."));
    }
    page.appendChild(strat);

    /* pipeline */
    var pipe = h("div", { class: "card", style: { marginBottom: "16px" } });
    pipe.appendChild(h("div", { class: "card-head" },
      h("div", {}, h("div", { class: "card-title" }, "Production pipeline"))));
    if (!Util.isConnected("discord")) pipe.appendChild(h("div", { style: { marginBottom: "14px" } }, integrationBanner({ integration: "the Discord bot" })));
    var track = h("div", { class: "stage-track" });
    var idx = DB.STAGES.findIndex(function (s) { return s.key === c.stage; });
    DB.STAGES.forEach(function (s, i) {
      track.appendChild(h("div", { class: "stage-step" + (i < idx ? " done" : i === idx ? " current" : "") },
        h("div", { class: "bar" }),
        h("div", { class: "stage-name" }, s.label)));
    });
    pipe.appendChild(track);
    var stageSelect = h("select", { class: "select", style: { width: "auto" }, onchange: function (e) {
      c.stage = e.target.value; c.stageSource = "MANUAL"; c.stageUpdatedAt = "2026-08-05T12:00:00";
      toast("Stage updated"); App.refresh();
    } }, DB.STAGES.map(function (s) {
      return h("option", { value: s.key, selected: s.key === c.stage ? "selected" : null }, s.label);
    }));
    pipe.appendChild(h("div", { class: "row", style: { marginTop: "14px" } },
      h("span", { class: "caption", style: { flex: "1" } },
        (c.stageSource === "AI_DISCORD" ? "Updated automatically from Discord " : "Manual update ") + timeAgo(c.stageUpdatedAt)),
      h("span", { class: "caption" }, "Set manually:"), stageSelect));
    page.appendChild(pipe);

    /* AI tools */
    page.appendChild(h("div", { class: "grid cols-2", style: { marginBottom: "16px" } }, titlesCard(c), ideasCard(c)));

    /* team + payments + performance */
    var teamRows = Util.teamFor(c.id);
    var pays = Util.paymentsFor(c.id).slice().sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; }).slice(0, 8);
    var a = DB.analytics[c.id];
    var latest = a && a.snapshots.length ? a.snapshots[a.snapshots.length - 1] : null;
    page.appendChild(h("div", { class: "grid cols-3" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Team")),
        teamRows.length ? h("div", { class: "hairline-list" },
          teamRows.map(function (t) {
            return h("div", { class: "row", style: { padding: "10px 2px" } },
              avatar(t.name, 30),
              h("div", { style: { flex: "1", minWidth: "0" } },
                h("div", { style: { fontSize: "13px", fontWeight: "500" } }, t.name),
                h("div", { class: "caption" }, Util.roleLabel(t.role))),
              h("span", { class: "mono", style: { fontSize: "13px" } }, fmtMoney(t.cost)));
          }),
          h("div", { class: "row", style: { padding: "10px 2px", fontWeight: "600", fontSize: "13px" } },
            h("span", { style: { flex: "1" } }, "Total"), h("span", { class: "mono" }, fmtMoney(Util.teamCostFor(c.id)) + "/mo"))
        ) : h("div", { class: "caption" }, "No team assigned. Do it in the Team tab.")
      ),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Payments")),
        h("div", { class: "hairline-list" }, pays.map(function (p) {
          return h("div", { class: "row", style: { padding: "9px 2px", fontSize: "13px" } },
            h("span", { class: "tag" }, p.type === "SETUP" ? "Setup" : "Monthly"),
            h("span", { class: "muted", style: { flex: "1" } }, fmtDateShort(p.dueDate)),
            h("span", { class: "mono" }, fmtMoney(p.amount)),
            statusPill(p.status));
        }))
      ),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("div", { class: "card-title" }, "Performance")),
        latest ? h("div", {},
          h("div", { class: "grid cols-2", style: { gap: "10px", marginBottom: "12px" } },
            miniStat("Subscribers", fmtNum(latest.subscribers)),
            miniStat("Views / mo", fmtNum(latest.views)),
            miniStat("CTR", latest.impressionsCTR + "%"),
            miniStat("Watch hours", fmtNum(latest.watchHours))),
          h("div", { class: "caption", style: { marginBottom: "4px" } }, "Views, last 6 months"),
          Charts.spark({ values: a.snapshots.map(function (s) { return s.views; }), color: "#0A84FF", width: 220, height: 44 })
        ) : h("div", { class: "caption" }, "No channel data yet. Connect it in Analytics.")
      )
    ));
  }
  function detailRow(label, value) {
    return h("div", { class: "row", style: { padding: "9px 2px", fontSize: "13px" } },
      h("span", { class: "muted", style: { width: "130px", flex: "none" } }, label),
      typeof value === "string" ? h("span", { style: { fontWeight: "500" } }, value) : value);
  }
  function miniStat(label, value) {
    return h("div", {},
      h("div", { class: "caption" }, label),
      h("div", { style: { fontSize: "18px", fontWeight: "600", letterSpacing: "-0.02em" } }, value));
  }

  window.Pages.clients = {
    css: ".page-clients .stage-track { margin-top: 4px; }",
    render: function (root, param) {
      var page = h("div", { class: "page-clients" });
      if (param) {
        var c = Util.clientById(param);
        if (!c) {
          page.appendChild(emptyState({ title: "Client not found", message: "It may have been deleted.", action: h("button", { class: "btn small", onclick: function () { location.hash = "#/clients"; } }, "Back to clients") }));
        } else {
          detailView(page, c);
        }
      } else {
        listView(page);
      }
      root.appendChild(page);
    }
  };
})();
