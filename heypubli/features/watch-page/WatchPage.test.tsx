import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WatchPage } from "./WatchPage";
import { watchCopy, WA_HREF, WA_MESSAGE } from "./copy";

// jsdom has no sendBeacon and no real video pipeline; the tracker must degrade
// to silence, never to a crash.
vi.stubGlobal("crypto", globalThis.crypto);

function view() {
  return render(
    <WatchPage
      calculator={<div data-testid="slot-calculator">calc</div>}
      demos={<div data-testid="slot-demos">demos</div>}
    />,
  );
}

describe("WatchPage", () => {
  it("puts the video first, before everything else", () => {
    view();
    const video = screen.getByTestId("watch-video");
    const calculator = screen.getByTestId("slot-calculator");
    expect(
      video.compareDocumentPosition(calculator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the calculator and demo slots the page passes in", () => {
    view();
    expect(screen.getByTestId("slot-calculator")).toBeInTheDocument();
    expect(screen.getByTestId("slot-demos")).toBeInTheDocument();
  });

  // Hugo's shape: button after the calculator AND again at the bottom.
  it("offers the WhatsApp button twice, above the demos and after them", () => {
    view();
    expect(screen.getByTestId("watch-cta-top")).toBeInTheDocument();
    expect(screen.getByTestId("watch-cta-bottom")).toBeInTheDocument();
  });

  it("sends both buttons to WhatsApp with the message already written", () => {
    view();
    for (const id of ["watch-cta-top", "watch-cta-bottom"]) {
      const a = screen.getByTestId(id);
      expect(a).toHaveAttribute("href", WA_HREF);
      expect(WA_HREF).toContain("wa.me/447460035763");
      expect(decodeURIComponent(WA_HREF)).toContain(WA_MESSAGE);
    }
  });

  // The page is public and pre-revenue: it must not promise money.
  it("never promises earnings in its own words", () => {
    const words = JSON.stringify(watchCopy).toLowerCase();
    expect(words).not.toContain("guarantee");
    expect(words).not.toContain("passive income");
    expect(words).not.toContain("earning while you sleep");
  });

  it("uses no punctuation Hugo banned, anywhere in the copy", () => {
    const all = JSON.stringify(watchCopy);
    for (const code of [0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026]) {
      expect(all).not.toContain(String.fromCharCode(code));
    }
  });
});
