import { describe, it, expect } from "vitest";
import { readInstagramOptions } from "./instagram-options";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const k of Object.keys(obj)) f.set(k, obj[k]);
  return f;
}

describe("readInstagramOptions", () => {
  it("returns null when no option is provided", () => {
    expect(readInstagramOptions(fd({}))).toBeNull();
    expect(
      readInstagramOptions(fd({ collaborators: "  ", first_comment: "" })),
    ).toBeNull();
  });

  it("parses collaborators: strips @, trims, dedupes, caps at 3", () => {
    const r = readInstagramOptions(
      fd({ collaborators: "@marca, perfil2 , @marca, @c, @d" }),
    );
    expect(r).toEqual({ collaborators: ["marca", "perfil2", "c"] });
  });

  it("keeps the first comment text", () => {
    const r = readInstagramOptions(fd({ first_comment: "  Link na bio!  " }));
    expect(r).toEqual({ first_comment: "Link na bio!" });
  });

  it("parses reel cover seconds as a non-negative number", () => {
    expect(readInstagramOptions(fd({ reel_cover_seconds: "2.5" }))).toEqual({
      reel_cover_seconds: 2.5,
    });
    expect(readInstagramOptions(fd({ reel_cover_seconds: "-1" }))).toBeNull();
    expect(readInstagramOptions(fd({ reel_cover_seconds: "abc" }))).toBeNull();
  });

  it("combines all options", () => {
    const r = readInstagramOptions(
      fd({
        collaborators: "@a",
        first_comment: "oi",
        reel_cover_seconds: "1",
      }),
    );
    expect(r).toEqual({
      collaborators: ["a"],
      first_comment: "oi",
      reel_cover_seconds: 1,
    });
  });
});
