import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMediaUploadUrl = vi.fn();
const uploadToSignedUrl = vi.fn();

vi.mock("@/lib/actions/media", () => ({
  createMediaUploadUrl: (...args: unknown[]) => createMediaUploadUrl(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl }) },
  }),
}));

import { MediaUpload } from "./media-upload";

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("MediaUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMediaUploadUrl.mockResolvedValue({
      path: "post-media/x.jpg",
      token: "tok",
      publicUrl: "https://cdn/x.jpg",
    });
    uploadToSignedUrl.mockResolvedValue({ error: null });
  });

  it("renders the dropzone CTA", () => {
    render(<MediaUpload onUploaded={() => {}} />);
    expect(screen.getByText(/arraste mídia ou clique para enviar/i)).toBeInTheDocument();
  });

  it("uploads a picked file and reports the public URL", async () => {
    const onUploaded = vi.fn();
    render(<MediaUpload onUploaded={onUploaded} />);

    pickFile(new File(["x"], "praia.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("https://cdn/x.jpg"));
    expect(createMediaUploadUrl).toHaveBeenCalledWith("praia.jpg", "image/jpeg");
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      "post-media/x.jpg",
      "tok",
      expect.any(File),
    );
    expect(screen.getByText(/praia\.jpg/)).toBeInTheDocument();
  });

  it("rejects an oversized image with a PT-BR error (no upload)", async () => {
    render(<MediaUpload onUploaded={() => {}} />);

    const big = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    pickFile(big);

    expect(await screen.findByText(/muito grande/i)).toBeInTheDocument();
    expect(createMediaUploadUrl).not.toHaveBeenCalled();
  });

  it("shows the server error when the signed URL is refused", async () => {
    createMediaUploadUrl.mockResolvedValue({ error: "Formato não suportado." });
    render(<MediaUpload onUploaded={() => {}} />);

    pickFile(new File(["x"], "a.jpg", { type: "image/jpeg" }));

    expect(await screen.findByText(/formato não suportado/i)).toBeInTheDocument();
  });
});
