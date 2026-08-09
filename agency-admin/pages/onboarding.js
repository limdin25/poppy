/* ONBOARDING tab: written guide + downloadable client agreement. */
(function () {
  var AGREEMENT = [
    "CONTENT TEAM SERVICES AGREEMENT",
    "",
    "This Services Agreement (the \"Agreement\") is entered into as of ____________ (the \"Effective Date\")",
    "between:",
    "",
    "  AGENCY:  ____________________________ (\"Agency\")",
    "  CLIENT:  ____________________________ (\"Client\")",
    "",
    "1. SERVICES",
    "The Agency will build and operate an in-house content team for the Client, including some or all of:",
    "channel management, long-form editing, short-form editing, thumbnail design, content strategy and",
    "ideation, publishing, and performance reporting, as set out in the selected plan.",
    "",
    "2. FEES",
    "2.1 Setup fee: USD 30,000 (or the amount agreed in writing), invoiced on signing and payable before",
    "    the kickoff. The setup fee covers team recruitment, systems setup, and the initial channel audit.",
    "2.2 Monthly retainer: the amount agreed for the selected plan, invoiced monthly in advance on the",
    "    monthly anniversary of the Effective Date.",
    "2.3 Late payments accrue interest at 1.5 percent per month. Work pauses on invoices 14 days overdue.",
    "",
    "3. 30-DAY GUARANTEE",
    "If the Client's channel does not record an increase in total views during the first 30 days from the",
    "Effective Date, compared with the 30 days immediately before it, the Agency will refund all fees paid",
    "under this Agreement in full. The Client must have provided the access and filming availability",
    "described in clause 4 for the guarantee to apply.",
    "",
    "4. CLIENT OBLIGATIONS",
    "The Client will provide: manager access to the YouTube channel, membership of the shared Discord",
    "server, raw footage or filming availability as scheduled, and feedback on cuts within 72 hours.",
    "",
    "5. CONTENT OWNERSHIP",
    "All finished content, project files, and thumbnails produced under this Agreement are the property of",
    "the Client on payment of the fees relating to them. The Agency may reference the work and results in",
    "its own marketing unless the Client opts out in writing.",
    "",
    "6. CONFIDENTIALITY",
    "Each party will keep the other's non-public business information confidential and use it only to",
    "perform this Agreement.",
    "",
    "7. TERM AND TERMINATION",
    "This Agreement runs month to month after the first 30 days. Either party may terminate with 30 days'",
    "written notice. Fees for work already performed remain payable. Clauses 5 and 6 survive termination.",
    "",
    "8. LIABILITY",
    "Neither party is liable for indirect or consequential loss. The Agency's total liability is capped at",
    "the fees paid in the 3 months before the claim.",
    "",
    "SIGNED",
    "",
    "  For the Agency:  ____________________   Date: ____________",
    "  For the Client:  ____________________   Date: ____________",
    ""
  ].join("\n");

  function stepEl(num, title, detail) {
    return h("div", { class: "step" },
      h("div", { class: "step-num" }, String(num)),
      h("div", { class: "step-body" },
        h("div", { class: "step-title" }, title),
        h("div", { class: "step-detail" }, detail)
      )
    );
  }

  function guideCard(title, sub, steps) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("div", { class: "card-title" }, title), h("div", { class: "card-sub" }, sub))),
      h("div", { class: "steps" }, steps)
    );
  }

  window.Pages.onboarding = {
    css: ".page-onboarding .card { margin-bottom: 16px; } .page-onboarding .agreement-row { display: flex; align-items: center; gap: 16px; }",
    render: function (root) {
      var page = h("div", { class: "page-onboarding" });

      page.appendChild(h("div", { class: "card" },
        h("h2", {}, "How we onboard a new client"),
        h("p", { class: "muted", style: { marginTop: "8px", fontSize: "14px", lineHeight: "1.6", maxWidth: "720px" } },
          "The same playbook every time: from signed agreement to first published video in 14 days. This is the general process, not a per-client checklist. Track each client's actual progress on their client page.")
      ));

      page.appendChild(guideCard("Week 0: Close and collect", "Nothing starts until the paperwork and money are in.", [
        stepEl(1, "Get the agreement signed", "Send the client agreement below and get it signed before anything else. No access requests, no team intros, no strategy calls before signature."),
        stepEl(2, "Invoice and collect the setup fee", "Invoice the $30,000 setup fee (or the agreed plan amount) on signing and collect it before kickoff. The setup fee funds recruitment and the channel audit."),
        stepEl(3, "Create the client record", "Add them in the Clients tab and paste their channel URL. The AI analysis runs on creation and drafts the channel summary, offers, and strategy bullets you will present at kickoff.")
      ]));

      page.appendChild(guideCard("Week 1: Access and team", "Wire up the systems and the people.", [
        stepEl(4, "Collect channel access", "Have the client add our manager Google account to their YouTube channel with Manager permissions. Never ask for or accept their password."),
        stepEl(5, "Create the client's Discord server", "Name the server EXACTLY the client name as it appears in the Clients tab. The status agent matches servers to clients by name and updates the pipeline automatically every 30 minutes."),
        stepEl(6, "Assign the team", "In the Team tab, assign a channel manager, long-form editor, short-form editor, and thumbnail designer. Check the Capacity table first so nobody goes over 3 clients."),
        stepEl(7, "Book the first filming day", "Get the first filming date in the calendar inside week 1. Everything downstream slips if filming slips.")
      ]));

      page.appendChild(guideCard("Week 2: First cycle and the guarantee", "Ship, measure, compare.", [
        stepEl(8, "Run the first production cycle", "Move the client through the pipeline stages on their client page: footage, edit, thumbnail, review, publish. The first cycle sets the pace for every cycle after it."),
        stepEl(9, "Watch the 30-day guarantee clock", "The guarantee clock starts on the client's start date: views must increase in the first 30 days or we refund in full. The Dashboard tracks each client's day count and flags anyone approaching day 30."),
        stepEl(10, "Review week-2 numbers", "Compare early numbers against the strategy bullets on the client page. If a bullet is not moving its metric, change the plan now, not at day 29.")
      ]));

      page.appendChild(h("div", { class: "card" },
        h("div", { class: "agreement-row" },
          h("div", { class: "gate-icon", html: Icons.doc, style: { flex: "none" } }),
          h("div", { style: { flex: "1" } },
            h("div", { class: "card-title" }, "Client agreement"),
            h("div", { class: "card-sub" }, "Must be signed before onboarding. Standard terms: setup fee, monthly retainer, 30-day views guarantee, 30-day notice.")
          ),
          h("button", {
            class: "btn primary",
            onclick: function () { download("client-agreement.txt", AGREEMENT); toast("Agreement downloaded"); }
          }, h("span", { html: Icons.download }), "Download agreement")
        )
      ));

      root.appendChild(page);
    }
  };
})();
