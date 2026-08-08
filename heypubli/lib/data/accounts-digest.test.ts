// Hugo, 08 Aug 2026: "every day I want an email summary of all the accounts,
// 7am and 8pm. I want an email summary of all the accounts connected,
// hyperlinked. You need to bake that in."

import { describe, expect, it } from "vitest";
import { buildAccountsDigestHtml, type DigestAccount } from "./accounts-digest";

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
