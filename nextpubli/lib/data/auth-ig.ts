import { createAdminClient } from "@/lib/supabase/admin";
import { saveOutstandConnection } from "./outstand";
import { notifyAccountConnected } from "./notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

// Instagram never returns an email, so each influencer gets a deterministic,
// internal-only auth email derived from their Outstand social account id.
// The real (contactable) email lives on profiles.email, captured after login.
const IG_EMAIL_DOMAIN = "instagram.heypubli.com";

export function syntheticIgEmail(socialAccountId: string): string {
  // Keep characters that are valid in an email local-part and lossless for the
  // base62-style ids Outstand uses; map anything else to "-" to avoid collisions.
  const slug = socialAccountId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `ig_${slug}@${IG_EMAIL_DOMAIN}`;
}

export interface IgAccount {
  socialAccountId: string;
  username: string;
  // Stable Instagram user id (Outstand's network_unique_id) — survives renames.
  igUserId?: string | null;
}

// Collected on /cadastro before the influencer is sent to Instagram.
export interface IgSignupData {
  firstName: string;
  lastName: string;
  email: string;
  whatsapp: string;
}

export interface IgUserResult {
  userId: string;
  email: string;
  isNew: boolean;
}

// The current auth email for a user — NOT recomputed from the account id, so a login
// keeps working even if the auth email is later changed (e.g. by an admin).
async function authEmailFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) {
    throw new Error("Não foi possível obter o email da conta");
  }
  return data.user.email;
}

// The profile that already owns this Instagram handle, if any. Matches by the STABLE
// Instagram user id first — usernames are user-changeable, so matching only on the
// handle created a duplicate empty account after a rename. The username match remains
// as a fallback for legacy rows that predate ig_user_id. (Outstand mints a new
// social-account id on every reconnect, so that id can never be the key.)
// Returns the most recently connected match — a handle can map to several profiles now
// that form signups deliberately create a fresh account per signup, so a plain
// single-row lookup would error on duplicates.
async function findConnectionByIg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  account: IgAccount,
): Promise<{ profile_id: string } | null> {
  if (account.igUserId) {
    const { data, error } = await admin
      .from("outstand_connections")
      .select("profile_id")
      .eq("ig_user_id", account.igUserId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      throw new Error(`Falha ao buscar conexão do Instagram: ${error.message}`);
    }
    const rows = data as { profile_id: string }[] | null;
    if (rows && rows.length > 0) return rows[0];
  }

  const { data, error } = await admin
    .from("outstand_connections")
    .select("profile_id")
    .eq("ig_username", account.username)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`Falha ao buscar conexão do Instagram: ${error.message}`);
  }
  const rows = data as { profile_id: string }[] | null;
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Find the influencer that owns this Instagram (Outstand) account, or create one.
 * Used by the login callback — the auth user, profile (via DB trigger) and the
 * Outstand connection are all set up here. Returns the auth email so the caller can
 * mint a session for it.
 *
 * `signup` present = the person filled in the /cadastro form (name + email + WhatsApp).
 * That is an explicit "create a new influencer" intent, so we ALWAYS create a fresh
 * account — even when the same Instagram handle is already linked to another profile.
 * Otherwise their new contact details would be silently dropped and the admin would
 * never see the signup. Returning-user matching only applies to the "Sign in with
 * Instagram" button (no form data).
 */
export async function findOrCreateInfluencerByOutstand(
  account: IgAccount,
  signup?: IgSignupData,
): Promise<IgUserResult> {
  const admin = createAdminClient();

  // 1. Returning influencer (login button only — never on a form signup).
  if (!signup) {
    const existing = await findConnectionByIg(admin, account);
    if (existing) {
      // Refresh the latest Outstand social-account id (used for posting), the
      // current handle, and backfill the stable id on legacy rows.
      await saveOutstandConnection(
        existing.profile_id,
        account.socialAccountId,
        account.username,
        account.igUserId,
      );
      return {
        userId: existing.profile_id,
        email: await authEmailFor(admin, existing.profile_id),
        isNew: false,
      };
    }
  }

  // 2. New influencer — create the auth user. The handle_new_user trigger reads this
  //    metadata to create the profile row (name + auth_provider + needs_contact).
  //    Signup: use the real email as the auth email straight away, so they can also log
  //    in via an email magic link later (not just Instagram). Login-via-IG with no form
  //    data: fall back to a synthetic internal-only email; contact details are captured
  //    afterwards on /bem-vindo.
  const authEmail = signup?.email ?? syntheticIgEmail(account.socialAccountId);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: authEmail,
    email_confirm: true,
    user_metadata: {
      auth_provider: "instagram",
      ig_username: account.username,
      first_name: signup?.firstName ?? "",
      last_name: signup?.lastName ?? "",
    },
  });
  if (createErr || !created?.user) {
    throw new Error(createErr?.message ?? "Falha ao criar conta");
  }
  const userId = created.user.id;

  // 3. Map the Outstand social account to this influencer. If this fails, roll back
  //    the just-created auth user — otherwise it is an orphan with no connection and
  //    the influencer can never log in again (the email is already taken).
  try {
    await saveOutstandConnection(
      userId,
      account.socialAccountId,
      account.username,
      account.igUserId,
    );
  } catch (err) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw err instanceof Error
      ? err
      : new Error("Falha ao vincular a conta do Instagram");
  }

  // 4. Signup flow: we already have their WhatsApp + real email (the trigger set the
  //    email from the auth user), so store the WhatsApp and clear needs_contact (no
  //    /bem-vindo step). Best-effort — a failure just falls back to the contact screen.
  if (signup) {
    await // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from("profiles") as any)
      .update({
        email: signup.email,
        whatsapp: signup.whatsapp,
        needs_contact: false,
      })
      .eq("id", userId)
      .then(undefined, () => {});
  }

  // New account connected → tell the admin (in-app + email). Best-effort: must
  // never break the signup flow.
  await notifyAccountConnected({
    profileId: userId,
    igUsername: account.username,
    name: signup ? `${signup.firstName} ${signup.lastName}`.trim() : account.username,
  });

  return { userId, email: authEmail, isNew: true };
}
