import { VideoPlayer } from "./VideoPlayer";
import { WhatsAppCta } from "./WhatsAppCta";
import { DemoTracker } from "./DemoTracker";
import { watchCopy as t } from "./copy";

/**
 * The page a WhatsApp lead is sent before onboarding. Hugo's shape, verbatim:
 * "they're gonna watch the video explaining how it works... then below earning
 * potential, then they have the calculator... then the button yes I want to
 * move forward, back to WhatsApp... below the videos so they can see which
 * videos you have. Then we have the button again."
 *
 * One straight column, mobile first, nothing to click except play and yes.
 * The calculator and the demo wall arrive as slots from the page, because
 * both already live in the landing feature and features never import features.
 */

const PAPER = "#FAF7F2";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[28px] font-black leading-[1.05] tracking-tight text-[#1A1A1A] sm:text-[36px]">
      {children}
    </h2>
  );
}

export function WatchPage({
  calculator,
  demos,
}: {
  calculator: React.ReactNode;
  demos: React.ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: PAPER }}>
      <div className="mx-auto w-full max-w-[44rem] px-4 pb-24 pt-8 sm:px-8 sm:pt-14">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6B7280]">
          {t.hero.eyebrow}
        </p>
        <h1 className="mt-3 text-[40px] font-black leading-[0.95] tracking-tighter text-[#1A1A1A] sm:text-[60px]">
          {t.hero.title}
        </h1>
        <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.55] text-[#6B7280] sm:text-[19px]">
          {t.hero.sub}
        </p>

        <div className="mt-7">
          <VideoPlayer />
        </div>

        <section className="mt-14" aria-labelledby="watch-earnings">
          <div id="watch-earnings">
            <SectionHeading>{t.earnings.heading}</SectionHeading>
          </div>
          <p className="mt-3 max-w-[62ch] text-[16px] leading-[1.6] text-[#1A1A1A]">
            {t.earnings.intro}
          </p>
          <div className="mt-6" data-testid="watch-calculator">
            {calculator}
          </div>
        </section>

        <section className="mt-14 rounded-3xl bg-white p-6 sm:p-8" data-testid="watch-cta-block-top">
          <p className="max-w-[52ch] text-[17px] font-bold leading-snug text-[#1A1A1A]">
            {t.cta.lead}
          </p>
          <div className="mt-5">
            <WhatsAppCta position="top" />
          </div>
          <p className="mt-3 text-[13px] leading-snug text-[#6B7280]">{t.cta.under}</p>
        </section>

        <section className="mt-14" aria-labelledby="watch-demos">
          <div id="watch-demos">
            <SectionHeading>{t.demos.heading}</SectionHeading>
          </div>
          <p className="mt-3 max-w-[62ch] text-[16px] leading-[1.6] text-[#1A1A1A]">
            {t.demos.intro}
          </p>
          <div className="mt-6" data-testid="watch-demos">
            <DemoTracker>{demos}</DemoTracker>
          </div>
        </section>

        <section className="mt-14 rounded-3xl bg-[#1A1A1A] p-6 sm:p-8">
          <h2 className="text-[24px] font-black tracking-tight text-white">
            {t.closing.heading}
          </h2>
          <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-white/80">
            {t.closing.body}
          </p>
          <div className="mt-5">
            <WhatsAppCta position="bottom" />
          </div>
        </section>
      </div>
    </div>
  );
}
