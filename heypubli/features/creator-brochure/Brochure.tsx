import { Plate } from "./Plate";
import { StatusStrip } from "./StatusStrip";
import { CopyBlock } from "./CopyBlock";
import { RecheckButton } from "./RecheckButton";
import { SkoolLinkForm } from "./SkoolLinkForm";
import { DeclareBioButton } from "./DeclareBioButton";
import { DeclareCommunityButton } from "./DeclareCommunityButton";
import { SHOTS } from "./shots";
import { brochureCopy as t, SKOOL_COMMUNITY_URL } from "./copy";
import type { BrochureData } from "@/lib/data/brochure";

/**
 * The creator's setup brochure. A server component: everything on this page
 * that can be plain HTML is plain HTML, and the four small client children
 * (copy buttons, the paste field, the two recheck buttons) are the only
 * JavaScript a phone has to download before the page is usable.
 *
 * It reads top to bottom like a printed leaflet on purpose. No accordions, no
 * tabs, nothing hidden behind a tap. A creator scrolls once and has seen the
 * whole job before committing to any of it, which is the difference between
 * "four things, ten minutes" and "an unknown number of things, unknown".
 *
 * Finished steps keep all their text. A brochure does not delete a page once
 * you have read it, and the creator who comes back in a month to change their
 * link needs step 3 to still be there.
 */

const PAPER = "#FAF7F2";

function Rule() {
  return <hr className="my-12 border-0 border-t border-[#E5E7EB] sm:my-16" />;
}

function StepHeader({
  number,
  title,
  summary,
}: {
  number: string;
  title: string;
  summary: string;
}) {
  return (
    <header>
      <p className="text-[64px] font-black leading-[0.8] tracking-tighter text-[#E1306C] sm:text-[88px]">
        {number}
      </p>
      <h2 className="mt-4 text-[32px] font-black leading-[1.02] tracking-tight text-[#1A1A1A] sm:text-[44px]">
        {title}
      </h2>
      <p className="mt-2 text-[17px] leading-snug text-[#6B7280] sm:text-[19px]">
        {summary}
      </p>
    </header>
  );
}

function Body({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <div className="mt-6 space-y-4">
      {paragraphs.map((p) => (
        <p key={p} className="max-w-[62ch] text-[17px] leading-[1.6] text-[#1A1A1A]">
          {p}
        </p>
      ))}
    </div>
  );
}

/** A fact the creator must not get wrong, set apart from the prose that explains it. */
function Callout({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="mt-6 rounded-2xl border-l-4 border-[#E1306C] bg-white px-5 py-4">
      <p className="break-words text-[17px] font-black leading-snug text-[#1A1A1A]">
        {headline}
      </p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-[#6B7280]">{body}</p>
    </div>
  );
}

export function Brochure({ data }: { data: BrochureData }) {
  const { instagram, community, affiliate, bio } = data;

  return (
    <div className="min-h-screen" style={{ backgroundColor: PAPER }}>
      <div className="mx-auto w-full max-w-[44rem] px-5 pb-28 pt-10 sm:px-10 sm:pt-16">
        {/* ---------------------------------------------------------------
            Masthead
        --------------------------------------------------------------- */}
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6B7280]">
          {t.masthead.eyebrow}
        </p>
        <h1 className="mt-3 text-[44px] font-black leading-[0.95] tracking-tighter text-[#1A1A1A] sm:text-[72px]">
          {t.masthead.title(data.firstName)}
        </h1>
        <p className="mt-5 max-w-[46ch] text-[18px] leading-[1.55] text-[#6B7280] sm:text-[21px]">
          {t.masthead.standfirst}
        </p>

        {/* Four segments, one per step. The only place on the page that shows
            the whole picture at a glance, and it is above the fold. */}
        <div className="mt-8 flex items-center gap-3">
          <div className="flex flex-1 gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i < data.doneCount ? "bg-[#10B981]" : "bg-[#E5E7EB]"
                }`}
              />
            ))}
          </div>
          <span
            data-testid="brochure-progress"
            className="shrink-0 text-[13px] font-black tabular-nums text-[#1A1A1A]"
          >
            {t.masthead.progress(data.doneCount, 4)}
          </span>
        </div>

        <Rule />

        {/* ---------------------------------------------------------------
            How this works
        --------------------------------------------------------------- */}
        <section aria-labelledby="brochure-intro">
          <h2
            id="brochure-intro"
            className="text-[24px] font-black tracking-tight text-[#1A1A1A]"
          >
            {t.intro.heading}
          </h2>
          <Body paragraphs={t.intro.body} />
        </section>

        <Rule />

        {/* ---------------------------------------------------------------
            01 Connect your Instagram
        --------------------------------------------------------------- */}
        <section data-testid="step-instagram">
          <StepHeader
            number={t.steps.instagram.number}
            title={t.steps.instagram.title}
            summary={t.steps.instagram.summary}
          />
          <Body paragraphs={t.steps.instagram.body} />
          <Plate shot={SHOTS.connect} index={1} />
          <Plate shot={SHOTS.allow} index={2} />

          {instagram.state === "todo" && data.instagramEnabled && (
            <a
              href={data.connectUrl}
              data-testid="connect-instagram"
              className="mt-2 block w-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-4 text-center text-[16px] font-black text-white sm:inline-block sm:w-auto"
            >
              {t.steps.instagram.cta}
            </a>
          )}

          <StatusStrip
            stepId="instagram"
            state={instagram.state}
            message={
              instagram.state === "done"
                ? t.steps.instagram.status.done(instagram.username)
                : instagram.state === "blocked"
                  ? t.steps.instagram.status.blocked
                  : t.steps.instagram.status.todo
            }
          />
        </section>

        <Rule />

        {/* ---------------------------------------------------------------
            02 Join the community
        --------------------------------------------------------------- */}
        <section data-testid="step-community">
          <StepHeader
            number={t.steps.community.number}
            title={t.steps.community.title}
            summary={t.steps.community.summary}
          />
          <Body paragraphs={t.steps.community.body} />
          <Plate shot={SHOTS.inviteEmail} index={3} />

          {/* Their real address, printed. The one detail on the page that, if
              they get it wrong, quietly costs them money months later. */}
          <Callout
            headline={t.steps.community.emailRule(data.email)}
            body={t.steps.community.emailWhy}
          />

          <Plate shot={SHOTS.skoolSignup} index={4} />

          <a
            href={SKOOL_COMMUNITY_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="open-skool"
            className="mt-2 inline-block rounded-full border border-[#1A1A1A] bg-white px-6 py-3 text-[15px] font-black text-[#1A1A1A]"
          >
            {t.steps.community.cta}
          </a>

          <StatusStrip
            stepId="community"
            state={community.state}
            message={
              community.state === "done"
                ? t.steps.community.status.done
                : community.state === "blocked"
                  ? t.steps.community.status.blocked
                  : t.steps.community.status.waiting
            }
          >
            {community.state === "waiting" && <DeclareCommunityButton />}
          </StatusStrip>
        </section>

        <Rule />

        {/* ---------------------------------------------------------------
            03 Get your affiliate link
        --------------------------------------------------------------- */}
        <section data-testid="step-affiliate">
          <StepHeader
            number={t.steps.affiliate.number}
            title={t.steps.affiliate.title}
            summary={t.steps.affiliate.summary}
          />
          <Body paragraphs={t.steps.affiliate.body} />
          <Plate shot={SHOTS.affiliateLink} index={5} />

          <SkoolLinkForm saved={affiliate.url} />

          <StatusStrip
            stepId="affiliate"
            state={affiliate.state}
            message={
              affiliate.state === "done"
                ? t.steps.affiliate.status.done
                : t.steps.affiliate.status.todo
            }
          />
        </section>

        <Rule />

        {/* ---------------------------------------------------------------
            04 Put it in your Instagram bio
        --------------------------------------------------------------- */}
        <section data-testid="step-bio">
          <StepHeader
            number={t.steps.bio.number}
            title={t.steps.bio.title}
            summary={t.steps.bio.summary}
          />
          <Body paragraphs={t.steps.bio.body} />

          <CopyBlock
            testId="bio-sentence"
            label={t.steps.bio.sentenceLabel}
            value={bio.sentence}
            note={t.steps.bio.sentenceNote}
            rows={3}
          />
          <Plate shot={SHOTS.igBio} index={6} />

          {affiliate.url ? (
            <CopyBlock
              testId="bio-link"
              label={t.steps.bio.linkLabel}
              value={affiliate.url}
              rows={2}
            />
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-[#E5E7EB] bg-white p-4 text-[15px] leading-relaxed text-[#6B7280]">
              {t.steps.bio.linkMissing}
            </p>
          )}
          <Plate shot={SHOTS.igLinks} index={7} />

          {bio.needleKind === "community" && bio.state !== "done" && (
            <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-[#6B7280]">
              {t.steps.bio.weakNeedle}
            </p>
          )}

          <StatusStrip
            stepId="bio"
            state={bio.state}
            message={
              bio.state === "done"
                ? bio.declaredAt
                  ? t.steps.bio.status.doneDeclared
                  : t.steps.bio.status.doneChecked
                : bio.state === "blocked"
                  ? t.steps.bio.status.blocked
                  : bio.state === "unknown"
                    ? t.steps.bio.status.unknown
                    : t.steps.bio.status.waiting
            }
          >
            {bio.state === "waiting" && (
              <RecheckButton testId="recheck-bio" label={t.steps.bio.recheck} />
            )}
            {/* Self-declaring is offered ONLY when we could not look. Never
                next to a check that came back "not there". */}
            {bio.state === "unknown" && <DeclareBioButton />}
          </StatusStrip>
        </section>

        <Rule />

        {/* ---------------------------------------------------------------
            Closing
        --------------------------------------------------------------- */}
        <section>
          <h2 className="text-[24px] font-black tracking-tight text-[#1A1A1A]">
            {t.finish.heading}
          </h2>
          <p className="mt-4 max-w-[62ch] text-[17px] leading-[1.6] text-[#1A1A1A]">
            {t.finish.body}
          </p>
        </section>

        <div className="mt-12 rounded-2xl bg-white p-5 sm:p-6">
          <h3 className="text-[11px] font-black uppercase tracking-[0.14em] text-[#6B7280]">
            {t.help.heading}
          </h3>
          <p className="mt-2 max-w-[62ch] text-[16px] leading-relaxed text-[#1A1A1A]">
            {t.help.body}
          </p>
          <a
            href={`mailto:${t.help.email}`}
            className="mt-3 inline-block break-all text-[16px] font-black text-[#E1306C] underline underline-offset-4"
          >
            {t.help.email}
          </a>
        </div>
      </div>
    </div>
  );
}
