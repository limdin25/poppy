import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();

  if (!profile?.is_admin)
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

  const body = (await req.json()) as {
    openai_api_key?: string;
    system_prompt?: string;
    model?: string;
    max_tokens?: number;
    auto_reply_enabled?: boolean;
    draft_mode?: boolean;
    auto_reply_delay_seconds?: number;
  };

  const admin = createAdminClient();

  // Update ai_settings
  const { data: existing } = await admin
    .from("ai_settings")
    .select("id")
    .limit(1)
    .single();

  const aiData = {
    ...(body.openai_api_key !== undefined ? { openai_api_key: body.openai_api_key } : {}),
    ...(body.system_prompt !== undefined ? { system_prompt: body.system_prompt } : {}),
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("ai_settings") as any)
      .update(aiData)
      .eq("id", (existing as { id: string }).id);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("ai_settings") as any).insert(aiData);
  }

  // Update channel settings
  if (
    body.auto_reply_enabled !== undefined ||
    body.draft_mode !== undefined ||
    body.auto_reply_delay_seconds !== undefined
  ) {
    const channelData: Record<string, unknown> = {};
    if (body.auto_reply_enabled !== undefined)
      channelData.auto_reply_enabled = body.auto_reply_enabled;
    if (body.draft_mode !== undefined) channelData.draft_mode = body.draft_mode;
    if (body.auto_reply_delay_seconds !== undefined)
      channelData.auto_reply_delay_seconds = body.auto_reply_delay_seconds;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("channels") as any)
      .update(channelData)
      .eq("type", "whatsapp")
      .eq("status", "connected");
  }

  return NextResponse.json({ ok: true });
}
