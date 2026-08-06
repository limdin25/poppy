import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Brochure } from "./Brochure";
import { brochureCopy } from "./copy";
import { brochureMock, brochureMockComplete } from "./mock";
import type { BrochureData } from "@/lib/data/brochure";

// The client children import server actions, which pull in next/cache and the
// Supabase server client. Neither belongs in a jsdom render of a layout.
vi.mock("@/lib/actions/brochure", () => ({
  saveSkoolLink: vi.fn(),
  declareBioDone: vi.fn(),
  EMPTY_SKOOL_LINK_RESULT: { ok: false, message: "", url: null },
}));

// RecheckButton calls useRouter, and outside an app-router tree that throws
// rather than returning undefined.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function view(data: BrochureData) {
  return render(<Brochure data={data} />);
}

describe("Brochure", () => {
  it("greets the creator by name and counts the steps", () => {
    view(brochureMock);
    expect(screen.getByText("Four things, Aisha.")).toBeInTheDocument();
    expect(screen.getByTestId("brochure-progress")).toHaveTextContent("0 of 4 done");
  });

  // The whole point of the layout. Nothing is behind an accordion, so a creator
  // can read the entire job before starting any of it.
  it("shows all four steps at once, done or not", () => {
    view(brochureMockComplete);
    for (const id of ["instagram", "community", "affiliate", "bio"]) {
      expect(screen.getByTestId(`step-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("brochure-progress")).toHaveTextContent("4 of 4 done");
  });

  // Their address, printed on the page, because typing a different one into
  // Skool is the mistake that costs them money and cannot be spotted later.
  it("prints the creator's own email in step 2", () => {
    view(brochureMock);
    expect(screen.getByText(/aisha@example\.com/)).toBeInTheDocument();
  });

  it("gives them their own bio sentence with a copy button", () => {
    view(brochureMock);
    expect(screen.getByTestId("text-bio-sentence")).toHaveValue(
      brochureMock.bio.sentence,
    );
    expect(screen.getByTestId("copy-bio-sentence")).toBeInTheDocument();
  });

  it("hides the link copy box until step 3 is saved, and explains why", () => {
    view(brochureMock);
    expect(screen.queryByTestId("text-bio-link")).not.toBeInTheDocument();
    expect(screen.getByText(brochureCopy.steps.bio.linkMissing)).toBeInTheDocument();

    view(brochureMockComplete);
    expect(screen.getByTestId("text-bio-link")).toHaveValue(
      brochureMockComplete.affiliate.url,
    );
  });

  it("renders every picture slot as words while the pictures do not exist", () => {
    view(brochureMock);
    for (const id of [
      "connect",
      "allow",
      "invite-email",
      "skool-signup",
      "affiliate-link",
      "ig-bio",
      "ig-links",
    ]) {
      expect(screen.getByTestId(`plate-fallback-${id}`)).toBeInTheDocument();
    }
  });

  // "We could not check" must never be dressed up as "you did not do it".
  it("offers the self-declare button only when we could not read the bio", () => {
    view({
      ...brochureMockComplete,
      bio: { ...brochureMockComplete.bio, state: "waiting" },
    });
    expect(screen.queryByTestId("declare-bio")).not.toBeInTheDocument();
    expect(screen.getByTestId("recheck-bio")).toBeInTheDocument();

    view({
      ...brochureMockComplete,
      bio: { ...brochureMockComplete.bio, state: "unknown" },
    });
    expect(screen.getByTestId("declare-bio")).toBeInTheDocument();
  });

  it("says a step is ours to fix, not theirs, when Instagram is switched off", () => {
    view({
      ...brochureMock,
      instagramEnabled: false,
      instagram: { state: "blocked", username: null, canReadBio: false },
    });
    expect(screen.queryByTestId("connect-instagram")).not.toBeInTheDocument();
    expect(screen.getByTestId("status-instagram")).toHaveAttribute(
      "data-state",
      "blocked",
    );
  });

  it("warns when the saved link has no personal code in it", () => {
    view({
      ...brochureMockComplete,
      bio: { ...brochureMockComplete.bio, state: "waiting", needleKind: "community" },
    });
    expect(screen.getByText(brochureCopy.steps.bio.weakNeedle)).toBeInTheDocument();
  });

  // Locked in by a test because it is the promise Hugo cannot keep: a
  // self-serve signup waits for an admin to approve them.
  it("never claims the community invite is automatic", () => {
    const words = JSON.stringify(brochureCopy.steps.community).toLowerCase();
    expect(words).not.toContain("automatic");
    expect(words).not.toContain("instantly");
    expect(words).not.toContain("straight away");
  });

  // Step 2 has to be finishable by the creator saying so, because Skool has no
  // trigger for a free member joining. Its Zapier app fires on New Paid Member
  // and on membership questions, and on nothing else. Without this button a
  // free invited creator sits on step 2 forever having done everything right.
  it("lets the creator say they joined, because Skool never tells us", () => {
    render(
      <Brochure
        data={{
          ...brochureMockComplete,
          community: { state: "waiting", emailUsable: true, selfDeclared: false },
        }}
      />,
    );
    expect(screen.getByTestId("declare-community")).toBeInTheDocument();
  });

  it("stops offering it once the step is done", () => {
    render(<Brochure data={brochureMockComplete} />);
    expect(screen.queryByTestId("declare-community")).not.toBeInTheDocument();
  });

  // The old wording promised "this ticks itself the moment Skool tells us you
  // are in". It never could. A step that cannot complete is worse than a step
  // that asks for a tap.
  it("does not promise the step ticks itself", () => {
    const words = JSON.stringify(brochureCopy.steps.community).toLowerCase();
    expect(words).not.toContain("ticks itself");
    expect(words).not.toContain("skool tells us you are in");
  });

  it("uses no punctuation Hugo banned, anywhere in the copy", () => {
    const all = JSON.stringify(brochureCopy);
    for (const ch of ["—", "–", "‘", "’", "“", "”", "…"]) {
      expect(all).not.toContain(ch);
    }
  });
});
