import { createAdminClient } from "@/lib/supabase/admin";
import type { AiSettings } from "@/types/database";

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "- ");
}

export async function getAiSettings(): Promise<AiSettings | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("ai_settings").select("*").limit(1).single();
  return (data as AiSettings | null) ?? null;
}

export async function getConversationHistory(
  conversationId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("inbox_messages")
    .select("body, sender")
    .eq("conversation_id", conversationId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!rows || rows.length === 0) return [];

  return (rows as Array<{ body: string | null; sender: string }>).reverse().map((m) => ({
    role: (m.sender === "contact" ? "user" : "assistant") as "user" | "assistant",
    content: (m.body || "").slice(0, 2000),
  }));
}

export async function generateAIReply(conversationId: string): Promise<string | null> {
  const settings = await getAiSettings();
  if (!settings?.openai_api_key) return null;

  const history = await getConversationHistory(conversationId);
  if (history.length === 0) return null;

  const systemPrompt = buildSystemPrompt(settings.system_prompt);

  let messages = history;
  if (messages[0]?.role === "assistant") {
    messages = [{ role: "user", content: "(previous message)" }, ...messages];
  }

  const body = {
    model: settings.model || "gpt-4o-mini",
    max_tokens: settings.max_tokens || 500,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openai_api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(
      "[ai-reply] OpenAI error:",
      res.status,
      await res.text().catch(() => ""),
    );
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  const raw = json.choices?.[0]?.message?.content || "";
  return stripMarkdown(raw) || null;
}

export async function rewriteAIReply(conversationId: string): Promise<string | null> {
  const settings = await getAiSettings();
  if (!settings?.openai_api_key) return null;

  const history = await getConversationHistory(conversationId);
  if (history.length === 0) return null;

  const systemPrompt =
    buildSystemPrompt(settings.system_prompt) +
    "\n\nWRITE a reply that is DIFFERENT from the previous one. Vary the approach and vocabulary.";

  let messages = history;
  if (messages[0]?.role === "assistant") {
    messages = [{ role: "user", content: "(previous message)" }, ...messages];
  }

  const body = {
    model: settings.model || "gpt-4o-mini",
    max_tokens: settings.max_tokens || 500,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openai_api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  const raw = json.choices?.[0]?.message?.content || "";
  return stripMarkdown(raw) || null;
}

function buildSystemPrompt(customPrompt: string): string {
  let prompt =
    "You are a WhatsApp support assistant for HeyPubli, a micro-influencer platform.\n" +
    "Rules:\n" +
    "- Reply in English\n" +
    "- Be brief, casual and direct. This is WhatsApp, not email\n" +
    "- NEVER use markdown formatting (no **, ##, etc). Plain text only.\n" +
    "- NEVER use placeholders like [Name] or [Your Name]\n" +
    "- Keep replies short (1-3 sentences)";

  if (customPrompt?.trim()) {
    prompt += `\n\n## Custom admin instructions\n${customPrompt.trim()}`;
  }

  return prompt;
}
