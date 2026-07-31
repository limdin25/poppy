import { describe, it, expect } from "vitest";
import {
  spLocalToUtcIso,
  utcIsoToSpLocal,
  formatSaoPaulo,
  localToUtcIso,
  utcIsoToLocal,
  SCHEDULING_TIMEZONES,
  isSchedulingTimezone,
} from "./timezone";

describe("localToUtcIso (any IANA timezone)", () => {
  it("converts São Paulo wall time (fixed UTC-3)", () => {
    expect(localToUtcIso("2026-06-12T17:00", "America/Sao_Paulo")).toBe(
      "2026-06-12T20:00:00.000Z",
    );
  });

  it("converts London SUMMER time (BST, UTC+1)", () => {
    expect(localToUtcIso("2026-06-12T17:00", "Europe/London")).toBe(
      "2026-06-12T16:00:00.000Z",
    );
  });

  it("converts London WINTER time (GMT, UTC+0)", () => {
    expect(localToUtcIso("2026-01-12T17:00", "Europe/London")).toBe(
      "2026-01-12T17:00:00.000Z",
    );
  });

  it("converts Manaus (fixed UTC-4)", () => {
    expect(localToUtcIso("2026-06-12T17:00", "America/Manaus")).toBe(
      "2026-06-12T21:00:00.000Z",
    );
  });

  it("treats UTC as identity", () => {
    expect(localToUtcIso("2026-06-12T17:00", "UTC")).toBe("2026-06-12T17:00:00.000Z");
  });
});

describe("utcIsoToLocal", () => {
  it("round-trips across timezones, including DST", () => {
    for (const tz of ["America/Sao_Paulo", "Europe/London", "America/Manaus", "UTC"]) {
      expect(utcIsoToLocal(localToUtcIso("2026-06-12T17:00", tz), tz)).toBe(
        "2026-06-12T17:00",
      );
      expect(utcIsoToLocal(localToUtcIso("2026-01-05T08:30", tz), tz)).toBe(
        "2026-01-05T08:30",
      );
    }
  });
});

describe("SCHEDULING_TIMEZONES", () => {
  it("offers Brasília first (the default) and validates membership", () => {
    expect(SCHEDULING_TIMEZONES[0].value).toBe("America/Sao_Paulo");
    expect(isSchedulingTimezone("Europe/London")).toBe(true);
    expect(isSchedulingTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("spLocalToUtcIso", () => {
  it("treats a datetime-local string as São Paulo time (UTC-3)", () => {
    expect(spLocalToUtcIso("2026-06-12T17:00")).toBe("2026-06-12T20:00:00.000Z");
  });

  it("accepts seconds", () => {
    expect(spLocalToUtcIso("2026-06-12T17:00:30")).toBe("2026-06-12T20:00:30.000Z");
  });
});

describe("utcIsoToSpLocal", () => {
  it("converts UTC back to a datetime-local string in São Paulo time", () => {
    expect(utcIsoToSpLocal("2026-06-12T20:00:00.000Z")).toBe("2026-06-12T17:00");
  });

  it("round-trips with spLocalToUtcIso", () => {
    expect(utcIsoToSpLocal(spLocalToUtcIso("2026-01-05T08:30"))).toBe("2026-01-05T08:30");
  });
});

describe("formatSaoPaulo", () => {
  it("renders a UTC timestamp as pt-BR date/time in São Paulo", () => {
    expect(formatSaoPaulo("2026-06-12T20:00:00Z")).toBe("12/06/2026, 17:00");
  });
});
