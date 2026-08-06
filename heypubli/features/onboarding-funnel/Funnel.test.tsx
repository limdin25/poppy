import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Funnel } from "./Funnel";
import { funnelCopy } from "./copy";
import { funnelMockFresh, funnelMockMidway, funnelMockComplete } from "./mock";

// The server actions pull in next/cache and the Supabase server client,
// neither of which belongs in a jsdom render.
vi.mock("@/lib/actions/onboarding", () => ({
  saveSkoolLink: vi.fn(),
  declareCommunityJoined: vi.fn(),
  declarePhotoDone: vi.fn(),
  declareBioDone: vi.fn(),
}));

vi.mock("@/lib/actions/invite", () => ({ requestSkoolInvite: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe("Funnel", () => {
  it("greets by name and counts five steps", () => {
    render(<Funnel data={funnelMockFresh} />);
    expect(screen.getByText("One step at a time, Aisha.")).toBeInTheDocument();
    expect(screen.getByTestId("funnel-progress")).toHaveTextContent("0 of 5 done");
  });

  // The whole point: exactly ONE step is open, everything after it is locked.
  it("opens only the first undone step and locks the rest", () => {
    render(<Funnel data={funnelMockFresh} />);
    expect(screen.getByTestId("step-instagram")).toHaveAttribute("data-mode", "open");
    for (const id of ["community", "affiliate", "photo", "bio"]) {
      expect(screen.getByTestId(`step-${id}`)).toHaveAttribute("data-mode", "locked");
    }
  });

  it("a locked step renders its title but none of its working parts", () => {
    render(<Funnel data={funnelMockFresh} />);
    // The affiliate form and the declare buttons live in locked steps here.
    expect(screen.queryByTestId("skool-link-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("declare-community")).not.toBeInTheDocument();
    expect(screen.queryByTestId("declare-photo")).not.toBeInTheDocument();
  });

  it("moves the open step forward as steps finish", () => {
    render(<Funnel data={funnelMockMidway} />);
    expect(screen.getByTestId("step-affiliate")).toHaveAttribute("data-mode", "open");
    expect(screen.getByTestId("step-instagram")).toHaveAttribute("data-mode", "done");
    expect(screen.getByTestId("step-community")).toHaveAttribute("data-mode", "done");
    expect(screen.getByTestId("skool-link-input")).toBeInTheDocument();
  });

  // Done steps stay readable: a funnel that deletes what you did teaches
  // nothing to the creator who comes back to change a link.
  it("keeps a done step's content reachable behind its summary row", () => {
    render(<Funnel data={funnelMockMidway} />);
    const done = screen.getByTestId("step-instagram");
    expect(done.tagName.toLowerCase()).toBe("details");
  });

  it("prints the creator's own email in the community step when open", () => {
    render(
      <Funnel
        data={{
          ...funnelMockFresh,
          instagram: { state: "done", username: "a", canReadBio: true },
          stepStates: { ...funnelMockFresh.stepStates, instagram: "done" },
          openStep: "community",
          doneSteps: 1,
        }}
      />,
    );
    expect(screen.getByText(/aisha@example\.com/)).toBeInTheDocument();
  });

  it("celebrates once everything is done, with the finish banner and confetti", () => {
    render(<Funnel data={funnelMockComplete} />);
    expect(screen.getByTestId("funnel-finished")).toBeInTheDocument();
    expect(screen.getByTestId("funnel-confetti")).toBeInTheDocument();
    expect(screen.getByTestId("funnel-progress")).toHaveTextContent("5 of 5 done");
  });

  it("shows no confetti and no finish banner before the end", () => {
    render(<Funnel data={funnelMockMidway} />);
    expect(screen.queryByTestId("funnel-finished")).not.toBeInTheDocument();
    expect(screen.queryByTestId("funnel-confetti")).not.toBeInTheDocument();
  });

  // Blocked is never dressed up as the creator's fault, and never traps the
  // funnel: with Instagram switched off the open step is community.
  it("skips a blocked step and says the blockage is ours", () => {
    render(
      <Funnel
        data={{
          ...funnelMockFresh,
          instagramEnabled: false,
          instagram: { state: "blocked", username: null, canReadBio: false },
          stepStates: { ...funnelMockFresh.stepStates, instagram: "blocked" },
          openStep: "community",
        }}
      />,
    );
    expect(screen.getByTestId("step-instagram")).toHaveAttribute("data-mode", "locked");
    expect(screen.getByTestId("step-community")).toHaveAttribute("data-mode", "open");
    expect(
      screen.getByText(funnelCopy.steps.instagram.status.blocked),
    ).toBeInTheDocument();
  });

  it("names the invite sender, because nobody recognises Lim Din", () => {
    const words = JSON.stringify(funnelCopy.steps.community);
    expect(words).toContain("Lim Din");
  });

  // Instagram's Links row holds several links and the API returns only the
  // first, so "we read your bio and it is not there" can be plain wrong. A
  // creator who did the work must always have a way through: recheck first,
  // and their own word as the backstop.
  it("never leaves the last step with no way forward", () => {
    const openBio = {
      ...funnelMockComplete,
      bio: { ...funnelMockComplete.bio, state: "waiting" as const, declaredAt: null },
      stepStates: { ...funnelMockComplete.stepStates, bio: "waiting" as const },
      openStep: "bio" as const,
      doneSteps: 4,
      allDone: false,
    };
    render(<Funnel data={openBio} />);
    expect(screen.getByTestId("recheck-bio")).toBeInTheDocument();
    expect(screen.getByTestId("declare-bio")).toBeInTheDocument();
  });

  // The step-2 dead end: the page described an invite email that nothing had
  // ever sent. Every creator must be able to summon it themselves.
  it("gives step two a button that actually sends the invite", () => {
    render(
      <Funnel
        data={{
          ...funnelMockFresh,
          instagram: { state: "done", username: "a", canReadBio: true },
          stepStates: { ...funnelMockFresh.stepStates, instagram: "done" },
          openStep: "community",
          doneSteps: 1,
        }}
      />,
    );
    expect(screen.getByTestId("request-invite")).toBeInTheDocument();
  });

  // A failed Instagram connection used to return them to an identical page.
  it("explains an Instagram failure instead of showing the same screen again", () => {
    render(<Funnel data={{ ...funnelMockFresh, instagramError: true }} />);
    expect(screen.getByTestId("instagram-error")).toBeInTheDocument();
    expect(screen.getByText(/professional account/i)).toBeInTheDocument();
  });

  it("uses no punctuation Hugo banned, anywhere in the copy", () => {
    const all = JSON.stringify(funnelCopy);
    for (const code of [0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026]) {
      expect(all).not.toContain(String.fromCharCode(code));
    }
  });
});
