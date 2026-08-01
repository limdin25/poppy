import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rewriteAIReply } from "@/lib/ai/reply";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();

  if (!profile?.is_admin)
    return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { messageId } = (await req.json()) as { messageId: string };
  if (!messageId)
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: msg } = await (admin.from("inbox_messages") as any)
    .select("id, conversation_id, status")
    .eq("id", messageId)
    .single();

  if (!msg || (msg as { status: string }).status !== "draft") {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const m = msg as { id: string; conversation_id: string };

  const newBody = await rewriteAIReply(m.conversation_id);
  if (!newBody)
    return NextResponse.json(
      { error: "Could not generate a new reply" },
      { status: 502 },
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("inbox_messages") as any)
    .update({ body: newBody })
    .eq("id", messageId);

  return NextResponse.json({ ok: true, body: newBody });
}
