import { NextResponse } from "next/server";
import { parseCsv, sheetRowsToLeads } from "@/lib/data/fb-sheet";
import { armFreshPartnerLead } from "@/lib/data/lead-arming";
import { resolveLeadLane, queueSkoolInvite } from "@/lib/data/lanes";
import { pitchBlockedForPhone } from "@/lib/data/reply-brain";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SignupLead } from "@/types/database";

export const maxDuration = 120;

// Meta lead form -> Google Sheet -> HERE -> signup_leads, every minute.
//
// Why a sheet and not a webhook: Meta's own "Connect to Google Sheets" CRM integration
// writes the sheet directly, costs zero Zapier tasks, and is how the ads account was
// actually wired on 07 Aug 2026. The signed /api/webhooks/fb-leads route still exists;
// both paths are idempotent on fb_leadgen_id and both arm leads through the SAME
// armFreshPartnerLead, so whichever path sees a lead first, the rules are identical.
//
// Recovery is part of the design, not an afterthought: inserting and arming are two
// separate writes, and a crash between them used to strand the lead in 'idle' forever
// (the dedupe skip meant no later run ever looked at them again). So arming is done by
// SWEEP: every run arms every fb_lead_form lead still sitting idle, not just the ones
// this run inserted.
//
// Speed rule (Hugo, 07 Aug 2026): "as soon as they come we message them." Arming sets
// nurture_next_at to NOW, and when anything was armed this run POKES THE TICK instead
// of waiting for its 5 minute schedule, so the welcome leaves within the same minute
// the lead appears in the sheet.

function sheetUrl(): string | null {
  // No hardcoded fallback. The sheet is public-by-link, so its ID is a capability URL
  // to every lead's name, phone and email; it lives in env, never in the repo.
  const id = process.env.FB_LEADS_SHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` : null;
}

async function recordHealth(
  admin: ReturnType<typeof createAdminClient>,
  error: string | null,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("funnel_monitor_state") as any).upsert({
    id: "default",
    sheet_sync_last_ok_at: error ? undefined : new Date().toISOString(),
    sheet_sync_last_error: error,
    updated_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const url = sheetUrl();
  if (!url) {
    await recordHealth(admin, "FB_LEADS_SHEET_ID not set");
    return NextResponse.json({ ok: false, error: "FB_LEADS_SHEET_ID not set" }, { status: 500 });
  }

  let csv: string;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      await recordHealth(admin, `sheet fetch ${res.status}`);
      return NextResponse.json({ ok: false, error: `sheet fetch ${res.status}` }, { status: 502 });
    }
    csv = await res.text();
  } catch (e) {
    const msg = `sheet fetch failed: ${e instanceof Error ? e.message : "network"}`;
    await recordHealth(admin, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const parsed = sheetRowsToLeads(parseCsv(csv));
  const report = {
    rows: parsed.leads.length,
    droppedBadPhone: parsed.droppedBadPhone,
    droppedBadEmail: parsed.droppedBadEmail,
    alreadyKnown: 0,
    refusedBlockedCountry: 0,
    inserted: 0,
    conflicts: 0,
    armed: 0,
    engaged: 0,
    blocked: 0,
    errors: [] as string[],
  };

  // ---- Phase 1: make every sheet row exist as a lead. ----
  if (parsed.leads.length) {
    const { data: known, error: knownErr } = await admin
      .from("signup_leads")
      .select("fb_leadgen_id")
      .in("fb_leadgen_id", parsed.leads.map((c) => c.leadgenId))
      .returns<{ fb_leadgen_id: string }[]>();
    if (knownErr) {
      await recordHealth(admin, "could not read signup_leads");
      return NextResponse.json({ ok: false, error: "could not read signup_leads" }, { status: 500 });
    }
    const knownIds = new Set((known ?? []).map((k) => k.fb_leadgen_id));

    for (const lead of parsed.leads) {
      if (knownIds.has(lead.leadgenId)) {
        report.alreadyKnown++;
        continue;
      }
      // THE DOOR. Hugo, 07 Aug 2026, on India: "just block and delete everyone,
      // we are not running ads there anymore." A blocked-country row is refused
      // at import: no lead row, no CRM contact, no Skool invite, no drip. This
      // also stops the sheet re-importing the leads deleted that day, whose rows
      // are still in the sheet forever. Counted, and shown in the monitor email.
      if (pitchBlockedForPhone(lead.phone)) {
        report.refusedBlockedCountry++;
        continue;
      }
      const result = await resolveLeadLane({
        firstName: lead.firstName,
        lastName: "",
        email: lead.email,
        whatsapp: lead.phone,
        lane: "partner",
        source: "fb_lead_form",
        fb: {
          leadgenId: lead.leadgenId,
          formId: lead.formId ?? undefined,
          adId: lead.adId ?? undefined,
          campaignId: lead.campaignId ?? undefined,
        },
        consentAt: lead.createdTime ?? undefined,
      });
      if (!result.ok || !result.leadId) {
        report.errors.push(`${lead.leadgenId}: storage failed`);
        continue;
      }
      if (result.outcome === "conflict" || result.outcome === "kept") {
        // The person already existed. Stamp the leadgen id onto their row (when free)
        // so next minute's dedupe recognises this sheet row; without this, a kept or
        // conflicted row was re-resolved every single minute forever, and the conflict
        // path filed a fresh lane_conflicts row each time.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("signup_leads") as any)
          .update({ fb_leadgen_id: lead.leadgenId })
          .eq("id", result.leadId)
          .is("fb_leadgen_id", null);
        if (result.outcome === "conflict") report.conflicts++;
        continue;
      }
      report.inserted++;
      // Community first, exactly like the webhook path.
      if (result.lane === "partner") await queueSkoolInvite(result.leadId);
    }
  }

  // ---- Phase 2: sweep-arm EVERY idle form lead, whoever inserted it, whenever. ----
  // Covers this run's inserts, a crashed earlier run, and webhook inserts alike. Only
  // the last 48h: anything older is stale enough that a cold open needs a human call.
  const { data: idle } = await admin
    .from("signup_leads")
    .select("id, first_name, whatsapp_e164, whatsapp")
    .eq("source", "fb_lead_form")
    .eq("nurture_state", "idle")
    .is("whatsapp_opted_out_at", null)
    .gte("first_seen_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString())
    .limit(50)
    .returns<Pick<SignupLead, "id" | "first_name" | "whatsapp_e164" | "whatsapp">[]>();

  for (const lead of idle ?? []) {
    const phone = lead.whatsapp_e164 ?? lead.whatsapp;
    if (!phone) continue;
    try {
      const armed = await armFreshPartnerLead(admin, {
        id: lead.id,
        phone,
        firstName: lead.first_name,
      });
      if (armed.outcome === "armed") report.armed++;
      if (armed.outcome === "engaged") report.engaged++;
      if (armed.outcome === "blocked") report.blocked++;
      if (armed.degraded) report.errors.push(`${lead.id}: contact_state unreachable, armed anyway`);
    } catch (e) {
      report.errors.push(`${lead.id}: arm failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // Somebody was just armed with next_at = now: poke the tick rather than letting the
  // welcome sit for up to 5 minutes. Failure is harmless, the schedule is the retry.
  let tickPoked = false;
  if (report.armed > 0) {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://heypubli.com";
      const res = await fetch(`${base}/api/funnel/tick`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        signal: AbortSignal.timeout(60000),
      });
      tickPoked = res.ok;
    } catch {
      // The 5 minute schedule picks it up.
    }
  }

  await recordHealth(admin, report.errors.length ? report.errors.join("; ").slice(0, 500) : null);
  // The refused count rides on the health row so the monitor email can say it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("funnel_monitor_state") as any)
    .update({ sheet_sync_last_refused_blocked: report.refusedBlockedCountry })
    .eq("id", "default");
  return NextResponse.json({ ok: true, ...report, tickPoked });
}
