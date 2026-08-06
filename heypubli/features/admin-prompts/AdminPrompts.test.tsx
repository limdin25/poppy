import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminPrompts } from "./AdminPrompts";
import { mockPrompts } from "./mock";
import { adminPromptsCopy } from "./copy";

describe("AdminPrompts", () => {
  it("lists every prompt it is given", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    expect(screen.getByText("@aimikoda")).toBeInTheDocument();
    expect(screen.getByText("@maxescu")).toBeInTheDocument();
    expect(screen.getByText("@tinyaccount")).toBeInTheDocument();
  });

  it("counts the prompts, the ones written in the post, and the creators", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    expect(screen.getByTestId("stat-total")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-in-post")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-creators")).toHaveTextContent("4");
  });

  it("keeps only the prompts written in the post when that filter is on", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    fireEvent.click(screen.getByRole("button", { name: adminPromptsCopy.filters.post }));
    expect(screen.getByText("@aimikoda")).toBeInTheDocument();
    expect(screen.queryByText("@maxescu")).not.toBeInTheDocument();
    expect(screen.queryByText("@bigessay")).not.toBeInTheDocument();
  });

  // A 900k-follower essay must not outrank a labelled prompt from a 24k account,
  // or the top of the page fills up with posts that carry no prompt at all.
  it("puts a labelled prompt above a bigger account whose prompt is only a guess", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    const handles = screen.getAllByTestId("prompt-handle").map((el) => el.textContent);
    expect(handles.indexOf("@aimikoda")).toBeLessThan(handles.indexOf("@bigessay"));
  });

  it("searches inside the prompt text, not just the handle", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "handheld pursuit" },
    });
    expect(screen.getByText("@aimikoda")).toBeInTheDocument();
    expect(screen.queryByText("@tinyaccount")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzzzzz" },
    });
    expect(screen.getByText(adminPromptsCopy.emptyTitle)).toBeInTheDocument();
  });

  it("sorts by follower count first, so the biggest account leads", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    const handles = screen.getAllByTestId("prompt-handle").map((el) => el.textContent);
    expect(handles[0]).toBe("@aimikoda");
    expect(handles[handles.length - 1]).toBe("@tinyaccount");
  });

  it("offers a copy button only where the text on screen is the prompt", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    expect(screen.getAllByRole("button", { name: adminPromptsCopy.copy })).toHaveLength(
      2,
    );
  });

  it("links every prompt back to the post it came from", () => {
    render(<AdminPrompts prompts={mockPrompts} />);
    const links = screen.getAllByRole("link", { name: adminPromptsCopy.open });
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", "https://x.com/aimikoda/status/1");
  });
});
