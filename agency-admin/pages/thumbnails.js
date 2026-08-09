/* Thumbnails: conversational thumbnail studio with inline image generation. */

(function () {
  /* module state, survives re-renders */
  var activeSessionId = null;
  var panelOpen = true;
  var searchQ = "";
  var selectedClientId = null;
  var genSeed = 3; /* seeds 0-2 are used by the seeded demo sessions */
  var currentPage = null;
  var chatScrollEl = null;

  function getActive() {
    return DB.thumbSessions.find(function (s) { return s.id === activeSessionId; }) || null;
  }
  function refresh() {
    if (currentPage && currentPage.isConnected) build(currentPage);
    else App.refresh();
  }
  function scrollBottom() {
    if (chatScrollEl) chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
  }
  function stamp() { return new Date().toISOString(); }

  function slugOf(text) {
    var words = String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3);
    return words.length ? words.join("-") : "concept";
  }
  function slugForMsg(msg, session) {
    var idx = session.messages.indexOf(msg);
    for (var i = idx - 1; i >= 0; i--) {
      if (session.messages[i].role === "user") return slugOf(session.messages[i].content);
    }
    if (msg.imageUrl && msg.imageUrl.indexOf("GEN:") === 0) return msg.imageUrl.split(":")[1] || "concept";
    return slugOf(session.title);
  }
  function titleFrom(text) {
    var t = text.trim().split(/\s+/).slice(0, 6).join(" ");
    if (t.length > 48) t = t.slice(0, 45) + "...";
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function downloadImage(msg) {
    var href = thumbSrc(msg.imageUrl);
    if (!href) return;
    var name = href.indexOf("data:image/png") === 0 ? "thumbnail.png" : "thumbnail.svg";
    var a = h("a", { href: href, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    toast("Downloading " + name);
  }

  /* render one assistant message (content, image, actions) into its container */
  function renderAssistantInto(container, msg, session) {
    container.innerHTML = "";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.alignItems = "flex-start";
    var b = h("div", { class: "bubble assistant" }, msg.content);
    container.appendChild(b);
    if (!msg.imageUrl) return b;

    var img = h("img", { class: "bubble-img", src: thumbSrc(msg.imageUrl), alt: "Generated thumbnail" });
    b.appendChild(img);

    var row = h("div", { class: "tb-actions" },
      h("button", { class: "btn small", onclick: regenerate }, "Regenerate"),
      h("button", { class: "btn small", onclick: variations }, "3 variations"),
      h("button", { class: "btn small icon", html: Icons.download, title: "Download", onclick: function () { downloadImage(msg); } }),
      starRating(msg.rating || 0, function (v) {
        msg.rating = v;
        toast("Rating saved: " + v + " of 5");
        renderAssistantInto(container, msg, session);
      }),
      h("button", { class: "btn small", onclick: function () { openTextEditor(msg, container, session); } }, "Add text")
    );
    b.appendChild(row);

    function regenerate() {
      var sh = h("div", { class: "shimmer tb-shimmer" });
      b.replaceChild(sh, img);
      setTimeout(function () {
        msg.imageUrl = "GEN:" + slugForMsg(msg, session) + ":" + (genSeed++);
        renderAssistantInto(container, msg, session);
      }, 900);
    }

    function variations() {
      var slug = slugForMsg(msg, session);
      var wrap = h("div", { class: "tb-variants" });
      var delays = [600, 900, 1200];
      for (var i = 0; i < 3; i++) (function (i) {
        var cell = h("div", { class: "shimmer", style: { flex: "none", width: "180px", aspectRatio: "16 / 9", borderRadius: "10px" } });
        wrap.appendChild(cell);
        var ref = "GEN:" + slug + ":" + (genSeed++);
        setTimeout(function () {
          var vbtn = h("button", {
            class: "tb-variant", title: "Use this variation",
            onclick: function () {
              msg.imageUrl = ref;
              toast("Variation promoted");
              renderAssistantInto(container, msg, session);
            }
          }, h("img", { src: thumbSrc(ref), alt: "Variation " + (i + 1) }));
          if (cell.parentNode === wrap) wrap.replaceChild(vbtn, cell);
        }, delays[i]);
      })(i);
      b.appendChild(wrap);
      scrollBottom();
    }
    return b;
  }

  /* canvas text editor modal */
  function openTextEditor(msg, container, session) {
    var state = { text: "THREE WORDS", size: 120, color: "#FFFFFF", x: 640, y: 400, drag: false };
    var canvas = h("canvas", {
      width: "1280", height: "720",
      style: { width: "100%", display: "block", borderRadius: "12px", border: "0.5px solid var(--border)", cursor: "move" }
    });
    var ctx = canvas.getContext("2d");
    var base = new Image();
    base.onload = function () { draw(); };
    base.src = thumbSrc(msg.imageUrl);

    function draw() {
      ctx.clearRect(0, 0, 1280, 720);
      if (base.complete && base.naturalWidth) ctx.drawImage(base, 0, 0, 1280, 720);
      ctx.save();
      ctx.font = "800 " + state.size + "px -apple-system, Helvetica";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = state.color;
      ctx.fillText(state.text, state.x, state.y);
      ctx.restore();
    }
    function toCanvas(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (1280 / r.width), y: (e.clientY - r.top) * (720 / r.height) };
    }
    canvas.addEventListener("mousedown", function (e) { state.drag = true; var p = toCanvas(e); state.x = p.x; state.y = p.y; draw(); });
    canvas.addEventListener("mousemove", function (e) { if (!state.drag) return; var p = toCanvas(e); state.x = p.x; state.y = p.y; draw(); });
    canvas.addEventListener("mouseup", function () { state.drag = false; });
    canvas.addEventListener("mouseleave", function () { state.drag = false; });

    var textInput = h("input", {
      class: "input", value: state.text, placeholder: "Thumbnail text",
      oninput: function () { state.text = this.value; draw(); }
    });
    var slider = h("input", {
      type: "range", min: "60", max: "200", value: String(state.size), style: { width: "100%" },
      oninput: function () { state.size = parseInt(this.value, 10) || 120; draw(); }
    });
    var swatchColors = ["#FFFFFF", "#000000", "#FF453A", "#FF9F0A", "#0A84FF"];
    var swWrap = h("div", { style: { display: "flex", gap: "8px", alignItems: "center", height: "38px" } });
    swatchColors.forEach(function (col) {
      var s = h("button", {
        title: col,
        style: {
          width: "26px", height: "26px", borderRadius: "50%", background: col, cursor: "pointer", padding: "0",
          border: col === state.color ? "2px solid var(--blue)" : "0.5px solid var(--hairline)"
        },
        onclick: function () {
          state.color = col; draw();
          swWrap.querySelectorAll("button").forEach(function (b2) { b2.style.border = "0.5px solid var(--hairline)"; });
          s.style.border = "2px solid var(--blue)";
        }
      });
      swWrap.appendChild(s);
    });

    var controls = h("div", { style: { display: "grid", gridTemplateColumns: "1fr 170px auto", gap: "14px", alignItems: "end" } },
      h("div", { class: "field" }, h("span", { class: "label-text" }, "Text"), textInput),
      h("div", { class: "field" }, h("span", { class: "label-text" }, "Size"), slider),
      h("div", { class: "field" }, h("span", { class: "label-text" }, "Color"), swWrap)
    );

    var m = openModal({
      title: "Add text",
      wide: true,
      body: h("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } },
        canvas,
        h("div", { class: "caption" }, "Drag anywhere on the frame to place the text."),
        controls
      ),
      actions: [
        h("button", { class: "btn", onclick: function () { m.close(); } }, "Cancel"),
        h("button", {
          class: "btn primary",
          onclick: function () {
            msg.imageUrl = canvas.toDataURL("image/png");
            m.close();
            toast("Text saved onto the thumbnail");
            renderAssistantInto(container, msg, session);
          }
        }, "Save")
      ]
    });
  }

  /* one message node for the history render */
  function messageNode(msg, session) {
    if (msg.role === "user") return chatBubble("user", msg.content);
    var container = h("div", {});
    renderAssistantInto(container, msg, session);
    return container;
  }

  /* send flow */
  function onSend(text) {
    var session = getActive();
    if (!session) {
      session = { id: uid(), clientId: selectedClientId, title: titleFrom(text), createdAt: stamp(), messages: [] };
      DB.thumbSessions.unshift(session);
      activeSessionId = session.id;
    }
    session.messages.push({ role: "user", content: text, imageUrl: null, rating: null, ts: stamp() });
    refresh();
    var scroll = chatScrollEl;
    var typing = typingBubble();
    scroll.appendChild(typing);
    scrollBottom();

    var isMod = /^(make|try|now|darker|lighter|add|remove|without)\b/i.test(text.trim());
    var content = (isMod ? "Building on the last frame: " : "") + mockAiReply("thumbnail", text);
    var connected = Util.isConnected("higgsfield");

    setTimeout(function () {
      typing.remove();
      var msg = { role: "assistant", content: content, imageUrl: null, rating: null, ts: stamp() };
      session.messages.push(msg);
      var container = h("div", {});
      scroll.appendChild(container);
      var bubbleEl = renderAssistantInto(container, msg, session);

      if (!connected) {
        container.appendChild(h("div", { class: "card", style: { width: "min(480px, 100%)", marginTop: "10px", padding: "0" } },
          apiGate({
            integration: "Higgsfield",
            title: "Image generation needs Higgsfield",
            message: "The art direction above still works. Connect Higgsfield in Settings and frames render right here in the chat."
          })
        ));
        scrollBottom();
        return;
      }

      var sh = h("div", { class: "shimmer tb-shimmer" });
      bubbleEl.appendChild(sh);
      scrollBottom();
      setTimeout(function () {
        msg.imageUrl = "GEN:" + slugOf(text) + ":" + (genSeed++);
        if (container.isConnected) {
          renderAssistantInto(container, msg, session);
          scrollBottom();
        } else if (activeSessionId === session.id) {
          refresh();
        }
      }, 1800);
    }, 700);
  }

  /* right session panel */
  function buildPanel() {
    var panel = h("div", { class: "card tb-panel" });
    var listWrap = h("div", { class: "tb-sessions" });
    var searchInput = h("input", {
      class: "input", placeholder: "Search sessions", value: searchQ,
      oninput: function () { searchQ = this.value; renderList(); }
    });
    panel.appendChild(h("div", { class: "search-wrap" }, h("span", { html: Icons.search }), searchInput));
    panel.appendChild(h("button", {
      class: "btn small",
      style: { justifyContent: "center" },
      onclick: function () { activeSessionId = null; refresh(); }
    }, h("span", { html: Icons.plus, style: { display: "flex" } }), "New session"));
    panel.appendChild(listWrap);

    function renderList() {
      listWrap.innerHTML = "";
      var q = searchQ.trim().toLowerCase();
      var filtered = DB.thumbSessions.filter(function (s) {
        return !q || s.title.toLowerCase().indexOf(q) !== -1;
      });
      if (!filtered.length) {
        listWrap.appendChild(emptyState({
          icon: Icons.search,
          title: "No sessions found",
          message: q ? 'Nothing matches "' + searchQ.trim() + '". Try a different search.' : "Start a new session to see it here."
        }));
        return;
      }
      var groups = [];
      DB.clients.forEach(function (c) {
        var list = filtered.filter(function (s) { return s.clientId === c.id; });
        if (list.length) groups.push({ name: c.name, list: list });
      });
      var orphan = filtered.filter(function (s) { return !Util.clientById(s.clientId); });
      if (orphan.length) groups.push({ name: "Unassigned", list: orphan });

      groups.forEach(function (g) {
        listWrap.appendChild(h("div", { class: "tb-group-label" }, g.name));
        g.list.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).forEach(function (s) {
          listWrap.appendChild(h("button", {
            class: "tb-session" + (s.id === activeSessionId ? " active" : ""),
            onclick: function () {
              activeSessionId = s.id;
              var c = Util.clientById(s.clientId);
              if (c && c.status === "ACTIVE") selectedClientId = c.id;
              refresh();
            }
          },
            h("div", { class: "t ellipsis" }, s.title),
            h("div", { class: "m" }, timeAgo(s.createdAt))
          ));
        });
      });
    }
    renderList();
    return panel;
  }

  /* full page build */
  function build(page) {
    page.innerHTML = "";
    var session = getActive();
    var client = session ? Util.clientById(session.clientId) : null;

    var main = h("div", { class: "card tb-main" });

    var select = h("select", {
      class: "select tb-client-select",
      title: "New sessions are tagged to this client",
      onchange: function () { selectedClientId = this.value; }
    });
    Util.activeClients().forEach(function (c) {
      select.appendChild(h("option", { value: c.id, selected: c.id === selectedClientId }, c.name));
    });

    main.appendChild(h("div", { class: "tb-head" },
      h("div", { style: { minWidth: "0" } },
        h("h3", { class: "ellipsis" }, session ? session.title : "New session"),
        h("div", { class: "caption ellipsis" }, session ? (client ? client.name : "Unassigned") : "Describe a concept to start")
      ),
      h("span", { class: "spacer" }),
      select,
      h("button", {
        class: "btn ghost icon", html: Icons.panel,
        title: panelOpen ? "Hide sessions" : "Show sessions",
        onclick: function () { panelOpen = !panelOpen; refresh(); }
      })
    ));

    var scroll = h("div", { class: "chat-scroll" });
    chatScrollEl = scroll;
    if (session && session.messages.length) {
      session.messages.forEach(function (m) { scroll.appendChild(messageNode(m, session)); });
    } else {
      scroll.appendChild(emptyState({
        icon: Icons.sparkle,
        title: "Describe the thumbnail you want",
        message: "Give the concept, the emotion and the text. The studio drafts an art direction, then renders a 16:9 frame you can rate, regenerate and caption. Trained rules apply: one face, three words, readable at 120px."
      }));
    }
    main.appendChild(scroll);
    main.appendChild(chatInputBar({ placeholder: "Describe a thumbnail concept...", onSend: onSend }));

    page.appendChild(main);
    if (panelOpen) page.appendChild(buildPanel());
    setTimeout(scrollBottom, 0);
  }

  window.Pages.thumbnails = {
    css: [
      ".page-thumbnails { height: calc(100vh - 150px); display: flex; gap: 16px; }",
      ".page-thumbnails .tb-main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 18px 20px; }",
      ".page-thumbnails .tb-head { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 0.5px solid var(--border); }",
      ".page-thumbnails .tb-client-select { width: auto; max-width: 220px; font-size: 13px; padding: 6px 30px 6px 10px; }",
      ".page-thumbnails .chat-scroll { min-height: 0; }",
      ".page-thumbnails .chat-scroll .empty { margin: auto; }",
      ".page-thumbnails .chat-bar { margin-top: 14px; flex: none; }",
      ".page-thumbnails .bubble .bubble-img { margin-top: 10px; }",
      ".page-thumbnails .tb-shimmer { aspect-ratio: 16 / 9; width: min(420px, 100%); margin-top: 10px; }",
      ".page-thumbnails .tb-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }",
      ".page-thumbnails .tb-variants { display: flex; gap: 10px; overflow-x: auto; margin-top: 10px; padding-bottom: 4px; }",
      ".page-thumbnails .tb-variant { flex: none; width: 180px; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; cursor: pointer; border: 0.5px solid var(--border); padding: 0; background: none; transition: transform 0.15s ease, border-color 0.15s; }",
      ".page-thumbnails .tb-variant img { width: 100%; height: 100%; object-fit: cover; display: block; }",
      ".page-thumbnails .tb-variant:hover { transform: translateY(-2px); border-color: var(--blue); }",
      ".page-thumbnails .tb-panel { width: 280px; flex: none; display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow: hidden; }",
      ".page-thumbnails .tb-sessions { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }",
      ".page-thumbnails .tb-sessions .empty { padding: 28px 12px; }",
      ".page-thumbnails .tb-group-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text2); padding: 12px 8px 6px; }",
      ".page-thumbnails .tb-group-label:first-child { padding-top: 2px; }",
      ".page-thumbnails .tb-session { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; border: none; background: none; font-family: inherit; color: var(--text); padding: 8px 10px; border-radius: 10px; cursor: pointer; transition: background 0.15s; }",
      ".page-thumbnails .tb-session:hover { background: var(--glass); }",
      ".page-thumbnails .tb-session.active { background: var(--glass-strong); }",
      ".page-thumbnails .tb-session .t { font-size: 13px; font-weight: 500; max-width: 100%; }",
      ".page-thumbnails .tb-session .m { font-size: 11px; color: var(--text2); }"
    ].join("\n"),
    render: function (root) {
      if (!selectedClientId || !Util.clientById(selectedClientId) || Util.clientById(selectedClientId).status !== "ACTIVE") {
        var act = Util.activeClients();
        selectedClientId = act.length ? act[0].id : null;
      }
      var page = h("div", { class: "page-thumbnails" });
      root.appendChild(page);
      currentPage = page;
      build(page);
    }
  };
})();
