import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AdminScheduler } from "./AdminScheduler";

vi.mock("@/lib/actions/admin", () => ({
  schedulePost: vi.fn(),
}));

vi.mock("@/lib/actions/media", () => ({
  createMediaUploadUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }),
}));

const MOCK_INFLUENCERS = [
  { id: "user-1", first_name: "Ana", last_name: "Silva", ig_username: "ana.silva" },
  { id: "user-2", first_name: "Carlos", last_name: "Santos", ig_username: "carlao" },
];

const MOCK_BRANDS = [{ id: "brand-1", name: "ScanPlates" }];

describe("AdminScheduler", () => {
  it("renders heading", () => {
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);
    expect(screen.getByText("Agendador")).toBeInTheDocument();
  });

  it("shows influencer checkboxes with their Instagram handles", () => {
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(screen.getByText("@ana.silva")).toBeInTheDocument();
    expect(screen.getByText("Carlos Santos")).toBeInTheDocument();
  });

  it("explains the empty state when nobody has Instagram connected", () => {
    render(<AdminScheduler influencers={[]} brands={MOCK_BRANDS} />);
    expect(
      screen.getByText(/nenhum influenciador com instagram conectado/i),
    ).toBeInTheDocument();
  });

  it("shows schedule button", () => {
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);
    expect(screen.getByText("Agendar post")).toBeInTheDocument();
  });

  it("offers the upload dropzone", () => {
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);
    expect(screen.getByText(/arraste mídia ou clique para enviar/i)).toBeInTheDocument();
  });

  it("shows collaborators + first comment for feed posts", () => {
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);
    expect(screen.getByText(/colaboradores/i)).toBeInTheDocument();
    expect(screen.getByText(/primeiro comentário/i)).toBeInTheDocument();
  });

  it("for stories: hides caption/options and explains the official API limits", async () => {
    const user = userEvent.setup();
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);

    await user.selectOptions(screen.getAllByRole("combobox")[1], "story_image");

    expect(screen.queryByPlaceholderText(/legenda/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/colaboradores/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/stickers, enquetes e música não são permitidos/i),
    ).toBeInTheDocument();
  });

  it("shows the Reel cover field only for reels", async () => {
    const user = userEvent.setup();
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);

    expect(screen.queryByText(/capa do reel/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getAllByRole("combobox")[1], "reel");
    expect(screen.getByText(/capa do reel/i)).toBeInTheDocument();
  });

  it("offers a timezone picker, defaulting to the app default", () => {
    render(
      <AdminScheduler
        influencers={MOCK_INFLUENCERS}
        brands={MOCK_BRANDS}
        defaultTimezone="Europe/London"
      />,
    );
    const tz = screen.getByLabelText("Fuso horário") as HTMLSelectElement;
    expect(tz.value).toBe("Europe/London");
    expect(screen.getByText("Brasília (GMT-3)")).toBeInTheDocument();
  });

  it("requires media before scheduling", async () => {
    const user = userEvent.setup();
    render(<AdminScheduler influencers={MOCK_INFLUENCERS} brands={MOCK_BRANDS} />);

    await user.click(screen.getByText("Ana Silva"));
    await user.type(screen.getByPlaceholderText(/legenda/i), "Olá!");
    const dateInput = document.querySelector('input[type="datetime-local"]');
    expect(dateInput).not.toBeNull();
    await user.type(dateInput as HTMLInputElement, "2099-06-12T17:00");

    await user.click(screen.getByText("Agendar post"));
    expect(await screen.findByText(/não pode ser publicado sem mídia/i)).toBeVisible();
  });
});
