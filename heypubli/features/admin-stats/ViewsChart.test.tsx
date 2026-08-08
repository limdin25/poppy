import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewsChart } from "./ViewsChart";
import { dailyGains } from "./ViewsChart";

const pt = (day: string, views: number) => ({ day, views, likes: 0, reach: 0, videos: 1 });

describe("dailyGains", () => {
  it("turns a running total into what each day actually added", () => {
    const g = dailyGains([pt("2026-08-08", 100), pt("2026-08-09", 250), pt("2026-08-10", 300)]);
    // The first day has no day before it to subtract from, so its gain is
    // unknown rather than 100: the series may simply start mid-history.
    expect(g).toEqual([null, 150, 50]);
  });

  it("never reports a negative day from a restated figure", () => {
    // Instagram revises numbers down sometimes. A video cannot lose views, so
    // a fall is an artefact of the source and is reported as no gain.
    expect(dailyGains([pt("2026-08-08", 100), pt("2026-08-09", 90)])).toEqual([null, 0]);
  });

  it("has nothing to say about a single day", () => {
    expect(dailyGains([pt("2026-08-08", 100)])).toEqual([null]);
  });
});

describe("ViewsChart", () => {
  it("says so plainly when there is nothing recorded yet", () => {
    render(<ViewsChart points={[]} />);
    expect(screen.getByTestId("views-chart").textContent).toContain("Nothing recorded yet");
  });

  it("does not draw a trend from a single day, and explains why", () => {
    render(<ViewsChart points={[pt("2026-08-08", 915)]} />);
    const el = screen.getByTestId("views-chart");
    expect(el.textContent).toContain("915");
    // A line needs two points. Drawing one would imply a flat trend, which is
    // a claim we cannot make on day one.
    expect(el.textContent).toContain("first day of readings");
    expect(el.querySelector("svg")).toBeNull();
  });

  it("draws the run once there are two days", () => {
    render(<ViewsChart points={[pt("2026-08-08", 100), pt("2026-08-09", 250)]} />);
    const el = screen.getByTestId("views-chart");
    expect(el.querySelector("svg")).toBeTruthy();
    expect(el.textContent).toContain("250");
  });

  it("labels each day so the shape can be read, not just admired", () => {
    render(<ViewsChart points={[pt("2026-08-08", 100), pt("2026-08-09", 250)]} />);
    const el = screen.getByTestId("views-chart");
    // A native title per day, so hovering says what the bar is worth.
    expect(el.innerHTML).toContain("150 views that day");
  });
});
