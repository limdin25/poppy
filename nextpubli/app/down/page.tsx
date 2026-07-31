"use client";

import { useState } from "react";
import Image from "next/image";

const WIDGET_CODE = `<!-- COLE O CÓDIGO DO WIDGET HOTMART AQUI -->
<!-- Hotmart → Ferramentas → Funil de Vendas → ScanPlates Upsell Funnel → Código do Widget -->
<script src="https://static.hotmart.com/checkout/widget.min.js"></script>
<div class="hotmart-fb"></div>`;

export default function DownsellPage() {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    const el = document.documentElement.outerHTML;
    await navigator.clipboard.writeText(el);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white text-[#1a1a1a] font-[system-ui]">
      {/* DEV */}
      <div className="bg-gray-100 text-gray-500 text-center py-1.5 px-4 text-xs flex items-center justify-center gap-3">
        <span>DEV: Downsell (Anual)</span>
        <button
          onClick={handleCopyCode}
          className="bg-white text-gray-600 px-3 py-0.5 rounded-full font-semibold text-[10px] border border-gray-200 hover:bg-gray-50 transition"
        >
          {copied ? "Copiado!" : "Copiar HTML"}
        </button>
      </div>

      {/* Warning Bar */}
      <div className="bg-[#1a1a1a] text-white text-center py-3 px-4">
        <p className="text-sm font-semibold tracking-wide">
          Espere — temos uma última oferta especial para você
        </p>
      </div>

      {/* Hero */}
      <div className="max-w-2xl mx-auto px-6 pt-14 pb-8 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-gray-500 mb-4">
          Última chance — oferta especial
        </p>
        <h1 className="text-4xl md:text-5xl font-bold leading-[1.1] tracking-tight mb-5">
          Plano Anual com <span className="underline decoration-2">53% de desconto</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-lg mx-auto">
          Entendemos que o plano vitalício pode ser um investimento alto agora. Por isso,
          temos uma alternativa incrível para você.
        </p>
      </div>

      {/* App Image */}
      <div className="max-w-3xl mx-auto px-6 pb-10">
        <Image
          src="https://www.scanplates.com/hero-image.png"
          alt="ScanPlates App"
          width={800}
          height={600}
          className="w-full h-auto rounded-2xl"
          unoptimized
        />
      </div>

      {/* 5-Day Trial */}
      <div className="max-w-lg mx-auto px-6 pb-10">
        <div className="bg-[#f5f5f5] rounded-2xl p-6 text-center">
          <p className="text-2xl md:text-3xl font-bold mb-2">5 dias grátis para testar</p>
          <p className="text-gray-500">
            Você <strong className="text-[#1a1a1a]">não será cobrado agora</strong>. Teste
            por 5 dias. Se não gostar, cancele sem pagar nada.
          </p>
        </div>
      </div>

      {/* Savings Card */}
      <div className="max-w-lg mx-auto px-6 pb-10">
        <div className="border border-gray-200 rounded-2xl p-8">
          <h2 className="text-xl font-bold text-center mb-8">Compare e economize</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Plano Mensal (12 meses)</span>
              <span className="text-gray-400 line-through">R$ 708,00/ano</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Custo mensal no plano mensal</span>
              <span className="text-gray-400 line-through">R$ 59,00/mês</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-4 mt-4">
            <div>
              <span className="font-bold text-lg">Plano Anual</span>
              <p className="text-gray-500 text-sm">Apenas R$ 28,00/mês</p>
            </div>
            <span className="font-bold text-3xl">R$ 336,00</span>
          </div>

          <div className="mt-4 bg-[#1a1a1a] text-white rounded-xl p-5 text-center">
            <p className="font-bold text-2xl">Economize R$ 372,00 por ano</p>
            <p className="text-gray-300 text-sm mt-1">
              Isso é mais de 6 meses grátis comparado ao plano mensal!
            </p>
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div className="max-w-lg mx-auto px-6 pb-10">
        <h3 className="text-lg font-bold mb-6 text-center">
          Tudo incluso no Plano Anual
        </h3>
        <div className="space-y-4">
          {[
            "Scanner de calorias por IA — acesso completo por 12 meses",
            "Acompanhe calorias, macronutrientes e refeições",
            "Todas as atualizações durante a assinatura",
            "Economize 53% comparado ao plano mensal",
            "Suporte completo durante toda a assinatura",
            "5 dias grátis — cancele a qualquer momento",
          ].map((benefit) => (
            <div key={benefit} className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-[#1a1a1a] mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span className="text-gray-600">{benefit}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Widget Placeholder */}
      <div className="max-w-lg mx-auto px-6 pb-10">
        <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center">
          <p className="text-gray-400 text-xs font-mono mb-4 uppercase tracking-widest">
            Widget Hotmart — cole o código aqui
          </p>
          <div id="hotmart-widget" dangerouslySetInnerHTML={{ __html: WIDGET_CODE }} />
          <p className="text-gray-300 text-xs font-mono mt-4 uppercase tracking-widest">
            Fim do Widget
          </p>
        </div>
      </div>

      {/* Trust */}
      <div className="max-w-lg mx-auto px-6 pb-6 text-center">
        <div className="flex items-center justify-center gap-8 text-gray-400 text-sm">
          <span>Compra 100% segura</span>
          <span>5 dias grátis</span>
          <span>Cancele quando quiser</span>
        </div>
      </div>

      {/* No thanks */}
      <div className="text-center pb-12">
        <p className="text-gray-400 text-xs underline cursor-pointer hover:text-gray-500 transition">
          Não obrigado, quero continuar com o plano atual
        </p>
      </div>

      <p className="text-gray-300 text-xs text-center pb-8">
        ScanPlates &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}
