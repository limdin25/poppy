import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { Plate } from "./Plate";
import { CopyBlock } from "./CopyBlock";
import { SkoolLinkForm } from "./SkoolLinkForm";
import { InviteButton } from "./InviteButton";
import { DeclareButton } from "./DeclareButton";
import { RecheckButton } from "./RecheckButton";
import { Confetti } from "./Confetti";
import { SHOTS } from "./shots";
import { funnelCopy as t } from "./copy";
import {
  declareCommunityJoined,
  declarePhotoDone,
  declareBioDone,
} from "@/lib/actions/onboarding";
import { ONBOARDING_STEPS, type OnboardingData } from "@/lib/data/onboarding";
import type { StepState } from "@/lib/data/brochure";
import type { OnboardingStepId } from "@/types/database";

/**
 * The gated onboarding. One step open at a time; done steps collapse to a
 * green row a tap can reopen; future steps sit locked underneath so the whole
 * job is visible but only one thing is ever asked for. Hugo, 2026-08-06:
 * "they just see one thing at a time... make it so easy for them not to go
 * wrong."
 *
 * A server component: which step is open is decided on the server from real
 * state, so leaving to Instagram or the email app and coming back always
 * reopens the page exactly where they were. The only client JavaScript is the
 * small stuff: copy buttons, the paste form, the declare buttons, and the
 * confetti when the last step goes green.
 */

const PAPER = "#FAF7F2";

type Mode = "done" | "open" | "locked";

function modeFor(id: OnboardingStepId, data: OnboardingData): Mode {
  if (data.stepStates[id] === "done") return "done";
  if (data.openStep === id) return "open";
  return "locked";
}

function StatusLine({
  stepId,
  state,
  message,
  children,
}: {
  stepId: string;
  state: StepState;
  message: string;
  children?: React.ReactNode;
}) {
  const label =
    state === "done"
      ? t.labels.done
      : state === "waiting"
        ? t.labels.waiting
        : state === "unknown"
          ? t.labels.unknown
          : state === "blocked"
            ? t.labels.blocked
            : t.labels.todo;
  const dot =
    state === "done"
      ? "bg-[#10B981]"
      : state === "waiting"
        ? "bg-[#F59E0B]"
        : state === "unknown"
          ? "bg-[#6B7280]"
          : state === "blocked"
            ? "bg-[#D1D5DB]"
            : "bg-[#E1306C]";

  return (
    <div
      data-testid={`status-${stepId}`}
      data-state={state}
      className="mt-6 rounded-2xl border border-[#E5E7EB] bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${dot}`}
        >
          {state === "done" && <Check className="h-3 w-3 text-white" strokeWidth={4} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#6B7280]">
            {label}
          </p>
          <p className="mt-1 text-[15px] leading-relaxed text-[#1A1A1A]">{message}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A fact the creator must not get wrong, set apart from the prose around it. */
function Callout({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="mt-6 rounded-2xl border-l-4 border-[#E1306C] bg-white px-5 py-4">
      <p className="break-words text-[16px] font-black leading-snug text-[#1A1A1A]">
        {headline}
      </p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[#6B7280]">{body}</p>
    </div>
  );
}

function Body({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <div className="mt-4 space-y-3">
      {paragraphs.map((p) => (
        <p key={p} className="max-w-[62ch] text-[16px] leading-[1.6] text-[#1A1A1A]">
          {p}
        </p>
      ))}
    </div>
  );
}

function StepContent({ id, data }: { id: OnboardingStepId; data: OnboardingData }) {
  const { instagram, community, affiliate, bio, photo } = data;

  if (id === "instagram") {
    return (
      <>
        <Body paragraphs={t.steps.instagram.body} />
        {/* When Instagram sends them back with an error the page used to look
            identical to before they left, so they tapped the same button
            again, forever. The commonest cause by far is a personal account,
            which is why the remedy is named here and not only at signup. */}
        {data.instagramError && (
          <div
            data-testid="instagram-error"
            className="mt-5 rounded-2xl border-l-4 border-[#EF4444] bg-white px-5 py-4"
          >
            <p className="text-[16px] font-black leading-snug text-[#1A1A1A]">
              {t.steps.instagram.errorHeadline}
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-[#6B7280]">
              {t.steps.instagram.errorBody}
            </p>
          </div>
        )}
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
        <StatusLine
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
      </>
    );
  }

  if (id === "community") {
    return (
      <>
        <Body paragraphs={t.steps.community.body} />
        {/* The button that sends the invite. Without it this step described an
            email nobody had ever posted, and the funnel stopped here. */}
        <InviteButton alreadyInvited={data.inviteQueued} />
        <Plate shot={SHOTS.findEmail} index={1} />
        {/* Their real address, printed. The one detail that, if they get it
            wrong, quietly costs them money months later. */}
        <Callout
          headline={t.steps.community.emailRule(data.email)}
          body={t.steps.community.emailWhy}
        />
        <Plate shot={SHOTS.joinNow} index={2} />
        <StatusLine
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
          {community.state !== "done" && community.state !== "blocked" && (
            <DeclareButton
              action={declareCommunityJoined}
              label={t.steps.community.declare}
              note={t.steps.community.declareNote}
              testId="declare-community"
            />
          )}
        </StatusLine>
      </>
    );
  }

  if (id === "affiliate") {
    return (
      <>
        <Body paragraphs={t.steps.affiliate.body} />
        <Plate shot={SHOTS.invitePeople} index={1} />
        <Plate shot={SHOTS.copyLink} index={2} />
        <SkoolLinkForm saved={affiliate.url} />
        <StatusLine
          stepId="affiliate"
          state={affiliate.state}
          message={
            affiliate.state === "done"
              ? t.steps.affiliate.status.done
              : t.steps.affiliate.status.todo
          }
        />
      </>
    );
  }

  if (id === "photo") {
    return (
      <>
        <Body paragraphs={t.steps.photo.body} />
        <Plate shot={SHOTS.editProfilePhoto} index={1} />
        <a
          href={t.steps.photo.pexelsUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="pexels-link"
          className="mt-2 inline-block rounded-full border border-[#1A1A1A] bg-white px-6 py-3 text-[15px] font-black text-[#1A1A1A]"
        >
          {t.steps.photo.pexels}
        </a>
        <StatusLine
          stepId="photo"
          state={photo.state}
          message={
            photo.state === "done" ? t.steps.photo.status.done : t.steps.photo.status.todo
          }
        >
          {photo.state !== "done" && (
            <DeclareButton
              action={declarePhotoDone}
              label={t.steps.photo.declare}
              note={t.steps.photo.declareNote}
              testId="declare-photo"
            />
          )}
        </StatusLine>
      </>
    );
  }

  // bio
  return (
    <>
      <Body paragraphs={t.steps.bio.body} />
      <CopyBlock
        testId="bio-sentence"
        label={t.steps.bio.sentenceLabel}
        value={bio.sentence}
        note={t.steps.bio.sentenceNote}
        rows={3}
      />
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
      <Plate shot={SHOTS.editProfileBio} index={1} />
      <Plate shot={SHOTS.bioDone} index={2} />
      {bio.needleKind === "community" && bio.state !== "done" && (
        <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-[#6B7280]">
          {t.steps.bio.weakNeedle}
        </p>
      )}
      <StatusLine
        stepId="bio"
        state={bio.state}
        message={
          bio.state === "done"
            ? bio.linkFound && bio.sentenceFound
              ? t.steps.bio.status.doneChecked
              : t.steps.bio.status.doneDeclared
            : bio.state === "blocked"
              ? t.steps.bio.status.blocked
              : bio.state === "unknown"
                ? t.steps.bio.status.unknown
                : bio.sentenceFound && !bio.linkFound
                  ? t.steps.bio.status.waitingLink
                  : bio.linkFound && !bio.sentenceFound
                    ? t.steps.bio.status.waitingSentence
                    : t.steps.bio.status.waiting
        }
      >
        {bio.state === "waiting" && (
          <RecheckButton testId="recheck-bio" label={t.steps.bio.recheck} />
        )}
        {/* Self-declaring NEVER completes this step any more. 08 Aug 2026: a
            creator ticked "It is there" over a completely empty profile,
            reached 5/5 and was told his link was live. While we can read
            their real Instagram, only the read finishes the step; the button
            is offered when our eyes fail (state unknown), where their word is
            the only evidence there can be. On waiting, the granular message
            above says exactly which of the two things is missing. */}
        {bio.state === "unknown" && (
          <DeclareButton
            action={declareBioDone}
            label={t.steps.bio.declare}
            note={t.steps.bio.declareNote}
            testId="declare-bio"
          />
        )}
      </StatusLine>
    </>
  );
}

function StepCard({ id, data }: { id: OnboardingStepId; data: OnboardingData }) {
  const mode = modeFor(id, data);
  const step = t.steps[id];
  const state = data.stepStates[id];

  if (mode === "locked") {
    return (
      <section
        data-testid={`step-${id}`}
        data-mode="locked"
        className="rounded-3xl border border-[#E5E7EB] bg-white/60 px-5 py-4 sm:px-6"
      >
        <div className="flex items-center gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6] text-[15px] font-black text-[#9CA3AF]">
            {step.number}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-black leading-tight text-[#9CA3AF]">
              {step.title}
            </h2>
            <p className="mt-0.5 text-[13px] leading-snug text-[#9CA3AF]">
              {state === "blocked" && "blocked" in step.status
                ? step.status.blocked
                : t.lockedHint}
            </p>
          </div>
          <Lock aria-label={t.lockedLabel} className="h-4 w-4 shrink-0 text-[#D1D5DB]" />
        </div>
      </section>
    );
  }

  if (mode === "done") {
    return (
      <details
        data-testid={`step-${id}`}
        data-mode="done"
        className="group rounded-3xl border border-[#D1FAE5] bg-white px-5 py-4 sm:px-6"
      >
        <summary className="flex cursor-pointer list-none items-center gap-4 [&::-webkit-details-marker]:hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#10B981]">
            <Check className="h-4.5 w-4.5 text-white" strokeWidth={3.5} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-black leading-tight text-[#1A1A1A]">
              {step.title}
            </h2>
            <p className="mt-0.5 text-[13px] leading-snug text-[#0F7A5C]">
              {t.doneLabel}. <span className="text-[#6B7280]">{t.doneHint}</span>
            </p>
          </div>
        </summary>
        <div className="pb-2 pt-4">
          <StepContent id={id} data={data} />
        </div>
      </details>
    );
  }

  return (
    <section
      data-testid={`step-${id}`}
      data-mode="open"
      className="rounded-3xl border-2 border-[#E1306C] bg-white px-5 py-6 sm:px-7"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E1306C] text-[15px] font-black text-white">
          {step.number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[24px] font-black leading-[1.05] tracking-tight text-[#1A1A1A] sm:text-[28px]">
            {step.title}
          </h2>
          <p className="mt-1 text-[15px] leading-snug text-[#6B7280]">{step.summary}</p>
        </div>
      </div>
      <StepContent id={id} data={data} />
    </section>
  );
}

export function Funnel({ data }: { data: OnboardingData }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: PAPER }}>
      <div className="mx-auto w-full max-w-[44rem] px-4 pb-28 pt-8 sm:px-8 sm:pt-14">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6B7280]">
          {t.masthead.eyebrow}
        </p>
        <h1 className="mt-3 text-[36px] font-black leading-[0.98] tracking-tighter text-[#1A1A1A] sm:text-[56px]">
          {t.masthead.title(data.firstName)}
        </h1>
        <p className="mt-4 max-w-[46ch] text-[16px] leading-[1.55] text-[#6B7280] sm:text-[18px]">
          {t.masthead.standfirst}
        </p>

        {/* The whole journey at a glance, above the fold. */}
        <div className="mt-7 flex items-center gap-3">
          <div className="flex flex-1 gap-1.5" aria-hidden>
            {ONBOARDING_STEPS.map((s) => (
              <span
                key={s}
                className={`h-1.5 flex-1 rounded-full ${
                  data.stepStates[s] === "done" ? "bg-[#10B981]" : "bg-[#E5E7EB]"
                }`}
              />
            ))}
          </div>
          <span
            data-testid="funnel-progress"
            className="shrink-0 text-[13px] font-black tabular-nums text-[#1A1A1A]"
          >
            {t.masthead.progress(data.doneSteps, data.totalSteps)}
          </span>
        </div>

        {data.allDone && (
          <>
            <Confetti celebrationKey={data.email} />
            <section
              data-testid="funnel-finished"
              className="mt-8 rounded-3xl bg-[#10B981] px-6 py-7 text-white"
            >
              <h2 className="text-[26px] font-black leading-tight tracking-tight">
                {t.finish.heading}
              </h2>
              <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-white/90">
                {t.finish.body}
              </p>
              {/* Somewhere to go. Without this a creator who has just done five
                  steps of real work lands on a green box and a dead end. */}
              <Link
                href="/dashboard"
                data-testid="funnel-to-dashboard"
                className="mt-5 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-[15px] font-black text-[#065F46] transition hover:bg-white/90"
              >
                {t.finish.cta}
              </Link>
            </section>
          </>
        )}

        <div className="mt-8 space-y-4">
          {ONBOARDING_STEPS.map((id) => (
            <StepCard key={id} id={id} data={data} />
          ))}
        </div>

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
