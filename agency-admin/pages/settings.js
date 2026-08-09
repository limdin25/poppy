/* SETTINGS tab: Integrations, AI Training, Team access. */
(function () {
  var activeTab = "integrations";

  /* ---------- integrations ---------- */
  var MARK_HUES = { claude: 25, higgsfield: 280, youtube: 0, discord: 235, notion: 0 };
  function letterMark(ig) {
    var hue = MARK_HUES[ig.key] !== undefined ? MARK_HUES[ig.key] : 200;
    return h("span", {
      style: {
        width: "36px", height: "36px", borderRadius: "10px", display: "inline-flex", alignItems: "center",
        justifyContent: "center", fontWeight: "700", fontSize: "16px", color: "#fff", flex: "none",
        background: "linear-gradient(135deg, hsl(" + hue + ", 65%, 52%), hsl(" + ((hue + 45) % 360) + ", 65%, 38%))"
      }
    }, ig.name[0]);
  }

  function testConnection(ig, btn, done) {
    var original = btn.textContent;
    btn.disabled = true; btn.textContent = "Testing...";
    setTimeout(function () {
      ig.status = "connected";
      ig.lastTested = "2026-08-05T09:00:00";
      toast(ig.name + " connected");
      if (done) done();
      App.refresh();
    }, 1100);
  }

  function setupGuide(ig) {
    if (!ig._done) ig._done = {};
    var body = h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } });
    body.appendChild(h("div", { class: "row" },
      h("span", { class: "tag" }, "~" + ig.setupMinutes + " min"),
      ig.required ? h("span", { class: "tag", style: { color: "var(--blue)" } }, "Required") : null,
      h("span", { class: "spacer" }),
      statusPill(ig.status)
    ));
    if (ig.key === "claude") body.appendChild(h("div", { class: "banner" },
      h("span", { html: Icons.info }),
      h("span", {}, "Set this up first. It powers ideation, thumbnails, channel analysis, and the Discord agent.")));
    var steps = h("div", { class: "steps" });
    ig.steps.forEach(function (s, i) {
      var stepBody = h("div", { class: "step-body" },
        h("div", { class: "step-title" }, s.title),
        h("div", { class: "step-detail" }, s.detail));
      if (s.code) {
        var code = h("div", { class: "codeblock" }, s.code);
        code.appendChild(h("button", {
          class: "copybtn", html: Icons.copy, title: "Copy",
          onclick: function () { copyText(s.code); }
        }));
        stepBody.appendChild(code);
      }
      steps.appendChild(h("div", { class: "step" }, h("div", { class: "step-num" }, String(i + 1)), stepBody));
    });
    body.appendChild(steps);
    /* completion checklist */
    var check = h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    body.appendChild(h("div", {},
      h("div", { class: "label-text", style: { marginBottom: "8px" } }, "Completion checklist"), check));
    function renderCheck() {
      check.innerHTML = "";
      ig.steps.forEach(function (s, i) {
        var on = !!ig._done[i];
        check.appendChild(h("button", {
          class: "row clickable", style: { border: "none", background: "none", font: "inherit", color: "inherit", padding: "7px 8px", borderRadius: "8px", cursor: "pointer", textAlign: "left", width: "100%" },
          onclick: function () { ig._done[i] = !on; renderCheck(); }
        },
          h("span", {
            html: on ? Icons.check : "",
            style: {
              width: "18px", height: "18px", borderRadius: "6px", flex: "none", display: "inline-flex",
              alignItems: "center", justifyContent: "center",
              border: on ? "none" : "1.5px solid var(--hairline)",
              background: on ? "var(--green)" : "transparent", color: "#fff"
            }
          }),
          h("span", { style: { fontSize: "13px", textDecoration: on ? "line-through" : "none", opacity: on ? 0.6 : 1 } }, s.title)
        ));
      });
    }
    renderCheck();
    var testBtn = h("button", { class: "btn primary", onclick: function () { testConnection(ig, testBtn, function () { so.close(); }); } }, "Test Connection");
    body.appendChild(h("div", { class: "row" }, testBtn));
    var so = openSlideover({ title: ig.name + " setup", subtitle: ig.desc, body: body });
  }

  function integrationCard(ig) {
    var keyInput = h("input", {
      class: "input", type: "password", placeholder: "API key",
      value: ig._key || "",
      oninput: function (e) { ig._key = e.target.value; }
    });
    var testBtn = h("button", { class: "btn small", onclick: function () { testConnection(ig, testBtn); } }, "Test");
    return h("div", { class: "card" },
      h("div", { class: "row", style: { alignItems: "flex-start" } },
        letterMark(ig),
        h("div", { style: { flex: "1", minWidth: "0" } },
          h("div", { style: { fontWeight: "600", fontSize: "15px" } }, ig.name),
          h("div", { class: "caption" }, ig.desc)
        ),
        statusPill(ig.status)
      ),
      h("div", { class: "row", style: { marginTop: "12px" } },
        h("span", { class: "caption" }, ig.lastTested ? "Last tested " + timeAgo(ig.lastTested) : "Never tested"),
        h("span", { class: "tag" }, "~" + ig.setupMinutes + " min setup"),
        ig.required ? h("span", { class: "tag", style: { color: "var(--blue)" } }, "Required") : null
      ),
      h("div", { class: "row", style: { marginTop: "12px" } },
        keyInput,
        h("button", { class: "btn small", onclick: function () { toast("Saved"); } }, "Save")
      ),
      h("div", { class: "row", style: { marginTop: "12px" } },
        h("button", { class: "btn small", onclick: function () { setupGuide(ig); } }, "Setup Guide"),
        testBtn,
        h("span", { class: "spacer" }),
        ig.status === "connected" ? h("button", {
          class: "btn small danger", onclick: function () {
            confirmModal({
              title: "Disconnect " + ig.name + "?",
              message: "Features that depend on it show their setup state until you reconnect. Your key is kept.",
              danger: true, confirmText: "Disconnect",
              onConfirm: function () { ig.status = "not_configured"; toast(ig.name + " disconnected"); App.refresh(); }
            });
          }
        }, "Disconnect") : null
      )
    );
  }

  /* ---------- AI training ---------- */
  function topicBucket(text) {
    var t = text.toLowerCase();
    if (/(word|text)/.test(t)) return "Text rules";
    if (/(face|emotion)/.test(t)) return "Faces and emotion";
    if (/(color|contrast)/.test(t)) return "Color and contrast";
    if (/title/.test(t)) return "Titles";
    if (/(open|intro|hook|second)/.test(t)) return "Hooks and structure";
    if (/series/.test(t)) return "Formats";
    return "General principles";
  }
  function viewKnowledge(scope, label) {
    var entries = DB.knowledge.filter(function (k) { return k.scope === scope; });
    var groups = {};
    entries.forEach(function (k) {
      var b = topicBucket(k.userInput + " " + k.learnedPrinciple);
      (groups[b] = groups[b] || []).push(k);
    });
    var body = h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } });
    if (!entries.length) body.appendChild(emptyState({ title: "No training yet", message: "Paste examples and principles in the training chat and they appear here." }));
    Object.keys(groups).forEach(function (g) {
      body.appendChild(h("div", {},
        h("div", { style: { fontWeight: "600", fontSize: "14px", marginBottom: "6px" } }, g),
        h("ul", { style: { paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "5px" } },
          groups[g].map(function (k) {
            return h("li", { style: { fontSize: "13px", color: "var(--text2)", lineHeight: "1.5" } }, k.learnedPrinciple);
          }))
      ));
    });
    if (entries.length) body.appendChild(h("div", { class: "caption" }, entries.length + " trained principles in this scope."));
    openModal({ title: label + ": current knowledge", wide: true, body: body });
  }
  function trainingCard(scope, title, sub) {
    var card = h("div", { class: "card", style: { display: "flex", flexDirection: "column" } });
    card.appendChild(h("div", { class: "card-head" },
      h("div", {}, h("div", { class: "card-title" }, title), h("div", { class: "card-sub" }, sub))));
    var hist = h("div", { class: "train-hist" });
    function renderHist() {
      hist.innerHTML = "";
      DB.knowledge.filter(function (k) { return k.scope === scope; }).forEach(function (k) {
        hist.appendChild(chatBubble("user", k.userInput));
        hist.appendChild(chatBubble("assistant", "Learned: " + k.learnedPrinciple));
      });
      hist.scrollTop = hist.scrollHeight;
    }
    renderHist();
    card.appendChild(hist);
    var bar = chatInputBar({
      placeholder: "Paste an example, principle, or reference...",
      onSend: function (text) {
        var entry = {
          id: uid(), scope: scope, clientId: null, userInput: text,
          learnedPrinciple: text.length > 110 ? text.slice(0, 107) + "..." : text,
          ts: "2026-08-05T12:00:00"
        };
        hist.appendChild(chatBubble("user", text));
        var typing = typingBubble();
        hist.appendChild(typing);
        hist.scrollTop = hist.scrollHeight;
        setTimeout(function () {
          DB.knowledge.push(entry);
          typing.remove();
          hist.appendChild(chatBubble("assistant", mockAiReply("training", text)));
          hist.scrollTop = hist.scrollHeight;
        }, 700);
      }
    });
    card.appendChild(h("div", { style: { marginTop: "12px" } }, bar));
    card.appendChild(h("div", { class: "row", style: { marginTop: "12px" } },
      h("button", { class: "btn small", onclick: function () { viewKnowledge(scope, title); } }, "View Current Knowledge"),
      h("span", { class: "spacer" }),
      h("button", {
        class: "btn small danger", onclick: function () {
          var n = DB.knowledge.filter(function (k) { return k.scope === scope; }).length;
          confirmModal({
            title: "Reset " + title.toLowerCase() + "?",
            message: "This deletes " + n + " trained principles for this scope. The AI forgets them permanently.",
            danger: true, confirmText: "Reset knowledge",
            onConfirm: function () {
              DB.knowledge = DB.knowledge.filter(function (k) { return k.scope !== scope; });
              toast("Knowledge reset"); App.refresh();
            }
          });
        }
      }, "Reset Knowledge")
    ));
    return card;
  }

  /* ---------- team access ---------- */
  function createLoginModal() {
    var name = h("input", { class: "input", placeholder: "Full name" });
    var email = h("input", { class: "input", type: "email", placeholder: "name@agency.com" });
    var role = h("select", { class: "select" }, ["Manager", "Editor", "Designer", "Viewer"].map(function (r) {
      return h("option", { value: r }, r);
    }));
    var m = openModal({
      title: "Create login",
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } },
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Name"), name),
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Email"), email),
        h("div", { class: "field" }, h("span", { class: "label-text" }, "Role"), role)
      ),
      actions: [
        h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
        h("button", {
          class: "btn primary", onclick: function () {
            if (!name.value.trim() || !email.value.trim()) { toast("Name and email are required", "error"); return; }
            DB.teamLogins.push({ id: uid(), name: name.value.trim(), email: email.value.trim(), role: role.value, lastActive: "2026-08-05T12:00:00" });
            m.close(); toast("Login created. They can sign in from any network."); App.refresh();
          }
        }, "Create login")
      ]
    });
  }
  function teamAccessSection() {
    var wrap = h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } });
    wrap.appendChild(h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("div", { class: "card-title" }, "Team logins"),
          h("div", { class: "card-sub" }, "Team members sign in with these accounts from any network at your app URL.")),
        h("button", { class: "btn primary small", onclick: createLoginModal }, h("span", { html: Icons.plus }), "Create login")
      ),
      h("div", { class: "table-wrap" },
        h("table", { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Member"), h("th", {}, "Email"), h("th", {}, "Role"), h("th", {}, "Last active"), h("th", {}, ""))),
          h("tbody", {}, DB.teamLogins.map(function (u) {
            return h("tr", {},
              h("td", {}, h("div", { class: "row" }, avatar(u.name, 30), h("span", { style: { fontWeight: "500" } }, u.name))),
              h("td", { class: "muted" }, u.email),
              h("td", {}, h("span", { class: "tag" }, u.role)),
              h("td", { class: "muted" }, timeAgo(u.lastActive)),
              h("td", { class: "right" }, u.id === "u1" ? null : h("button", {
                class: "btn ghost icon small", html: Icons.trash,
                onclick: function () {
                  confirmModal({
                    title: "Remove " + u.name + "'s login?",
                    message: "They lose access immediately. Their work and history are kept.",
                    danger: true, confirmText: "Remove",
                    onConfirm: function () {
                      DB.teamLogins = DB.teamLogins.filter(function (x) { return x.id !== u.id; });
                      toast("Login removed"); App.refresh();
                    }
                  });
                }
              }))
            );
          }))
        )
      )
    ));
    var pw = h("input", { class: "input", type: "password", placeholder: "New super admin password" });
    wrap.appendChild(h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("div", { class: "card-title" }, "Super Admin Access"),
          h("div", { class: "card-sub" }, "The login screen shows a Super Admin button. Entering this password grants full owner access."))),
      h("div", { class: "row", style: { maxWidth: "440px" } },
        pw,
        h("button", {
          class: "btn", onclick: function () {
            if (!pw.value) { toast("Enter a password first", "error"); return; }
            DB.settings._superPw = pw.value; pw.value = "";
            toast("Super admin password updated");
          }
        }, "Update password")
      ),
      h("div", { class: "caption", style: { marginTop: "10px", display: "flex", alignItems: "center", gap: "6px" } },
        h("span", { html: Icons.warning, style: { width: "14px", display: "inline-flex", color: "var(--orange)" } }),
        "Never share this password. It bypasses per-member permissions.")
    ));
    return wrap;
  }

  /* ---------- page ---------- */
  window.Pages.settings = {
    css: [
      ".page-settings .train-hist { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto; padding: 6px 2px; }",
      ".page-settings .train-hist .bubble { max-width: 92%; font-size: 13px; }",
      ".page-settings .card { min-width: 0; }"
    ].join("\n"),
    render: function (root) {
      var page = h("div", { class: "page-settings" });
      var tabs = h("div", { class: "tabs" });
      [["integrations", "Integrations"], ["training", "AI Training"], ["access", "Team access"]].forEach(function (t) {
        tabs.appendChild(h("button", {
          class: activeTab === t[0] ? "active" : "",
          onclick: function () { activeTab = t[0]; App.refresh(); }
        }, t[1]));
      });
      page.appendChild(tabs);

      if (activeTab === "integrations") {
        page.appendChild(h("p", { class: "caption", style: { margin: "0 0 16px", maxWidth: "680px" } },
          "Keys are stored as app secrets and stay populated when you navigate away. Connect Claude first, everything AI-powered depends on it."));
        page.appendChild(h("div", { class: "grid cols-2" }, DB.integrations.map(integrationCard)));
      } else if (activeTab === "training") {
        page.appendChild(h("p", { class: "caption", style: { margin: "0 0 16px", maxWidth: "680px" } },
          "Teach the AI what good looks like. Every exchange is stored as a knowledge entry and prepended to every future AI call in its scope. It compounds: more training makes every feature smarter."));
        page.appendChild(h("div", { class: "grid cols-2" },
          trainingCard("THUMBNAIL_GLOBAL", "Thumbnail Training", "Feeds every thumbnail generation"),
          trainingCard("VIDEO_GLOBAL", "Video & Ideation Training", "Feeds ideation, titles, and channel analysis")
        ));
        page.appendChild(h("p", { class: "caption", style: { marginTop: "14px" } },
          "Very large pastes are fine. Entries store the full text."));
      } else {
        page.appendChild(teamAccessSection());
      }
      root.appendChild(page);
    }
  };
})();
