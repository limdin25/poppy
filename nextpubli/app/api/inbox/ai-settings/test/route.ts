import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const { apiKey, model } = (await req.json()) as {
    apiKey: string;
    model: string;
  };

  if (!apiKey) {
    return NextResponse.json({ error: "Chave API obrigatória" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        max_tokens: 50,
        messages: [
          {
            role: "system",
            content: "Responda em português, em uma frase curta.",
          },
          { role: "user", content: "Olá, este é um teste de conexão." },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `OpenAI retornou ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const reply = json.choices?.[0]?.message?.content || "Sem resposta";

    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Erro ao conectar",
      },
      { status: 500 },
    );
  }
}
