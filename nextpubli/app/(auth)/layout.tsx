import Link from "next/link";
import { Check } from "lucide-react";
import { INSTAGRAM_ENABLED } from "@/lib/flags";

const BENEFITS = INSTAGRAM_ENABLED
  ? [
      "A gente publica por você — stories, feed e reels",
      "Comissão recorrente a cada venda pelo seu link",
      "Conecte seu Instagram em menos de 1 minuto",
    ]
  : [
      "Seu link exclusivo em menos de 1 minuto",
      "Comissão recorrente a cada venda pelo seu link",
      "Acompanhe cliques, vendas e ganhos em tempo real",
    ];

const HEADLINE = INSTAGRAM_ENABLED ? (
  <>
    Seu Instagram
    <br />
    vale dinheiro.
  </>
) : (
  <>
    Sua audiência
    <br />
    vale dinheiro.
  </>
);

const SUBTITLE = INSTAGRAM_ENABLED
  ? "Você cuida do conteúdo, a gente cuida do resto. Transforme seus seguidores em renda recorrente."
  : "Indique produtos que você ama e receba comissão por cada venda. Simples assim.";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[420px] shrink-0 flex-col justify-between bg-background-secondary px-10 py-10 lg:flex">
        <Link href="/">
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

        <div>
          <h2 className="text-3xl font-bold leading-tight text-foreground">{HEADLINE}</h2>
          <p className="mt-4 text-foreground-secondary">{SUBTITLE}</p>

          <ul className="mt-8 space-y-3">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit}
                className="flex items-start gap-3 text-sm text-foreground"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15">
                  <Check size={13} className="text-success" />
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-accent" />
          <div className="h-1.5 flex-1 rounded-full bg-border" />
          <div className="h-1.5 flex-1 rounded-full bg-border" />
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        {children}
      </main>
    </div>
  );
}
