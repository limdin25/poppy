import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The /watch beacon. Public on purpose: the page has no login, so this route
 * cannot demand one. What keeps it from being a garbage hose:
 *   - event names are allowlisted (the CHECK in migration 026 backstops it),
 *   - session ids are length-capped random strings, not user data,
 *   - meta is capped small, so nobody can store a novel in our table.
 * Analytics rows are append-only noise at worst; nothing reads them back into
 * product behaviour.
 */

const EVENTS = new Set([
  "view",
  "play",
  "watch_50",
  "watch_90",
  "ended",
  "cta_click",
  "demo_play",
]);

export async function POST(request: Request) {
  let body: { session?: unknown; event?: unknown; meta?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const session = String(body.session ?? "");
  const event = String(body.event ?? "");
  if (session.length < 8 || session.length > 64 || !/^[a-z0-9-]+$/i.test(session)) {
    return NextResponse.json({ error: "bad session" }, { status: 400 });
  }
  if (!EVENTS.has(event)) {
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  }

  let meta: Record<string, unknown> = {};
  if (body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)) {
    const raw = JSON.stringify(body.meta);
    if (raw.length <= 500) meta = body.meta as Record<string, unknown>;
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("watch_events") as any).insert({
    session_id: session,
    event,
    meta,
  });
  if (error) {
    console.error("[watch] event insert failed", error);
    return NextResponse.json({ error: "storage" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
