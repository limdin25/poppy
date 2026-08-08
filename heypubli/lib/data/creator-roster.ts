import { createAdminClient } from "@/lib/supabase/admin";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import { getInstagramMetrics } from "@/lib/integrations/outstand";
import { checkBio } from "@/lib/bio-check";
import { bioSentence } from "@/lib/bio-variants";
import { skoolLinkNeedle } from "@/lib/skool-link";
import { resolveFunnel, ONBOARDING_STEPS } from "@/lib/data/onboarding";
import type { OnboardingStepId, Profile } from "@/types/database";
import type { StepState } from "@/lib/data/brochure";

/**
 * THE ROSTER: every creator account, what their real Instagram says, and
 * whether their own Skool link is actually on it.
 *
 * Hugo, 08 Aug 2026: "come back to me with exactly the ones that we have the
 * school URL and the ones without so we know that you actually checking
 * correctly, and also make sure the system knows how to check every time."
 *
 * Built after a browser-verified audit of all 24 connected accounts caught
 * three things a summary count would have hidden:
 *
 *   1. A creator whose bio carries a Skool link with SOMEBODY ELSE'S referral
 *      code. It looks done from ten feet away and earns them nothing.
 *   2. A creator who had done it perfectly, whose Instagram connection has
 *      expired, so every automatic check reads "not done" forever.
 *   3. A creator who replaced our link with their own crypto referral.
 *
 * So the roster never reports a bare yes/no. It reports what we SAW, and when
 * we could not see, it says so instead of guessing.
 */

export type BioVerdict =
  | "verified" // their own referral code and their sentence are both on the profile
  | "link_only" // their own code is there, the sentence is not
  | "sentence_only"
  | "wrong_code" // a Skool link is there but the code is NOT theirs: they earn nothing
  | "foreign_link" // a link that is not ours at all, in the place ours should be
  | "missing" // we read the profile and neither is there
  | "no_link_saved" // they have never given us a link, so there is nothing to look for
  | "unreadable"; // the Instagram connection is broken: we CANNOT say either way

export interface RosterRow {
  profileId: string;
  name: string;
  email: string;
  whatsapp: string | null;
  igUsername: string | null;
  igUrl: string | null;
  joinedAt: string;
  followers: number | null;
  posts: number | null;
  /** Their own Skool link as saved with us. */
  savedSkoolUrl: string | null;
  /** The Skool link actually found on their Instagram, when there is one. */
  bioSkoolUrl: string | null;
  bio: string | null;
  verdict: BioVerdict;
  stepsDone: number;
  openStep: OnboardingStepId | null;
  onboardingComplete: boolean;
  /** Set when the connection is broken, so the email can shout about it. */
  connectionBroken: boolean;
}

const SKOOL_IN_TEXT = /(?:https?:\/\/)?(?:www\.)?skool\.com\/[^\s"'<>)]+/i;

/** The referral code inside any Skool URL, or null. */
function refOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    for (const k of ["ref", "r", "via", "aff"]) {
      const v = u.searchParams.get(k);
      if (v && v.trim().length >= 3) return v.trim().toLowerCase();
    }
  } catch {
    /* not a URL we can parse */
  }
  return null;
}

/** Any Skool link sitting in the bio text or the website field. */
export function skoolUrlInProfile(
  biography: string | null,
  website: string | null,
): string | null {
  for (const hay of [website ?? "", biography ?? ""]) {
    const m = hay.match(SKOOL_IN_TEXT);
    if (m) return m[0];
  }
  return null;
}

/**
 * The verdict, pure so it can be tested against the real profiles the browser
 * audit captured. Read the order: every "we could not check" answer is
 * reached before any answer that would accuse a creator of not doing it.
 */
export function verdictFor(input: {
  readable: boolean;
  savedSkoolUrl: string | null;
  sentence: string;
  biography: string | null;
  website: string | null;
}): { verdict: BioVerdict; bioSkoolUrl: string | null } {
  const bioSkoolUrl = skoolUrlInProfile(input.biography, input.website);
  if (!input.readable) return { verdict: "unreadable", bioSkoolUrl };
  if (!input.savedSkoolUrl) return { verdict: "no_link_saved", bioSkoolUrl };

  const evidence = checkBio({
    tag: skoolLinkNeedle(input.savedSkoolUrl)?.value ?? null,
    sentence: input.sentence,
    biography: input.biography,
    website: input.website,
  });
  if (evidence.link && evidence.sentence) return { verdict: "verified", bioSkoolUrl };
  if (evidence.link) return { verdict: "link_only", bioSkoolUrl };

  // No match for THEIR code. If some other Skool link is there, that is a
  // different and much worse problem than an empty bio: the page looks set up
  // and every sale it makes is credited to somebody else.
  if (bioSkoolUrl) {
    const theirs = refOf(input.savedSkoolUrl);
    const found = refOf(bioSkoolUrl);
    if (theirs && found && theirs !== found) return { verdict: "wrong_code", bioSkoolUrl };
  }
  if (evidence.sentence) return { verdict: "sentence_only", bioSkoolUrl };
  return { verdict: "missing", bioSkoolUrl };
}

export const VERDICT_LABEL: Record<BioVerdict, string> = {
  verified: "YES, their link and sentence are live",
  link_only: "link is live, sentence missing",
  sentence_only: "sentence is in, LINK MISSING",
  wrong_code: "WRONG CODE, the link in their bio is not theirs",
  foreign_link: "someone else's link is in their bio",
  missing: "nothing in their bio yet",
  no_link_saved: "no link saved with us yet",
  unreadable: "CANNOT CHECK, their Instagram connection is broken",
};

/**
 * Read every creator's real Instagram and build the roster. One Outstand call
 * per connected account; the whole thing runs hourly behind the monitor email.
 */
export async function buildCreatorRoster(
  admin: ReturnType<typeof createAdminClient>,
): Promise<RosterRow[]> {
  const settings = await getPostingSettingsAdmin();
  const apiKey = settings?.outstand_api_key ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (admin.from("profiles") as any)
    .select("*")
    .eq("is_admin", false)
    .is("suspended_at", null)
    .order("created_at", { ascending: true })
    .limit(300)) as { data: Profile[] | null };
  if (!profiles?.length) return [];

  const ids = profiles.map((p) => p.id);
  const [{ data: conns }, { data: progress }] = await Promise.all([
    admin
      .from("outstand_connections")
      .select("profile_id, ig_username, outstand_social_account_id, is_connected")
      .in("profile_id", ids)
      .returns<
        { profile_id: string; ig_username: string | null; outstand_social_account_id: string; is_connected: boolean }[]
      >(),
    admin
      .from("onboarding_progress")
      .select("profile_id, step, completed_at")
      .in("profile_id", ids)
      .returns<{ profile_id: string; step: OnboardingStepId; completed_at: string | null }[]>(),
  ]);

  const connBy = new Map((conns ?? []).filter((c) => c.is_connected).map((c) => [c.profile_id, c]));
  const doneBy = new Map<string, Set<string>>();
  for (const r of progress ?? []) {
    if (r.completed_at) {
      const s = doneBy.get(r.profile_id) ?? new Set();
      s.add(r.step);
      doneBy.set(r.profile_id, s);
    }
  }

  const rows: RosterRow[] = [];
  for (const p of profiles) {
    const conn = connBy.get(p.id);
    let biography: string | null = null;
    let website: string | null = null;
    let followers: number | null = null;
    let posts: number | null = null;
    let readable = false;

    if (conn && apiKey) {
      try {
        const m = await getInstagramMetrics(apiKey, conn.outstand_social_account_id);
        if (m) {
          biography = m.biography;
          website = m.website;
          followers = m.followersCount;
          posts = m.postsCount;
          readable = true;
        }
      } catch {
        readable = false;
      }
    }

    const { verdict, bioSkoolUrl } = verdictFor({
      readable,
      savedSkoolUrl: p.skool_affiliate_url ?? null,
      sentence: bioSentence(p.bio_variant_index ?? 0),
      biography,
      website,
    });

    const done = doneBy.get(p.id) ?? new Set<string>();
    const states: Record<OnboardingStepId, StepState> = {
      instagram: conn ? "done" : "todo",
      community: p.community_joined_declared_at || done.has("community") ? "done" : "todo",
      affiliate: p.skool_affiliate_url ? "done" : "todo",
      photo: p.photo_declared_at || done.has("photo") ? "done" : "todo",
      bio: done.has("bio") ? "done" : "todo",
    };
    const res = resolveFunnel(states);

    rows.push({
      profileId: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email,
      email: p.email,
      whatsapp: p.whatsapp ?? null,
      igUsername: conn?.ig_username ?? null,
      igUrl: conn?.ig_username ? `https://www.instagram.com/${conn.ig_username}/` : null,
      joinedAt: p.created_at,
      followers,
      posts,
      savedSkoolUrl: p.skool_affiliate_url ?? null,
      bioSkoolUrl,
      bio: biography,
      verdict,
      stepsDone: ONBOARDING_STEPS.filter((s) => states[s] === "done").length,
      openStep: res.openStep,
      onboardingComplete: Boolean(p.onboarding_complete),
      connectionBroken: Boolean(conn) && !readable,
    });
  }
  return rows;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const when = (iso: string): string => iso.slice(0, 16).replace("T", " ") + " UTC";

/** The roster as an email table, newest joiners last, problems shouted. */
export function renderRoster(rows: RosterRow[]): string {
  if (!rows.length) return "";
  const yes = rows.filter((r) => r.verdict === "verified");
  const problem = rows.filter((r) => r.verdict === "wrong_code" || r.verdict === "unreadable");
  const parts: string[] = [
    `<h3 style="margin:18px 0 4px">Every creator account (${rows.length})</h3>`,
    `<p style="color:#374151;margin:0 0 8px"><strong>${yes.length} of ${rows.length}</strong> have their own Skool link AND their sentence live on Instagram, checked just now on their real profile.` +
      (problem.length
        ? ` <span style="color:#b91c1c"><strong>${problem.length} need you</strong> (wrong code, or we cannot read their profile).</span>`
        : "") +
      `</p>`,
  ];

  if (problem.length) {
    parts.push(
      `<div style="background:#fee2e2;padding:10px;border-radius:6px;margin:8px 0">`,
      `<strong style="color:#b91c1c">These are not a simple "not done yet":</strong><ul style="margin:6px 0">`,
      ...problem.map((r) =>
        r.verdict === "wrong_code"
          ? `<li><strong>${esc(r.name)}</strong> (<a href="${esc(r.igUrl)}">@${esc(r.igUsername)}</a>) has a Skool link in their bio with someone ELSE'S referral code. Their sales credit that person, not them.<br><span style="color:#6b7280;font-size:12px">in bio: ${esc(r.bioSkoolUrl)}<br>should be: ${esc(r.savedSkoolUrl)}</span></li>`
          : `<li><strong>${esc(r.name)}</strong> (<a href="${esc(r.igUrl)}">@${esc(r.igUsername)}</a>): their Instagram connection is broken, so we cannot read their profile OR post to it. They have been asked whether they disconnected.</li>`,
      ),
      `</ul></div>`,
    );
  }

  parts.push(
    `<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;width:100%">`,
    `<tr style="background:#f3f4f6;text-align:left">` +
      ["Creator", "Instagram", "Joined", "Followers", "Posts", "Steps", "Skool link in bio?"]
        .map((h) => `<th style="border-bottom:1px solid #e5e7eb;padding:6px">${h}</th>`)
        .join("") +
      `</tr>`,
  );
  for (const r of rows) {
    const good = r.verdict === "verified";
    const bad = r.verdict === "wrong_code" || r.verdict === "unreadable";
    const colour = good ? "#047857" : bad ? "#b91c1c" : "#92400e";
    parts.push(
      `<tr>` +
        `<td style="border-bottom:1px solid #f3f4f6">${esc(r.name)}<br><span style="color:#6b7280;font-size:11px">${esc(r.whatsapp ?? "")}</span></td>` +
        `<td style="border-bottom:1px solid #f3f4f6">${r.igUrl ? `<a href="${esc(r.igUrl)}">@${esc(r.igUsername)}</a>` : '<span style="color:#b91c1c">not connected</span>'}</td>` +
        `<td style="border-bottom:1px solid #f3f4f6;white-space:nowrap">${esc(when(r.joinedAt))}</td>` +
        `<td style="border-bottom:1px solid #f3f4f6">${r.followers ?? "?"}</td>` +
        `<td style="border-bottom:1px solid #f3f4f6">${r.posts ?? "?"}</td>` +
        `<td style="border-bottom:1px solid #f3f4f6">${r.stepsDone}/5${r.openStep ? `<br><span style="color:#6b7280;font-size:11px">on ${esc(r.openStep)}</span>` : ""}</td>` +
        `<td style="border-bottom:1px solid #f3f4f6;color:${colour}"><strong>${esc(VERDICT_LABEL[r.verdict])}</strong>${
          r.savedSkoolUrl
            ? `<br><span style="color:#6b7280;font-size:11px">${esc(r.savedSkoolUrl.slice(0, 72))}</span>`
            : ""
        }</td>` +
        `</tr>`,
    );
  }
  parts.push(`</table>`);
  return parts.join("\n");
}
