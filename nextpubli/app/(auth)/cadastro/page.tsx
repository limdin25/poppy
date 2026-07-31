import Link from "next/link";
import { cookies } from "next/headers";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import { EmailSignupForm } from "@/features/email-signup";
import { IgSignupForm } from "@/features/ig-login";
import { SIGNUP_COOKIE } from "@/lib/ig-auth-cookies";

// If a previous signup attempt failed mid-Instagram, the typed form data is
// still in the (httpOnly) signup cookie — prefill it so nothing is retyped.
function readSignupDefaults(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw);
    return {
      first_name: typeof d?.first_name === "string" ? d.first_name : undefined,
      last_name: typeof d?.last_name === "string" ? d.last_name : undefined,
      email: typeof d?.email === "string" ? d.email : undefined,
      whatsapp: typeof d?.whatsapp === "string" ? d.whatsapp : undefined,
    };
  } catch {
    return undefined;
  }
}

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const cookieStore = await cookies();
  const defaults = readSignupDefaults(cookieStore.get(SIGNUP_COOKIE)?.value);

  return (
    <div className="w-full max-w-md space-y-8">
      <div>
        <Link href="/" className="lg:hidden mb-6 inline-block">
          <span
            className="text-2xl font-bold"
            style={{
              background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            NextPubli
          </span>
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Crie sua conta</h1>
        <p className="mt-2 text-foreground-secondary">
          {INSTAGRAM_ENABLED
            ? "Comece a ganhar com o seu Instagram"
            : "Comece a ganhar indicando produtos que você ama"}
        </p>
      </div>

      {erro && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{erro}</div>
      )}

      {INSTAGRAM_ENABLED ? <IgSignupForm defaults={defaults} /> : <EmailSignupForm />}

      {INSTAGRAM_ENABLED && (
        <p className="text-xs text-foreground-secondary">
          Use uma conta Profissional do Instagram (Criador ou Empresa).{" "}
          <a
            href="https://www.instagram.com/accounts/convert_to_professional_account/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent hover:underline"
          >
            Ativar agora
          </a>{" "}
          — é grátis.
        </p>
      )}

      <p className="text-sm text-foreground-secondary">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
