// Zernio — Google Business Profile aggregator API.
// The client's own Google account is OAuth-connected through Zernio, so we
// never need our own Google API approval. Docs: https://docs.zernio.com
// Auth: Bearer sk_… key. Rate limits scale with connected accounts (60→600 rpm).

const BASE = 'https://zernio.com/api/v1';

function getHeaders(): Record<string, string> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error('ZERNIO_API_KEY is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function zfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...getHeaders(), ...(init?.headers as Record<string, string> | undefined) } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zernio ${init?.method || 'GET'} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

// --- Profiles (one Zernio profile per client business) ---

export interface ZernioProfile {
  _id: string;
  name: string;
  accountUsernames?: string[];
}

export async function createProfile(name: string): Promise<ZernioProfile> {
  const data = await zfetch<{ profile?: ZernioProfile } & ZernioProfile>('/profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return (data as { profile?: ZernioProfile }).profile ?? (data as ZernioProfile);
}

export async function listProfiles(): Promise<ZernioProfile[]> {
  const data = await zfetch<{ profiles: ZernioProfile[] }>('/profiles');
  return data.profiles;
}

// --- Connect (Google OAuth handled by Zernio; client picks their location) ---

export async function getGoogleConnectUrl(profileId: string, redirectUrl: string): Promise<string> {
  const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const data = await zfetch<{ authUrl: string }>(`/connect/googlebusiness?${qs}`);
  return data.authUrl;
}

// --- Location details (gives us the public "write a review" URL + place id) ---

export interface ZernioLocationSummary {
  name: string | null;
  placeId: string | null;
  reviewUrl: string | null;
  mapsUri: string | null;
  isVerified: boolean;
}

export async function getLocationDetails(accountId: string): Promise<{ location: ZernioLocationSummary; title?: string }> {
  const qs = new URLSearchParams({ readMask: 'name,title' });
  return zfetch(`/accounts/${accountId}/gmb-location-details?${qs}`);
}

// --- Reviews ---

export interface ZernioReview {
  id: string;
  name: string; // full resource name accounts/*/locations/*/reviews/*
  reviewer: { displayName: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  rating: number;
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string } | null;
}

export async function listReviews(accountId: string, pageToken?: string): Promise<{
  reviews: ZernioReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}> {
  const qs = new URLSearchParams({ pageSize: '50' });
  if (pageToken) qs.set('pageToken', pageToken);
  return zfetch(`/accounts/${accountId}/gmb-reviews?${qs}`);
}

/** Reply to a review. Calling again overwrites the previous reply. reviewId = ID portion only. */
export async function replyToReview(accountId: string, reviewId: string, comment: string): Promise<void> {
  await zfetch(`/accounts/${accountId}/gmb-reviews/${encodeURIComponent(reviewId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

// --- GBP posts (review repurposing) ---

export async function createGbpPost(opts: {
  accountId: string;
  content: string;           // ≤1500 chars
  imageUrl?: string;         // public HTTPS, JPEG/PNG, ≥400x300, ≤5MB
  ctaUrl?: string;
  requestId?: string;        // idempotency
}): Promise<{ id?: string }> {
  const platform: Record<string, unknown> = {
    platform: 'googlebusiness',
    accountId: opts.accountId,
    platformSpecificData: {
      topicType: 'STANDARD',
      ...(opts.ctaUrl ? { callToAction: { type: 'LEARN_MORE', url: opts.ctaUrl } } : {}),
    },
  };
  return zfetch('/posts', {
    method: 'POST',
    headers: opts.requestId ? { 'x-request-id': opts.requestId } : undefined,
    body: JSON.stringify({
      content: opts.content,
      ...(opts.imageUrl ? { mediaItems: [{ type: 'image', url: opts.imageUrl }] } : {}),
      platforms: [platform],
      publishNow: true,
    }),
  });
}

// --- Facebook / Instagram social posting ---
// Same Zernio account & profile as GBP. Standard (non-headless) connect mode:
// Zernio hosts the OAuth + page/account picker and redirects back with
// ?connected={platform}&profileId=…&accountId=…&username=…

export type SocialPlatform = 'facebook' | 'instagram';

export async function getSocialConnectUrl(platform: SocialPlatform, profileId: string, redirectUrl: string): Promise<string> {
  const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const data = await zfetch<{ authUrl: string }>(`/connect/${platform}?${qs}`);
  return data.authUrl;
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  isActive?: boolean;
}

/** Connected accounts for a profile, optionally filtered to one platform. */
export async function listAccounts(profileId: string, platform?: SocialPlatform): Promise<ZernioAccount[]> {
  const qs = new URLSearchParams({ profileId, status: 'connected' });
  if (platform) qs.set('platform', platform);
  const data = await zfetch<{ accounts: ZernioAccount[] }>(`/accounts?${qs}`);
  return data.accounts ?? [];
}

/** Publish (or schedule) an image post to a connected FB/IG account. */
export async function createSocialPost(opts: {
  platform: SocialPlatform;
  accountId: string;
  content: string;
  imageUrl?: string;               // public HTTPS JPEG/PNG (IG feed requires media)
  contentType?: 'story' | 'reels'; // omit for a feed post
  scheduledFor?: string;           // ISO 8601; when omitted, publishNow
  requestId?: string;              // idempotency (UUID)
}): Promise<{ id?: string; platformPostUrl?: string }> {
  const platformSpecificData: Record<string, unknown> = {};
  if (opts.contentType) {
    platformSpecificData.contentType = opts.contentType;
    if (opts.platform === 'instagram' && opts.contentType === 'reels') platformSpecificData.shareToFeed = true;
  }
  const body: Record<string, unknown> = {
    content: opts.content,
    ...(opts.imageUrl ? { mediaItems: [{ type: 'image', url: opts.imageUrl }] } : {}),
    platforms: [{ platform: opts.platform, accountId: opts.accountId, platformSpecificData }],
    ...(opts.scheduledFor ? { scheduledFor: opts.scheduledFor, timezone: 'Europe/London' } : { publishNow: true }),
  };
  const res = await zfetch<Record<string, unknown>>('/posts', {
    method: 'POST',
    headers: opts.requestId ? { 'x-request-id': opts.requestId } : undefined,
    body: JSON.stringify(body),
  });
  const post = (res.post ?? res) as { _id?: string; platforms?: Array<{ platformPostUrl?: string }> };
  const url = (res.platformPostUrl as string | undefined) ?? post.platforms?.[0]?.platformPostUrl;
  return { id: post._id, platformPostUrl: url };
}

// --- Analytics (dashboard panel) ---

export async function getGbpPerformance(accountId: string, startDate: string, endDate: string): Promise<unknown> {
  const qs = new URLSearchParams({ accountId, startDate, endDate });
  return zfetch(`/analytics/googlebusiness/performance?${qs}`);
}

// --- Webhooks ---

export async function createWebhookSetting(opts: {
  name: string;
  url: string;
  secret: string;
  events: string[];
}): Promise<{ id?: string }> {
  return zfetch('/webhooks/settings', {
    method: 'POST',
    body: JSON.stringify({ ...opts, isActive: true }),
  });
}

export async function listWebhookSettings(): Promise<unknown> {
  return zfetch('/webhooks/settings');
}

/** Verify X-Zernio-Signature: lowercase hex HMAC-SHA256 of the raw body. Edge-safe. */
export async function verifyZernioSignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === signature.trim().toLowerCase();
}
