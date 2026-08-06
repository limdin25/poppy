import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DemoWall } from "./DemoWall";
import { demoVideos } from "./demoVideos";

beforeEach(() => {
  // jsdom has no media stack, so play/pause are undefined without this.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

describe("DemoWall", () => {
  it("renders every clip with a poster and no eager download", () => {
    const { container } = render(<DemoWall />);
    const videos = container.querySelectorAll("video");
    expect(videos).toHaveLength(demoVideos.length);
    videos.forEach((video, i) => {
      expect(video.getAttribute("src")).toBe(demoVideos[i].src);
      expect(video.getAttribute("poster")).toBe(demoVideos[i].poster);
      expect(video.getAttribute("preload")).toBe("none");
    });
  });

  it("starts every clip muted so autoplay is allowed", () => {
    const { container } = render(<DemoWall />);
    container.querySelectorAll("video").forEach((video) => {
      expect((video as HTMLVideoElement).muted).toBe(true);
    });
  });

  it("unmutes only the clip that was tapped", () => {
    const { container } = render(<DemoWall />);
    const buttons = screen.getAllByRole("button", { name: /turn sound on/i });
    fireEvent.click(buttons[1]);

    const videos = [...container.querySelectorAll("video")] as HTMLVideoElement[];
    expect(videos[1].muted).toBe(false);
    expect(videos.filter((v) => !v.muted)).toHaveLength(1);
  });

  it("offers a play control on every clip, so autoplay is never the only way in", () => {
    render(<DemoWall />);
    // No IntersectionObserver callback and no autoplay: the poster must still be
    // playable by hand or the wall is four dead images.
    expect(screen.getAllByRole("button", { name: /play this clip/i })).toHaveLength(
      demoVideos.length,
    );
  });

  it("plays the clip when its play control is pressed", () => {
    render(<DemoWall />);
    fireEvent.click(screen.getAllByRole("button", { name: /play this clip/i })[2]);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("tapping the same clip again mutes it", () => {
    const { container } = render(<DemoWall />);
    fireEvent.click(screen.getAllByRole("button", { name: /turn sound on/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /turn sound off/i }));

    const videos = [...container.querySelectorAll("video")] as HTMLVideoElement[];
    expect(videos.every((v) => v.muted)).toBe(true);
  });
});
