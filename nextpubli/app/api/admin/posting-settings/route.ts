import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { savePostingSettings, getPostingSettings } from "@/lib/data/outstand";
import { isSchedulingTimezone } from "@/lib/timezone";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autorizado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!(profile as { is_admin: boolean } | null)?.is_admin) {
    throw new Error("Não autorizado");
  }
}

function errorResponse(err: unknown) {
  if (err instanceof Error && err.message === "Não autorizado") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  console.error("[posting-settings]", err);
  return NextResponse.json({ error: "Erro interno" }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    const settings = await getPostingSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = await request.json();
    const params: {
      active_provider: string;
      outstand_social_network_id: string | null;
      outstand_api_key?: string;
      default_timezone?: string;
    } = {
      active_provider: body.active_provider,
      outstand_social_network_id: body.outstand_social_network_id ?? null,
    };
    // Only overwrite the stored key when a new one was actually submitted.
    if (typeof body.outstand_api_key === "string" && body.outstand_api_key.trim()) {
      params.outstand_api_key = body.outstand_api_key.trim();
    }
    if (
      typeof body.default_timezone === "string" &&
      isSchedulingTimezone(body.default_timezone)
    ) {
      params.default_timezone = body.default_timezone;
    }
    await savePostingSettings(params);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
