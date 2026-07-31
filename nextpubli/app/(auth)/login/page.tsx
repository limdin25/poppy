import Link from "next/link";
import { EmailLoginForm, PasswordLoginForm } from "@/features/email-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; modo?: string }>;
}) {
  const { erro, modo } = await searchParams;
  const passwordMode = modo === "senha";

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
        <h1 className="text-3xl font-bold text-foreground">Bem-vindo de volta</h1>
        <p className="mt-2 text-foreground-secondary">
          {passwordMode
            ? "Entre com seu email e senha."
            : "Digite seu email e enviamos um link de acesso — sem senha."}
        </p>
      </div>

      {erro && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{erro}</div>
      )}

      {passwordMode ? <PasswordLoginForm /> : <EmailLoginForm />}

      <div className="space-y-2 text-sm text-foreground-secondary">
        <p>
          {passwordMode ? (
            <Link href="/login" className="font-medium text-accent hover:underline">
              Entrar com link por email
            </Link>
          ) : (
            <Link
              href="/login?modo=senha"
              className="font-medium text-accent hover:underline"
            >
              Entrar com senha
            </Link>
          )}
        </p>
        <p>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="font-medium text-accent hover:underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  );
}
