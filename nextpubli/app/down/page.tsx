"use client";

import { useState } from "react";
import Image from "next/image";

const WIDGET_CODE = `<!-- PASTE THE HOTMART WIDGET CODE HERE -->
<!-- Hotmart -> Tools -> Sales Funnel -> ScanPlates Upsell Funnel -> Widget Code -->
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
        <span>DEV: Downsell (Annual)</span>
        <button
          onClick={handleCopyCode}
          className="bg-white text-gray-600 px-3 py-0.5 rounded-full font-semibold text-[10px] border border-gray-200 hover:bg-gray-50 transition"
        >
          {copied ? "Copied!" : "Copy HTML"}
        </button>
      </div>

      {/* Warning Bar */}
      <div className="bg-[#1a1a1a] text-white text-center py-3 px-4">
        <p className="text-sm font-semibold tracking-wide">
          Wait, we have one last special offer for you
        </p>
      </div>

      {/* Hero */}
      <div className="max-w-2xl mx-auto px-6 pt-14 pb-8 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-gray-500 mb-4">
          Last chance, special offer
        </p>
        <h1 className="text-4xl md:text-5xl font-bold leading-[1.1] tracking-tight mb-5">
          Annual Plan at <span className="underline decoration-2">53% off</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-lg mx-auto">
          We understand the lifetime plan may be a big investment right now. So we have
          an incredible alternative for you.
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
          <p className="text-2xl md:text-3xl font-bold mb-2">5 days free to try it</p>
          <p className="text-gray-500">
            You <strong className="text-[#1a1a1a]">will not be charged now</strong>. Try
            it for 5 days. If you do not like it, cancel without paying anything.
          </p>
        </div>
      </div>

      {/* Savings Card */}
      <div className="max-w-lg mx-auto px-6 pb-10">
        <div className="border border-gray-200 rounded-2xl p-8">
          <h2 className="text-xl font-bold text-center mb-8">Compare and save</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Monthly Plan (12 months)</span>
              <span className="text-gray-400 line-through">R$ 708,00/year</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Monthly cost on the monthly plan</span>
              <span className="text-gray-400 line-through">R$ 59,00/month</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-4 mt-4">
            <div>
              <span className="font-bold text-lg">Annual Plan</span>
              <p className="text-gray-500 text-sm">Only R$ 28,00/month</p>
            </div>
            <span className="font-bold text-3xl">R$ 336,00</span>
          </div>

          <div className="mt-4 bg-[#1a1a1a] text-white rounded-xl p-5 text-center">
            <p className="font-bold text-2xl">Save R$ 372,00 per year</p>
            <p className="text-gray-300 text-sm mt-1">
              That is more than 6 months free compared to the monthly plan!
            </p>
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div className="max-w-lg mx-auto px-6 pb-10">
        <h3 className="text-lg font-bold mb-6 text-center">
          Everything included in the Annual Plan
        </h3>
        <div className="space-y-4">
          {[
            "AI calorie scanner, full access for 12 months",
            "Track calories, macronutrients and meals",
            "All updates during your subscription",
            "Save 53% compared to the monthly plan",
            "Full support for your entire subscription",
            "5 days free, cancel anytime",
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
            Hotmart widget, paste the code here
          </p>
          <div id="hotmart-widget" dangerouslySetInnerHTML={{ __html: WIDGET_CODE }} />
          <p className="text-gray-300 text-xs font-mono mt-4 uppercase tracking-widest">
            End of widget
          </p>
        </div>
      </div>

      {/* Trust */}
      <div className="max-w-lg mx-auto px-6 pb-6 text-center">
        <div className="flex items-center justify-center gap-8 text-gray-400 text-sm">
          <span>100% secure checkout</span>
          <span>5 days free</span>
          <span>Cancel anytime</span>
        </div>
      </div>

      {/* No thanks */}
      <div className="text-center pb-12">
        <p className="text-gray-400 text-xs underline cursor-pointer hover:text-gray-500 transition">
          No thanks, I want to keep my current plan
        </p>
      </div>

      <p className="text-gray-300 text-xs text-center pb-8">
        ScanPlates &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}
