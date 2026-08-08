// Hugo, 08 Aug 2026: "every day I want an email summary of all the accounts,
// 7am and 8pm. I want an email summary of all the accounts connected,
// hyperlinked. You need to bake that in."

import { describe, expect, it } from "vitest";
import {
  buildAccountsDigestHtml,
  type DigestAccount,
  type NewlyOnboarded,
} from "./accounts-digest";

const accounts: DigestAccount[] = [
  {
    igUsername: "kaorimodel04",
    firstName: "Bhupender",
    connectedAt: "2026-08-01T09:15:00.000Z",
    isConnected: true,
    enrolled: true,
    nextSeq: 3,
    postsPublished: 2,
  },
  {
    igUsername: "dealhunterpk786",
    firstName: "",
    connectedAt: "2026-08-08T02:13:41.000Z",
    isConnected: true,
    enrolled: true,
    nextSeq: 1,
    postsPublished: 0,
  },
  {
    igUsername: null,
    firstName: "No Handle",
    connectedAt: "2026-08-07T10:00:00.000Z",
    isConnected: false,
    enrolled: false,
    nextSeq: 1,
    postsPublished: 0,
  },
];

describe("accounts digest email", () => {
  it("links every handle to its Instagram profile", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T07:00:00Z"));
    expect(html).toContain('href="https://instagram.com/kaorimodel04"');
    expect(html).toContain('href="https://instagram.com/dealhunterpk786"');
    expect(html).toContain("@kaorimodel04");
  });

  it("never writes a link for an account with no handle", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T07:00:00Z"));
    expect(html).not.toContain("instagram.com/null");
    expect(html).not.toContain("instagram.com/\"");
  });

  it("counts connected and disconnected separately", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T07:00:00Z"));
    expect(html).toContain("2 connected");
    expect(html).toContain("1 disconnected");
  });

  it("shows when each account joined and what it has posted", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T07:00:00Z"));
    expect(html).toContain("1 Aug 2026");
    expect(html).toContain("8 Aug 2026");
  });

  it("flags the ones that joined in the last day, which is the news", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T07:00:00Z"));
    expect(html).toContain("NEW");
  });

  it("survives an empty roster rather than sending a broken email", () => {
    const html = buildAccountsDigestHtml([], new Date("2026-08-08T07:00:00Z"));
    expect(html).toContain("0 connected");
    expect(html.length).toBeGreaterThan(50);
  });

  it("escapes a handle that would otherwise break out of the href", () => {
    const nasty: DigestAccount[] = [
      {
        igUsername: 'evil" onmouseover="alert(1)',
        firstName: "",
        connectedAt: "2026-08-08T02:00:00.000Z",
        isConnected: true,
        enrolled: true,
        nextSeq: 1,
        postsPublished: 0,
      },
    ];
    const html = buildAccountsDigestHtml(nasty, new Date("2026-08-08T07:00:00Z"));
    // The letters may survive as inert text; what must never survive is the
    // quote that would close the href, or a live event attribute.
    expect(html).not.toContain('onmouseover="');
    expect(html).not.toContain('"https://instagram.com/evil"');
    expect(html).toContain('href="https://instagram.com/evilonmouseoveralert1"');
  });
});

// Hugo, 08 Aug 2026: "the report is not telling me how many new have fully
// onboarded, we need to know that as well." A running total answers "how are
// we doing"; only this answers "did anything happen in the last hour".
describe("what changed since the last report", () => {
  const fresh: NewlyOnboarded[] = [
    { firstName: "Hasnain", igUsername: "hasnainmalik9363", at: "2026-08-08T12:31:32.000Z" },
  ];

  it("names the creators who finished since the last email", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T13:00:00Z"), fresh);
    expect(html).toContain("1 fully onboarded since the last report");
    expect(html).toContain("Hasnain");
  });

  it("says so plainly when nobody finished, rather than leaving a gap", () => {
    const html = buildAccountsDigestHtml(accounts, new Date("2026-08-08T13:00:00Z"), []);
    expect(html).toContain("Nobody new finished all five steps");
  });
});
