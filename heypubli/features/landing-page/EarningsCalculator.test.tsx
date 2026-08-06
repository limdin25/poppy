import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EarningsCalculator } from "./EarningsCalculator";
import { MAX_DISPLAYED_MONTHLY_USD } from "@/lib/earnings";

/** Play the section immediately: jsdom has no IntersectionObserver and the count-up
 *  would otherwise leave every figure at zero. */
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true, // reduced motion, so the count-up is a zero-length animation
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  // jsdom never advances frames. Run the callback once with a timestamp past any
  // duration so the count-up lands on its final value in a single tick.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(performance.now() + 10_000);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

/** Only the two figures in the result row. The fact chips also contain "$108". */
const money = () =>
  [...screen.getByTestId("calc-result").querySelectorAll("span")]
    .map((n) => n.textContent ?? "")
    .filter((t) => /^\$[\d,]+$/.test(t))
    .map((t) => Number(t.replace(/[$,]/g, "")));

describe("EarningsCalculator without any animation at all", () => {
  /* A hidden document computes no intersections and runs no frames, so a page opened in
     a background tab gets neither the observer nor a single rAF tick. The figures must
     still be right: this shipped once rendering "$0 to $0 a month". */
  it("still shows the real figures when nothing ever fires", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    render(<EarningsCalculator />);
    expect(money()).toEqual([90, 280]);
    expect(screen.queryByText("$0")).toBeNull();
  });

  it("still draws the chart when nothing ever fires", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 0);

    const { container } = render(<EarningsCalculator />);
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((p) => expect(p.getAttribute("d")).toBeTruthy());
  });
});

describe("EarningsCalculator", () => {
  it("asks only two questions and never exposes a rate to edit", () => {
    const { container } = render(<EarningsCalculator />);
    expect(screen.getByText(/how big is your instagram/i)).toBeInTheDocument();
    expect(screen.getByText(/how many accounts/i)).toBeInTheDocument();
    // No sliders and no free text: the visitor cannot invent an assumption.
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("labels the figure as an estimate in the same glance as the money", () => {
    render(<EarningsCalculator />);
    expect(screen.getByText(/^estimate$/i)).toBeInTheDocument();
    expect(screen.getByText(/by month 12/i)).toBeInTheDocument();
  });

  it("shows the default band as a range, not a single number", () => {
    render(<EarningsCalculator />);
    // Default is the 1,000 to 10,000 band, one account: about $90 to $280 by month 12.
    expect(money()).toEqual([90, 280]);
    expect(screen.getByText(/^to$/)).toBeInTheDocument();
  });

  it("labels the chart scale, so a bigger band is visibly a bigger chart", () => {
    render(<EarningsCalculator />);
    expect(screen.getByText(/top of range/i)).toBeInTheDocument();
    const axisBefore = screen.getByText(/top of range/i).previousElementSibling;
    expect(axisBefore?.textContent).toBe("$280");

    fireEvent.click(screen.getByRole("button", { name: "10,000 to 50,000" }));
    expect(
      screen.getByText(/top of range/i).previousElementSibling?.textContent,
    ).not.toBe("$280");
  });

  it("shows month 1 beside month 12 so it reads as a trajectory", () => {
    render(<EarningsCalculator />);
    expect(screen.getByText(/month 1 starts near/i)).toBeInTheDocument();
  });

  it("grows when a bigger account is picked", () => {
    render(<EarningsCalculator />);
    const before = Math.max(...money());
    fireEvent.click(screen.getByRole("button", { name: "10,000 to 50,000" }));
    expect(Math.max(...money())).toBeGreaterThan(before);
  });

  it("offers at most three accounts and never a free number box", () => {
    render(<EarningsCalculator />);
    expect(screen.getByRole("button", { name: /^3 accounts$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^4 accounts$/i })).toBeNull();
  });

  it("never displays a figure above the cap, whatever is selected", () => {
    render(<EarningsCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "Over 200,000" }));
    fireEvent.click(screen.getByRole("button", { name: /^3 accounts$/i }));
    money().forEach((value) => {
      expect(value).toBeLessThanOrEqual(MAX_DISPLAYED_MONTHLY_USD);
    });
  });

  it("says out loud when the cap bit rather than hiding it", () => {
    render(<EarningsCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "Over 200,000" }));
    fireEvent.click(screen.getByRole("button", { name: /^3 accounts$/i }));
    expect(screen.getByText(/we cap what we show here/i)).toBeInTheDocument();
  });

  it("carries every mandatory honesty line", () => {
    render(<EarningsCalculator />);
    expect(screen.getByText(/not a promise of income/i)).toBeInTheDocument();
    expect(screen.getByText(/earn little or nothing/i)).toBeInTheDocument();
    expect(screen.getByText(/1 sale for every 10,000 views/i)).toBeInTheDocument();
    expect(screen.getByText(/go up and down a lot/i)).toBeInTheDocument();
    expect(screen.getByText(/if posting stops, earnings stop/i)).toBeInTheDocument();
  });
});
