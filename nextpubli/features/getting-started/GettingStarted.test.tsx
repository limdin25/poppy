import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { GettingStarted } from "./GettingStarted";

// Hugo, 2026-08-04, replacing the "Your products" tier ladder (fabricated Nike /
// Adidas / Samsung logos inherited from the Brazilian original): "on your
// product here I can put the three steps what they have to do now, which is
// connect your account, get your Skool URL and log into Skool, and three your
// bio. We can even make three steps and make expandable and I can make a video
// for each step."
//
// Steps 1 and 2 tick themselves. Step 3 cannot be checked from here (the bio
// lives in the Instagram app) so the creator declares it.

const baseProps = {
  instagramConnected: false,
  communityJoined: false,
  connectUrl: "/api/outstand/connect",
  skoolAffiliateUrl: null,
  profileReady: false,
  onSaveStep3: vi.fn(),
};

describe("GettingStarted", () => {
  it("shows the three steps in order", () => {
    render(<GettingStarted {...baseProps} />);
    const headings = screen.getAllByRole("button", { name: /^Step \d/ });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveTextContent("Connect your Instagram");
    expect(headings[1]).toHaveTextContent("Join the community");
    expect(headings[2]).toHaveTextContent("Get your profile ready");
  });

  it("starts with only the first unfinished step open", () => {
    render(<GettingStarted {...baseProps} />);
    // Step 1 body is visible, the other two are collapsed.
    expect(screen.getByRole("link", { name: "Connect Instagram" })).toBeVisible();
    expect(screen.queryByText(/Check your email/)).not.toBeInTheDocument();
  });

  it("opens the community step first once Instagram is done", () => {
    render(<GettingStarted {...baseProps} instagramConnected />);
    expect(screen.getByText(/Check your email/)).toBeInTheDocument();
  });

  it("lets you open a step you have already finished", async () => {
    const user = userEvent.setup();
    render(<GettingStarted {...baseProps} instagramConnected />);
    await user.click(screen.getByRole("button", { name: /^Step 1/ }));
    expect(screen.getByText(/already connected/i)).toBeInTheDocument();
  });

  it("counts finished steps", () => {
    render(<GettingStarted {...baseProps} instagramConnected communityJoined />);
    expect(screen.getByText("2 of 3 done")).toBeInTheDocument();
  });

  it("marks a step done from the real state, not from a tick the user pressed", () => {
    render(<GettingStarted {...baseProps} instagramConnected />);
    const step1 = screen.getByRole("button", { name: /^Step 1/ });
    expect(within(step1).getByText("Done")).toBeInTheDocument();
    const step2 = screen.getByRole("button", { name: /^Step 2/ });
    expect(within(step2).queryByText("Done")).not.toBeInTheDocument();
  });

  // The community invite is NOT sent on signup. Only Facebook lead-form leads
  // get one automatically (lib/data/lanes.ts + app/api/webhooks/fb-leads), so
  // step 2 must not promise an email that may never arrive.
  it("does not promise the invite is automatic for everyone", () => {
    render(<GettingStarted {...baseProps} instagramConnected />);
    const body = screen.getByTestId("step-community");
    expect(body).toHaveTextContent(/we will send you/i);
    expect(body.textContent ?? "").not.toMatch(/automatically/i);
  });

  it("asks for the Skool affiliate link and the bio work in step 3", async () => {
    const user = userEvent.setup();
    render(
      <GettingStarted {...baseProps} instagramConnected communityJoined />,
    );
    const body = screen.getByTestId("step-profile");
    expect(body).toHaveTextContent(/real name/i);
    expect(body).toHaveTextContent(/photo/i);
    expect(body).toHaveTextContent(/bio/i);
    expect(
      screen.getByLabelText(/your Skool affiliate link/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /profile is ready/i }));
  });

  it("keeps step 3 open and ticked once it is saved", () => {
    render(
      <GettingStarted
        {...baseProps}
        instagramConnected
        communityJoined
        profileReady
        skoolAffiliateUrl="https://www.skool.com/ai-influencer-flywheel-5612/?ref=abc123"
      />,
    );
    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        "https://www.skool.com/ai-influencer-flywheel-5612/?ref=abc123",
      ),
    ).toBeInTheDocument();
  });

  it("shows a video only for the steps that have one", () => {
    render(
      <GettingStarted
        {...baseProps}
        videos={{ instagram: "/videos/step-1.mp4" }}
      />,
    );
    const video = screen.getByTestId("step-video-instagram");
    expect(video).toHaveAttribute("src", "/videos/step-1.mp4");
  });

  it("shows no video at all when none are set, and no empty player", () => {
    render(<GettingStarted {...baseProps} />);
    expect(screen.queryByTestId(/step-video/)).not.toBeInTheDocument();
  });
});
