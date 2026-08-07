// Reading Meta's lead sheet. Meta's own "Connect to Google Sheets" CRM integration
// appends one row per lead-form submission; this module turns that CSV into clean lead
// candidates. Pure functions only, so the whole thing is unit-testable without I/O.
//
// Shape facts, learned from the live sheet on 07 Aug 2026:
// - ids arrive prefixed: leads "l:123...", forms "f:456...". Phones arrive "p:+91...".
// - Meta's test submission fills fields with "<test lead: dummy data for ...>" and the
//   email test@meta.com. It must never become a real lead.
// - Deleting a lead in Meta leaves a padding row with only lead_status filled in.

export interface SheetLead {
  leadgenId: string;
  createdTime: string | null;
  formId: string | null;
  adId: string | null;
  campaignId: string | null;
  firstName: string;
  phone: string;
  email: string;
}

/** Minimal CSV parser: quotes, escaped quotes, CRLF, newlines inside quoted fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const stripPrefix = (v: string) => v.replace(/^[a-z]:/, "").trim();

/**
 * STRICT on purpose: only a number that already declares its country (+ or 00) is
 * accepted. Blindly prefixing "+" onto bare digits re-creates the exact bug the CRM's
 * own normalizeE164 refuses: an Indian mobile typed nationally as 9824840910 becomes
 * +9824840910, which is a number in Iran, and a marketing template goes to a stranger.
 * A dropped lead is visible in the monitor email; a text to the wrong human is not
 * recoverable at all.
 */
function normalizePhone(raw: string): string {
  const s = stripPrefix(raw).replace(/[^\d+]/g, "");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8) return "";
  if (s.startsWith("+") && !s.slice(1).startsWith("0")) return "+" + digits;
  if (s.startsWith("00")) return "+" + digits.replace(/^00/, "");
  return "";
}

function isMetaTestRow(fields: Record<string, string>): boolean {
  return (
    Object.values(fields).some((v) => v.includes("test lead")) ||
    fields.email.trim().toLowerCase() === "test@meta.com"
  );
}

export interface SheetParseResult {
  leads: SheetLead[];
  droppedBadPhone: number;
  droppedBadEmail: number;
  droppedTest: number;
}

/**
 * Header-driven mapping: column ORDER in the sheet is Meta's to change, names are not.
 * Returns only rows that could be a real, contactable person, and COUNTS what it drops:
 * if Meta starts writing phones in a shape we refuse, the monitor email must show leads
 * disappearing, not a quietly empty funnel.
 */
export function sheetRowsToLeads(rows: string[][]): SheetParseResult {
  const result: SheetParseResult = {
    leads: [],
    droppedBadPhone: 0,
    droppedBadEmail: 0,
    droppedTest: 0,
  };
  if (rows.length < 2) return result;
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const col = (row: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };

  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const fields = {
      id: col(row, "id"),
      created_time: col(row, "created_time"),
      form_id: col(row, "form_id"),
      ad_id: col(row, "ad_id"),
      campaign_id: col(row, "campaign_id"),
      first_name: col(row, "first_name"),
      phone: col(row, "phone"),
      email: col(row, "email"),
    };
    const leadgenId = stripPrefix(fields.id);
    if (!leadgenId) continue;
    if (isMetaTestRow(fields)) {
      result.droppedTest++;
      continue;
    }
    if (seen.has(leadgenId)) continue;

    const phone = normalizePhone(fields.phone);
    if (!phone) {
      result.droppedBadPhone++;
      continue;
    }
    const email = fields.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.droppedBadEmail++;
      continue;
    }

    seen.add(leadgenId);
    result.leads.push({
      leadgenId,
      createdTime: fields.created_time || null,
      formId: stripPrefix(fields.form_id) || null,
      adId: stripPrefix(fields.ad_id) || null,
      campaignId: stripPrefix(fields.campaign_id) || null,
      firstName: fields.first_name.trim() || "there",
      phone,
      email,
    });
  }
  return result;
}
