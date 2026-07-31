"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitBrandInquiry } from "@/lib/actions/brand-inquiry";
import { landingCopy } from "@/features/landing-page/copy";

const IG_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
);

export default function ParaMarcasPage() {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await submitBrandInquiry(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
      }
    });
  };

  return (
    <div className="min-h-screen bg-foreground">
      <nav className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
              NextPubli
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-sm text-white/60 transition-colors hover:text-white"
            >
              Para Influenciadores
            </Link>
            <Link
              href="/login"
              className="text-sm text-white/60 transition-colors hover:text-white"
            >
              Entrar
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-16 md:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-white/80">
              {IG_ICON}
              Para Marcas
            </div>

            <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
              Alcance{" "}
              <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
                micro-influenciadores
              </span>{" "}
              autênticos
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/60">
              Publique conteúdo diretamente no feed e stories de milhares de
              influenciadores. Pague apenas por resultado, comissão sobre vendas reais.
            </p>

            <ul className="mt-8 space-y-4">
              {[
                "Acesso a 2.500+ influenciadores verificados no Brasil",
                "Publicação automática via API, sem depender do criador",
                "Pagamento por performance: até 50% de comissão por venda",
                "Dashboard completo com métricas em tempo real",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-white/70">
                  <svg
                    className="mt-0.5 h-5 w-5 shrink-0 text-accent"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
            {success ? (
              <div className="space-y-4 text-center py-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                  <svg
                    className="h-8 w-8 text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white">Solicitação enviada!</h2>
                <p className="text-sm text-white/50">
                  Entraremos em contato em até 24 horas.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-white">Fale com nosso time</h2>
                <p className="mt-2 text-sm text-white/50">
                  Preencha o formulário e entraremos em contato em até 24 horas.
                </p>

                {error && (
                  <div className="mt-4 rounded-lg bg-red-500/20 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-white/70">
                        Seu nome
                      </label>
                      <input
                        name="name"
                        type="text"
                        required
                        placeholder="Maria Silva"
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-white/70">
                        Email corporativo
                      </label>
                      <input
                        name="email"
                        type="email"
                        required
                        placeholder="maria@marca.com"
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/70">
                      Nome da marca
                    </label>
                    <input
                      name="brand_name"
                      type="text"
                      required
                      placeholder="Sua marca"
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/70">
                      Instagram da marca
                    </label>
                    <input
                      name="instagram"
                      type="text"
                      placeholder="@suamarca"
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/70">Mensagem</label>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="Conte-nos sobre seus objetivos..."
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="w-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:shadow-xl hover:shadow-accent/30 disabled:opacity-50"
                  >
                    {isPending ? "Enviando..." : "Enviar solicitação"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-lg font-bold text-transparent">
              NextPubli
            </span>
            <div className="flex items-center gap-6">
              <span className="text-sm text-white/40">
                Contato: {landingCopy.footer.emails.brands}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="#"
                className="text-xs text-white/30 transition-colors hover:text-white/60"
              >
                {landingCopy.footer.legal.terms}
              </a>
              <a
                href="#"
                className="text-xs text-white/30 transition-colors hover:text-white/60"
              >
                {landingCopy.footer.legal.privacy}
              </a>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-white/20">
            {landingCopy.footer.copyright}
          </p>
        </div>
      </footer>
    </div>
  );
}
