"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Returning influencers log in with an email magic link (no Instagram re-auth).
// We email a one-time login link to the address on their account.
export async function sendLoginLink(
  formData: FormData,
): Promise<{ sent?: boolean; email?: string; error?: string }> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email" };
  }

  const h = await headers();
  const host = h.get("host") ?? "heypubli.com";
  const proto = host.includes("localhost") ? "http" : "https";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${proto}://${host}/auth/callback`,
      shouldCreateUser: false, // only existing accounts; sign-up is via Instagram
    },
  });

  if (error) {
    return {
      error: "Could not send the link. Check the email and try again.",
    };
  }
  return { sent: true, email };
}

// Fallback login path: the user types the 6-digit code from the magic-link email.
// Survives everything that kills the link — scanners consuming it, broken email
// clients, opening on another device. Same one-time token, typed by a human.
export async function verifyLoginCode(
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const code = (formData.get("code") as string)?.trim().replace(/\s+/g, "");

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email" };
  }
  // GoTrue is the authority on the exact code — we only sanity-check the shape.
  // Lenient range so a future mailer_otp_length change can't lock anyone out.
  if (!code || !/^\d{6,10}$/.test(code)) {
    return { error: "Enter the 8-digit code from the email" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (error) {
    return {
      error:
        "Invalid or expired code. Use the code from the most recent email or request a new one.",
    };
  }

  let isAdmin = false;
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", data.user.id)
      .single<{ is_admin: boolean }>();
    isAdmin = profile?.is_admin ?? false;
  }

  redirect(isAdmin ? "/admin" : "/dashboard");
}

// Email signup, step 1: validate the /signup form and email an OTP code.
// shouldCreateUser:true makes GoTrue create the auth user on the spot; the
// handle_new_user trigger then builds the profile from the metadata we pass
// here. WhatsApp rides along in the metadata because the trigger doesn't map
// it: verifySignupCode copies it into the profile.
export async function sendSignupCode(
  formData: FormData,
): Promise<{ sent?: boolean; email?: string; error?: string }> {
  const firstName = (formData.get("first_name") as string)?.trim();
  const lastName = (formData.get("last_name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const whatsapp = (formData.get("whatsapp") as string)?.trim();

  if (!firstName || !lastName) {
    return { error: "Enter your first and last name" };
  }
  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email" };
  }
  if ((whatsapp ?? "").replace(/\D/g, "").length < 12) {
    return { error: "Enter a valid WhatsApp number with area code" };
  }
  if (!formData.get("terms")) {
    return { error: "Accept the terms to continue" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { first_name: firstName, last_name: lastName, whatsapp },
    },
  });

  if (error) {
    return {
      error: /rate|second|frequency/i.test(error.message)
        ? "Wait a minute before requesting a new code."
        : "Could not send the code. Check the email and try again.",
    };
  }
  return { sent: true, email };
}

// Email signup, step 2: the typed code proves the email is real. On success the
// session cookie is set; existing accounts short-circuit to their usual home.
export async function verifySignupCode(
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const code = (formData.get("code") as string)?.trim().replace(/\s+/g, "");

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email" };
  }
  if (!code || !/^\d{6,10}$/.test(code)) {
    return { error: "Enter the 8-digit code from the email" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (error || !data.user) {
    return {
      error:
        "Invalid or expired code. Use the code from the most recent email or request a new one.",
    };
  }

  const whatsapp = (data.user.user_metadata?.whatsapp as string | undefined) ?? null;
  if (whatsapp) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("profiles") as any)
      .update({ whatsapp })
      .eq("id", data.user.id)
      .is("whatsapp", null);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, onboarding_complete")
    .eq("id", data.user.id)
    .single<{ is_admin: boolean; onboarding_complete: boolean }>();

  if (profile?.is_admin) redirect("/admin");
  redirect(profile?.onboarding_complete ? "/dashboard" : "/onboarding");
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const firstName = formData.get("first_name") as string;
  const lastName = formData.get("last_name") as string;

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/onboarding");
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "Incorrect email or password." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", data.user.id)
    .single<{ is_admin: boolean }>();

  redirect(profile?.is_admin ? "/admin" : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
