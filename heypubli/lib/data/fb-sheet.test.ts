import { describe, expect, it } from "vitest";
import { parseCsv, sheetRowsToLeads } from "./fb-sheet";

// The header row Meta's own "Connect to Google Sheets" integration writes, captured from
// the live sheet on 07 Aug 2026.
const HEADER =
  "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,first_name,phone,email,lead_status";

describe("parseCsv", () => {
  it("splits plain rows on commas", () => {
    const rows = parseCsv("a,b,c\n1,2,3");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("respects quoted fields containing commas and quotes", () => {
    const rows = parseCsv('name,note\n"Singh, Aman","said ""hi"" twice"');
    expect(rows[1]).toEqual(["Singh, Aman", 'said "hi" twice']);
  });

  it("handles CRLF line endings and a trailing newline", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a newline inside a quoted field in one row", () => {
    const rows = parseCsv('a,b\n"line1\nline2",2');
    expect(rows).toEqual([
      ["a", "b"],
      ["line1\nline2", "2"],
    ]);
  });
});

describe("sheetRowsToLeads", () => {
  const row = (over: Partial<Record<string, string>> = {}) => {
    const base: Record<string, string> = {
      id: "l:1373385458087305",
      created_time: "2026-08-07T08:21:55-05:00",
      form_id: "f:989044287500286",
      form_name: "1- IG - form-email",
      first_name: "Aman",
      phone: "p:+919876543210",
      email: "aman@example.com",
      lead_status: "",
    };
    const merged = { ...base, ...over };
    const headers = HEADER.split(",");
    return headers.map((h) => merged[h] ?? "");
  };

  it("maps a real lead, stripping the l:/p:/f: prefixes Meta adds", () => {
    const { leads } = sheetRowsToLeads([HEADER.split(","), row()]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      leadgenId: "1373385458087305",
      formId: "989044287500286",
      firstName: "Aman",
      phone: "+919876543210",
      email: "aman@example.com",
    });
  });

  it("drops Meta's own test lead by its dummy markers, and counts it", () => {
    const r = sheetRowsToLeads([
      HEADER.split(","),
      row({
        first_name: "<test lead: dummy data for first_name>",
        phone: "p:<test lead: dummy data for phone>",
        email: "test@meta.com",
      }),
    ]);
    expect(r.leads).toEqual([]);
    expect(r.droppedTest).toBe(1);
  });

  it("does NOT drop a real person whose name merely contains Test", () => {
    const r = sheetRowsToLeads([HEADER.split(","), row({ first_name: "Testimony" })]);
    expect(r.leads).toHaveLength(1);
  });

  it("drops rows without an id (the blank padding rows Meta leaves behind)", () => {
    const r = sheetRowsToLeads([HEADER.split(","), row({ id: "" })]);
    expect(r.leads).toEqual([]);
  });

  it("REFUSES phones that do not declare a country, and counts the drop", () => {
    // Bare national digits: +-prefixing 9824840910 invents a number in Iran.
    expect(sheetRowsToLeads([HEADER.split(","), row({ phone: "9824840910" })]).droppedBadPhone).toBe(1);
    // National format with trunk zero.
    expect(sheetRowsToLeads([HEADER.split(","), row({ phone: "09824840910" })]).droppedBadPhone).toBe(1);
    // A + followed by a zero is not a real country code either.
    expect(sheetRowsToLeads([HEADER.split(","), row({ phone: "+01712345678" })]).droppedBadPhone).toBe(1);
    // Empty.
    expect(sheetRowsToLeads([HEADER.split(","), row({ phone: "p:" })]).droppedBadPhone).toBe(1);
  });

  it("accepts + and 00 international forms, with spaces and punctuation", () => {
    expect(sheetRowsToLeads([HEADER.split(","), row({ phone: "p:+91 98765 43210" })]).leads[0].phone).toBe("+919876543210");
    expect(sheetRowsToLeads([HEADER.split(","), row({ phone: "00919876543210" })]).leads[0].phone).toBe("+919876543210");
  });

  it("drops rows with an invalid email, they cannot enter the lane machine", () => {
    expect(sheetRowsToLeads([HEADER.split(","), row({ email: "not-an-email" })]).droppedBadEmail).toBe(1);
    expect(sheetRowsToLeads([HEADER.split(","), row({ email: "" })]).droppedBadEmail).toBe(1);
  });

  it("trims whitespace and ignores duplicate leadgen ids inside one batch", () => {
    const { leads } = sheetRowsToLeads([
      HEADER.split(","),
      row({ first_name: "  Aman  " }),
      row(),
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].firstName).toBe("Aman");
  });
});
