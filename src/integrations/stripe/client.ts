const BASE_URL = "https://api.stripe.com/v1";

function getHeaders(): Record<string, string> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

// --- Types ---

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  [key: string]: unknown;
}

export interface StripePortalSession {
  id: string;
  url: string;
  [key: string]: unknown;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  [key: string]: unknown;
}

// --- Functions ---

/** Create a Stripe Checkout session for subscription or one-time payment. */
export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<StripeCheckoutSession> {
  const body = new URLSearchParams({
    customer: customerId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  const res = await fetch(`${BASE_URL}/checkout/sessions`, {
    method: "POST",
    headers: getHeaders(),
    body,
  });
  if (!res.ok) throw new Error(`Stripe createCheckoutSession failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Create a Stripe Customer Portal session for managing billing. */
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<StripePortalSession> {
  const body = new URLSearchParams({
    customer: customerId,
    return_url: returnUrl,
  });

  const res = await fetch(`${BASE_URL}/billing_portal/sessions`, {
    method: "POST",
    headers: getHeaders(),
    body,
  });
  if (!res.ok) throw new Error(`Stripe createPortalSession failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Verify and construct a Stripe webhook event from the raw body and signature header. */
export function constructWebhookEvent(
  body: string,
  signature: string
): StripeEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const crypto = require("crypto") as typeof import("crypto");

  const elements = signature.split(",");
  const timestamp = elements.find((e) => e.startsWith("t="))?.slice(2);
  const v1Signature = elements.find((e) => e.startsWith("v1="))?.slice(3);

  if (!timestamp || !v1Signature) throw new Error("Invalid Stripe signature format");

  const payload = `${timestamp}.${body}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(v1Signature), Buffer.from(expected))) {
    throw new Error("Stripe webhook signature verification failed");
  }

  return JSON.parse(body) as StripeEvent;
}
