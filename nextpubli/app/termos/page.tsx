import Link from "next/link";
import { TermsContent } from "@/features/ig-login";

export const metadata = {
  title: "Termos de Uso | NextPubli",
};

export default function TermosPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/cadastro" className="text-sm text-accent hover:underline">
        ← Voltar
      </Link>
      <h1 className="mt-6 mb-6 text-3xl font-bold text-foreground">Termos de Uso</h1>
      <TermsContent />
    </main>
  );
}
