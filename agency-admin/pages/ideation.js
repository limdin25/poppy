/* Ideation: strategist chat with thread memory. */
(function () {
  /* module-level state, survives re-renders */
  var activeThreadId = null;
  var panelOpen = true;
  var searchQ = "";
  var replying = false;
  var refs = {};

  function threadById(id) {
    if (!id) return null;
    return DB.ideationThreads.find(function (t) { return t.id === id; }) || null;
  }
  function sortedThreads() {
    return DB.ideationThreads.slice().sort(function (a, b) {
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });
  }
  function stageLabelOf(key) {
    for (var i = 0; i < DB.STAGES.length; i++) if (DB.STAGES[i].key === key) return DB.STAGES[i].label;
    return key;
  }
  function nowTs() { return DB.TODAY + "T12:00:00"; }

  /* client-aware reply: does the text mention a client company or person? */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function mentionedClient(text) {
    for (var i = 0; i < DB.clients.length; i++) {
      var c = DB.clients[i];
      var cands = [c.name];
      if (c.person) {
        cands.push(c.person);
        var toks = c.person.split(/\s+/).filter(function (t) { return t.length >= 3 && t.indexOf(".") === -1; });
        if (toks.length) cands.push(toks[0]);
      }
      for (var j = 0; j < cands.length; j++) {
        if (new RegExp("\\b" + escRe(cands[j]) + "\\b", "i").test(text)) return c;
      }
    }
    return null;
  }
  function buildReply(text) {
    var reply = mockAiReply("ideation", text);
    var c = mentionedClient(text);
    if (c) {
      reply = "Looking at " + c.name + ": " + fmtMoney(c.monthlyFee) + "/mo " + planLabel(c)
        + " client, currently " + stageLabelOf(c.stage).toLowerCase() + ".\n\n" + reply;
    }
    return reply;
  }

  function scrollBottom() {
    if (refs.chatScroll) refs.chatScroll.scrollTop = refs.chatScroll.scrollHeight;
  }
  function repaint() {
    if (!refs.page) return;
    refs.page.innerHTML = "";
    build(refs.page);
    setTimeout(scrollBottom, 0);
  }

  function sendMessage(text) {
    if (replying) return;
    var t = threadById(activeThreadId);
    var created = false;
    if (!t) {
      t = {
        id: "i" + Math.random().toString(36).slice(2, 9),
        title: text.slice(0, 42),
        clientId: null,
        createdAt: nowTs(),
        messages: []
      };
      DB.ideationThreads.unshift(t);
      activeThreadId = t.id;
      created = true;
    }
    t.messages.push({ role: "user", content: text, ts: nowTs() });
    if (created) {
      repaint();
      if (refs.bar) refs.bar.focusInput();
    } else {
      refs.chatInner.appendChild(chatBubble("user", text));
    }
    replying = true;
    var typing = typingBubble();
    refs.chatInner.appendChild(typing);
    scrollBottom();
    setTimeout(function () {
      var replyText = buildReply(text);
      t.messages.push({ role: "assistant", content: replyText, ts: nowTs() });
      replying = false;
      if (!refs.page || !refs.page.isConnected) return;
      typing.remove();
      refs.chatInner.appendChild(chatBubble("assistant", replyText));
      scrollBottom();
    }, 900);
  }

  function trainingNote() {
    return h("div", { class: "muted bar-note" }, "Uses your global video training from Settings");
  }

  function renderThreadListInto() {
    var listEl = refs.threadList;
    if (!listEl) return;
    listEl.innerHTML = "";
    var q = searchQ.trim().toLowerCase();
    var items = sortedThreads().filter(function (t) {
      return !q || t.title.toLowerCase().indexOf(q) !== -1;
    });
    if (!items.length) {
      listEl.appendChild(emptyState({
        icon: Icons.search,
        title: "No threads found",
        message: "No thread title matches your search."
      }));
      return;
    }
    items.forEach(function (t) {
      var c = t.clientId ? Util.clientById(t.clientId) : null;
      listEl.appendChild(h("div", {
        class: "thread-row" + (t.id === activeThreadId ? " active" : ""),
        onclick: function () { activeThreadId = t.id; repaint(); }
      },
        h("div", { class: "t-title" }, t.title),
        h("div", { class: "t-meta" },
          c ? h("span", { class: "tag" }, c.name) : null,
          h("span", {}, timeAgo(t.createdAt))
        )
      ));
    });
  }

  function buildPanel() {
    var panel = h("div", { class: "glass thread-panel" });
    var searchInput = h("input", {
      class: "input", placeholder: "Search threads", value: searchQ,
      oninput: function () { searchQ = searchInput.value; renderThreadListInto(); }
    });
    panel.appendChild(h("div", { class: "search-wrap" }, h("span", { html: Icons.search }), searchInput));
    panel.appendChild(h("button", {
      class: "btn small", style: { width: "100%" },
      onclick: function () { activeThreadId = null; repaint(); if (refs.bar) refs.bar.focusInput(); }
    }, h("span", { html: Icons.plus, style: { display: "flex" } }), "New thread"));
    var listEl = h("div", { class: "thread-list" });
    refs.threadList = listEl;
    panel.appendChild(listEl);
    renderThreadListInto();
    return panel;
  }

  function build(page) {
    var t = threadById(activeThreadId);
    if (!t) activeThreadId = null;

    var chatCol = h("div", { class: "chat-col" });
    var toggleBtn = h("button", {
      class: "btn ghost icon", html: Icons.panel,
      title: panelOpen ? "Hide threads" : "Show threads",
      onclick: function () { panelOpen = !panelOpen; repaint(); }
    });

    if (t) {
      var sel = h("select", { class: "select", style: { width: "190px", flex: "none" } },
        h("option", { value: "" }, "No client"),
        DB.clients.map(function (c) { return h("option", { value: c.id }, c.name); })
      );
      sel.value = t.clientId || "";
      sel.addEventListener("change", function () {
        t.clientId = sel.value || null;
        renderThreadListInto();
      });
      chatCol.appendChild(h("div", { class: "chat-head" },
        h("div", { class: "thread-title" }, t.title),
        sel,
        h("span", { class: "spacer" }),
        toggleBtn
      ));

      var chatScroll = h("div", { class: "chat-scroll" });
      var chatInner = h("div", { class: "chat-inner" });
      t.messages.forEach(function (m) { chatInner.appendChild(chatBubble(m.role, m.content)); });
      chatScroll.appendChild(chatInner);
      chatCol.appendChild(chatScroll);

      var bar = chatInputBar({ placeholder: "Message the strategist...", onSend: sendMessage });
      chatCol.appendChild(h("div", { class: "bar-wrap" }, bar, trainingNote()));
      refs.chatScroll = chatScroll;
      refs.chatInner = chatInner;
      refs.bar = bar;
    } else {
      chatCol.appendChild(h("div", { class: "chat-head" },
        h("div", { class: "thread-title muted" }, "New thread"),
        h("span", { class: "spacer" }),
        toggleBtn
      ));
      var heroBar = chatInputBar({ placeholder: "Describe the client, the video, or the problem...", onSend: sendMessage });
      chatCol.appendChild(h("div", { class: "hero" },
        h("div", { class: "hero-icon", html: Icons.sparkle }),
        h("h1", {}, "What are we making?"),
        h("div", { class: "caption", style: { maxWidth: "400px" } },
          "Ideate titles, hooks, angles and growth strategy. Threads are remembered."),
        h("div", { class: "hero-bar" }, heroBar, trainingNote())
      ));
      refs.chatScroll = null;
      refs.chatInner = null;
      refs.bar = heroBar;
    }
    page.appendChild(chatCol);
    if (panelOpen) page.appendChild(buildPanel());
    else refs.threadList = null;
  }

  window.Pages.ideation = {
    css: ""
      + ".page-ideation { height: calc(100vh - 150px); display: flex; gap: 20px; }"
      + ".page-ideation .chat-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }"
      + ".page-ideation .chat-head { display: flex; align-items: center; gap: 12px; padding: 2px 4px 14px; border-bottom: 0.5px solid var(--border); }"
      + ".page-ideation .chat-head .thread-title { font-size: 16px; font-weight: 600; letter-spacing: -0.02em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }"
      + ".page-ideation .chat-scroll { padding: 22px 8px; }"
      + ".page-ideation .chat-inner { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 780px; margin: 0 auto; }"
      + ".page-ideation .bar-wrap { flex: none; width: 100%; max-width: 780px; margin: 0 auto; padding: 12px 8px 4px; }"
      + ".page-ideation .bar-note { font-size: 12px; text-align: center; margin-top: 8px; }"
      + ".page-ideation .hero { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding-bottom: 6vh; }"
      + ".page-ideation .hero .hero-icon { width: 54px; height: 54px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: var(--glass-strong); border: 0.5px solid var(--border); margin-bottom: 12px; }"
      + ".page-ideation .hero .hero-icon svg { width: 26px; height: 26px; color: var(--purple); }"
      + ".page-ideation .hero .hero-bar { width: 100%; max-width: 640px; margin-top: 24px; }"
      + ".page-ideation .thread-panel { width: 280px; flex: none; display: flex; flex-direction: column; gap: 10px; padding: 14px; }"
      + ".page-ideation .thread-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }"
      + ".page-ideation .thread-row { padding: 9px 10px; border-radius: 10px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; transition: background 0.15s; }"
      + ".page-ideation .thread-row:hover { background: var(--glass); }"
      + ".page-ideation .thread-row.active { background: var(--glass-strong); }"
      + ".page-ideation .thread-row .t-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }"
      + ".page-ideation .thread-row .t-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text2); }"
      + ".page-ideation .thread-panel .empty { padding: 28px 10px; }",
    render: function (root, param) {
      if (param && threadById(param)) activeThreadId = param;
      var page = h("div", { class: "page-ideation" });
      refs.page = page;
      build(page);
      root.appendChild(page);
      setTimeout(scrollBottom, 0);
    }
  };
})();
