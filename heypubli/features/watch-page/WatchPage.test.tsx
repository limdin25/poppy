import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WatchPage } from "./WatchPage";
import { WatchEarnings } from "./WatchEarnings";
import { watchCopy, WA_HREF, WA_MESSAGE } from "./copy";

describe("WatchPage", () => {
  it("puts the video first, before the earnings", () => {
    render(<WatchPage />);
    const video = screen.getByTestId("watch-video");
    const earnings = screen.getByTestId("watch-earnings");
    expect(
      video.compareDocumentPosition(earnings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Hugo's second pass: ONE earnings block, months not followers.
  it("estimates by month with no follower question anywhere", () => {
    render(<WatchPage />);
    expect(screen.getByTestId("earnings-month")).toBeInTheDocument();
    const words = JSON.stringify(watchCopy).toLowerCase();
    expect(words).not.toContain("follower count");
    expect(words).toContain("snowball");
  });

  it("offers the WhatsApp button twice, each carrying the icon and the pre-written message", () => {
    render(<WatchPage />);
    for (const id of ["watch-cta-top", "watch-cta-bottom"]) {
      const a = screen.getByTestId(id);
      expect(a).toHaveAttribute("href", WA_HREF);
    }
    expect(WA_HREF).toContain("wa.me/447460035763");
    expect(decodeURIComponent(WA_HREF)).toContain(WA_MESSAGE);
    expect(screen.getAllByTestId("wa-icon")).toHaveLength(2);
  });

  // Hugo's mobile behaviour: one big player, thumbnails stay put underneath.
  it("shows the big demo player with four thumbnails under it", () => {
    render(<WatchPage />);
    expect(screen.getByTestId("demo-main-poster")).toBeInTheDocument();
    for (const i of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`demo-thumb-${i}`)).toBeInTheDocument();
    }
  });

  it("promotes a tapped thumbnail into the big player", () => {
    render(<WatchPage />);
    fireEvent.click(screen.getByTestId("demo-thumb-3"));
    expect(screen.getByTestId("demo-main")).toBeInTheDocument();
    expect(screen.getByTestId("demo-main").querySelector("source")?.src).toContain(
      "d3.mp4",
    );
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

describe("WatchEarnings", () => {
  it("shows a modest range that grows when the month slider moves", () => {
    render(<WatchEarnings />);
    const readRange = () => screen.getByTestId("earnings-range").textContent ?? "";
    const slider = screen.getByTestId("earnings-month");

    fireEvent.change(slider, { target: { value: "1" } });
    const month1 = readRange();
    fireEvent.change(slider, { target: { value: "12" } });
    const month12 = readRange();

    const low = (s: string) => Number(s.replace(/[^0-9 ]/g, "").trim().split(/\s+/)[0]);
    expect(low(month12)).toBeGreaterThan(low(month1));
    // Modest by construction: month 1 at 300 views a video is well under $200.
    expect(low(month1)).toBeLessThan(200);
  });
});
