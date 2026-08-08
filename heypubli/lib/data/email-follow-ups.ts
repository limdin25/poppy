import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/integrations/resend";
import { resolveFunnel } from "@/lib/data/onboarding";
import { resolveStatesForCron } from "@/lib/data/onboarding-nudges";
import { chasesSpentOnStep } from "@/lib/data/reply-runner";
import { CHASES_PER_STEP } from "@/lib/data/reply-brain";
import { bioSentence } from "@/lib/bio-variants";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import type { OnboardingStepId, Profile } from "@/types/database";

/**
 * THE FREE LADDER, for after the paid one runs out.
 *
 * Hugo, 08 Aug 2026: "one option is after twenty four hours we keep following
 * up on them via email. That would work, right? Until they do it. Because we
 * have their email as well."
 *
 * It works because every creator gives a real email at signup, which is how
 * their Skool invite reaches them. A WhatsApp message costs about four cents
 * and an email costs about nothing, so the four paid chases stay the paid
 * ladder's whole budget and this one carries the long tail.
 *
 * WHY IT SLOWS DOWN INSTEAD OF GOING DAILY FOREVER. "Until they do it" is the
 * right instinct and the gap is the only thing I would argue with. An email a
 * day to somebody who has stopped answering is what earns a spam complaint, and
 * heypubli.com is the domain the Skool invite emails leave from: if we burn its
 * reputation the invites stop landing in inboxes, which breaks the exact step
 * most of these people are stuck on. So it is daily for the first week, then
 * weekly, and it genuinely never stops until they finish or press the stop
 * link. That keeps the pressure on without setting fire to the thing underneath
 * it.
 */

/** Day 1 to 7: one a day. After that: one a week, forever. */
export function emailGapHours(alreadySent: number): number {
  return alreadySent < 7 ? 24 : 24 * 7;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heypubli.com";
const SENDS_PER_RUN = 20;

/**
 * The stop link's token. Signed so a guessed profile id cannot unsubscribe
 * somebody else, and derived from CRON_SECRET so there is no new env var to
 * forget in production. A leaked link only lets its owner stop their own email.
 */
export function stopToken(profileId: string): string {
  return createHmac("sha256", process.env.CRON_SECRET ?? "no-secret")
    .update(`stop:${profileId}`)
    .digest("hex")
    .slice(0, 24);
}

export function stopLink(profileId: string): string {
  return `${SITE}/api/email/stop?p=${profileId}&t=${stopToken(profileId)}`;
}

interface StepEmail {
  subject: string;
  lead: string;
  todo: string[];
}

/**
 * One email per step, in the same plain voice as the WhatsApp copy and with the
 * same instructions, because a creator who reads both must not be told two
 * different things. The bio one carries their own sentence and link so the
 * email IS the work: copy, paste, done, no page to visit.
 */
export function stepEmail(
  step: OnboardingStepId,
  vars: { firstName: string; sentence?: string | null; link?: string | null },
): StepEmail {
  const hi = vars.firstName ? `${vars.firstName}, ` : "";
  switch (step) {
    case "instagram":
      return {
        subject: "Your Instagram is not connected yet",
        lead: `${hi}nothing can be posted for you until your Instagram is connected, and that is the only thing standing still.`,
        todo: [
          `Open <a href="${SITE}/onboarding">heypubli.com/onboarding</a> and tap Connect Instagram.`,
          "Say Allow when Instagram asks. You never type your password anywhere.",
        ],
      };
    case "community":
      return {
        subject: "Your community invite is sitting in this inbox",
        lead: `${hi}your invite was sent to this address. It comes from Skool and the sender is Lim Din, so it does not say HeyPubli, which is why people miss it.`,
        todo: [
          "Search this inbox for <strong>skool</strong>, and check Spam and Promotions.",
          "Open it and press JOIN NOW. Join with this same email address.",
          `Then press "I have joined" at <a href="${SITE}/onboarding">heypubli.com/onboarding</a>, or just reply to this email and say you have joined.`,
        ],
      };
    case "affiliate":
      return {
        subject: "Two minutes to get your own link",
        lead: `${hi}this is the step that pays you: your own link is what credits a sale to you instead of to nobody.`,
        todo: [
          'Open <a href="https://www.skool.com/ai-influencer-flywheel-5612/about">the community page</a>, tap the three dots at the top right or Settings, then Invite people, then COPY.',
          `Paste it at <a href="${SITE}/onboarding">heypubli.com/onboarding</a>, or reply to this email with it and we will put it in for you.`,
        ],
      };
    case "photo":
      return {
        subject: "One profile photo and you are nearly done",
        lead: `${hi}a page with no photo gets ignored, and it is the last quick thing before your bio.`,
        todo: [
          "In Instagram: Edit profile, tap your picture, pick a clear one.",
          `Then tick the step at <a href="${SITE}/onboarding">heypubli.com/onboarding</a>.`,
        ],
      };
    case "bio":
      return {
        subject: "Your link and your sentence, ready to copy",
        lead: `${hi}last step. Open Instagram, tap Edit profile, and put one thing in each of the two boxes.`,
        todo: [
          vars.sentence
            ? `<strong>BIO box</strong>, paste this sentence. It is yours, nobody else has it:<br><code>${vars.sentence}</code>`
            : `<strong>BIO box</strong>, paste your sentence from <a href="${SITE}/onboarding">heypubli.com/onboarding</a>.`,
          vars.link
            ? `<strong>LINKS box</strong> (Edit profile, then Links, then Add external link), paste this and make it the first link:<br><a href="${vars.link}">${vars.link}</a>`
            : `<strong>LINKS box</strong>, add your link from <a href="${SITE}/onboarding">heypubli.com/onboarding</a>.`,
          "Do not type the link inside the Bio text. Instagram only makes it tappable from the Links box, and a link nobody can tap tracks nothing for you.",
        ],
      };
  }
}

export function buildFollowUpHtml(e: StepEmail, profileId: string): string {
  return `
    <div style="font-family:sans-serif;max-width:560px;font-size:15px;line-height:1.55;color:#1A1A1A">
      <p>${e.lead}</p>
      <ol style="padding-left:18px">${e.todo.map((t) => `<li style="margin:8px 0">${t}</li>`).join("")}</ol>
      <p>Stuck on any of it? Just reply to this email and tell me what you can see. I will sort it with you.</p>
      <p style="color:#6B7280;font-size:13px">Lim, HeyPubli</p>
      <p style="color:#9CA3AF;font-size:12px;margin-top:22px">
        You are getting this because your HeyPubli setup is not finished.
        <a href="${stopLink(profileId)}" style="color:#9CA3AF">Stop these emails</a>.
      </p>
    </div>`;
}

export interface EmailFollowUpReport {
  candidates: number;
  sent: number;
  skipped: Record<string, number>;
  errors: string[];
}

export async function runEmailFollowUps(
  admin: ReturnType<typeof createAdminClient>,
): Promise<EmailFollowUpReport> {
  const report: EmailFollowUpReport = { candidates: 0, sent: 0, skipped: {}, errors: [] };
  const skip = (why: string) => {
    report.skipped[why] = (report.skipped[why] ?? 0) + 1;
  };
  const now = new Date();
  const nowIso = now.toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (admin.from("profiles") as any)
    .select("*")
    .eq("onboarding_complete", false)
    .eq("is_admin", false)
    .is("suspended_at", null)
    .is("email_follow_ups_stopped_at", null)
    .order("created_at", { ascending: false })
    .limit(100)) as { data: Profile[] | null };
  if (!profiles?.length) return report;

  const provider = (await getPostingSettingsAdmin())?.active_provider ?? "heypubli";

  for (const profile of profiles) {
    if (report.sent >= SENDS_PER_RUN) break;
    const email = (profile.email ?? "").trim().toLowerCase();
    // Our own invention for Instagram signups: it can receive nothing.
    if (!email || email.endsWith("@instagram.heypubli.com")) {
      skip("no_real_email");
      continue;
    }
    report.candidates++;

    try {
      const { data: progress } = await admin
        .from("onboarding_progress")
        .select("profile_id, step, first_seen_at, completed_at")
        .eq("profile_id", profile.id)
        .returns<
          { profile_id: string; step: OnboardingStepId; first_seen_at: string; completed_at: string | null }[]
        >();
      const states = await resolveStatesForCron(admin, profile, provider, progress ?? []);
      const { openStep } = resolveFunnel(states);
      if (!openStep) {
        skip("nothing_open");
        continue;
      }

      // The free ladder only starts where the paid one stops. Hugo's words:
      // "after twenty four hours", which is exactly when the fourth and last
      // WhatsApp chase has gone.
      const paidSpent = await chasesSpentOnStep(admin, profile.id, openStep);
      if (paidSpent < CHASES_PER_STEP) {
        skip("whatsapp_ladder_still_has_it");
        continue;
      }

      const { data: sentRows } = await admin
        .from("onboarding_nudges")
        .select("sent_at")
        .eq("profile_id", profile.id)
        .eq("step", openStep)
        .eq("kind", "email")
        .order("sent_at", { ascending: false })
        .returns<{ sent_at: string }[]>();
      const alreadySent = sentRows?.length ?? 0;
      const lastAt = sentRows?.[0]?.sent_at ?? null;
      const gapMs = emailGapHours(alreadySent) * 3600 * 1000;
      if (lastAt && now.getTime() - Date.parse(lastAt) < gapMs) {
        skip("too_soon");
        continue;
      }

      const first = (profile.first_name || "").trim().split(" ")[0];
      const e = stepEmail(openStep, {
        firstName: first,
        sentence: bioSentence(profile.bio_variant_index ?? 0),
        link: profile.skool_affiliate_url,
      });

      // Claim BEFORE sending, on a unique external id, so two overlapping ticks
      // cannot both email the same person the same day.
      const externalId = `email:${profile.id}:${openStep}:${alreadySent}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: claimErr } = await (admin.from("onboarding_nudges") as any).insert({
        profile_id: profile.id,
        step: openStep,
        kind: "email",
        variant: `email_${openStep}`,
        external_id: externalId,
        sent_at: nowIso,
      });
      if (claimErr) {
        if (claimErr.code !== "23505") report.errors.push(`${profile.id}: claim ${claimErr.code}`);
        skip("already_claimed");
        continue;
      }

      await sendEmail({
        to: profile.email,
        subject: e.subject,
        html: buildFollowUpHtml(e, profile.id),
      });
      report.sent++;
    } catch (err) {
      report.errors.push(`${profile.id}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  return report;
}
