const BASE = "https://api.outstand.so/v1";

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/** Carries the HTTP status, so callers can tell "Outstand is having a moment"
 *  from "we sent something wrong". A 500 is worth another go; a 400 never is. */
export class OutstandApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`Outstand API error ${status}: ${body}`);
    this.name = "OutstandApiError";
  }
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OutstandApiError(res.status, text);
  }
  return res.json() as Promise<T>;
}

// --- Social Networks ---

export async function registerSocialNetwork(
  apiKey: string,
  clientKey: string,
  clientSecret: string,
): Promise<{ id: string; network: string }> {
  const res = await fetch(`${BASE}/social-networks`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      network: "instagram",
      client_key: clientKey,
      client_secret: clientSecret,
    }),
  });
  const json = await handleResponse<{
    data: { id: string; network: string };
  }>(res);
  return json.data;
}

export async function getAuthUrl(
  apiKey: string,
  _socialNetworkId: string,
  redirectUri: string,
  tenantId?: string,
): Promise<string> {
  const body: Record<string, string> = { redirect_uri: redirectUri };
  if (tenantId) body.tenant_id = tenantId;

  const res = await fetch(`${BASE}/social-networks/instagram/auth-url`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  const json = await handleResponse<{ data: { auth_url: string } }>(res);
  return json.data.auth_url;
}

// --- Social Accounts ---

export interface OutstandSocialAccount {
  id: string;
  network: string;
  username: string;
  nickname: string;
  isActive: boolean;
  profile_picture_url?: string;
}

export async function listSocialAccounts(
  apiKey: string,
): Promise<OutstandSocialAccount[]> {
  const res = await fetch(`${BASE}/social-accounts?network=instagram`, {
    method: "GET",
    headers: headers(apiKey),
  });
  const json = await handleResponse<{ data: OutstandSocialAccount[] }>(res);
  return json.data;
}

// Fetch a connected account's display info (username + profile photo) by its id.
export async function getSocialAccountById(
  apiKey: string,
  accountId: string,
): Promise<{ username: string; profilePictureUrl: string | null } | null> {
  const accounts = await listSocialAccounts(apiKey);
  const a = accounts.find((x) => x.id === accountId);
  return a
    ? { username: a.username, profilePictureUrl: a.profile_picture_url ?? null }
    : null;
}

export interface OutstandIgMetrics {
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null; // the clickable "link in bio"
  profilePictureUrl: string | null;
  accountType: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  engagement: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    accountsEngaged: number;
    totalInteractions: number;
  };
}

/**
 * Why a metrics read failed, which is not a detail: a 401 means THIS creator's
 * Instagram authorisation is dead (we can no longer read their profile OR post
 * to it), while a 500 or a timeout means Outstand is having a moment and their
 * account is probably fine. Treating those two the same is how Ma. Edelyn spent
 * a day marked "all done" on a connection nothing could post through.
 */
export type MetricsFailure = "auth" | "not_found" | "transient";

export interface MetricsResult {
  metrics: OutstandIgMetrics | null;
  /** Only set when metrics is null. */
  failure: MetricsFailure | null;
  status: number | null;
}

/** Real Instagram profile + engagement metrics, with the reason on a failure. */
export async function getInstagramMetricsResult(
  apiKey: string,
  accountId: string,
): Promise<MetricsResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/social-accounts/${accountId}/metrics`, {
      method: "GET",
      headers: headers(apiKey),
    });
  } catch {
    return { metrics: null, failure: "transient", status: null };
  }
  if (!res.ok) {
    const failure: MetricsFailure =
      res.status === 401 || res.status === 403
        ? "auth"
        : res.status === 404
          ? "not_found"
          : "transient";
    return { metrics: null, failure, status: res.status };
  }
  const metrics = await parseMetrics(res);
  return metrics
    ? { metrics, failure: null, status: res.status }
    : { metrics: null, failure: "transient", status: res.status };
}

// Real Instagram profile + engagement metrics (available on Outstand's analytics tier).
export async function getInstagramMetrics(
  apiKey: string,
  accountId: string,
): Promise<OutstandIgMetrics | null> {
  const res = await fetch(`${BASE}/social-accounts/${accountId}/metrics`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) return null;
  return parseMetrics(res);
}

async function parseMetrics(res: Response): Promise<OutstandIgMetrics | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const d = json?.data;
  if (!d) return null;
  const ps = d.platform_specific ?? {};
  const e = d.engagement ?? {};
  return {
    username: ps.username ?? "",
    name: ps.name ?? null,
    biography: ps.biography ?? null,
    website: ps.website ?? null,
    profilePictureUrl: ps.profile_picture_url ?? null,
    accountType: ps.account_type ?? "BUSINESS",
    followersCount: d.followers_count ?? ps.followers_count ?? 0,
    followingCount: d.following_count ?? ps.follows_count ?? 0,
    postsCount: d.posts_count ?? ps.media_count ?? 0,
    engagement: {
      views: e.views ?? 0,
      likes: e.likes ?? 0,
      comments: e.comments ?? 0,
      shares: e.shares ?? 0,
      saves: e.saves ?? 0,
      reach: e.reach ?? 0,
      accountsEngaged: e.accounts_engaged ?? 0,
      totalInteractions: e.total_interactions ?? 0,
    },
  };
}

// Outstand's managed OAuth auto-connects the Instagram account against the tenant_id
// we passed when building the auth URL, then redirects back WITHOUT a session token.
// So after the OAuth we look the account up by that tenant_id. The window is generous
// (~15s) because Outstand's token exchange with Meta can lag behind its own redirect,
// and a transient fetch failure must not abort the remaining attempts.
//
// IMPORTANT: Outstand IGNORES the `tenant_id` query filter and returns EVERY Instagram
// account in the org. We therefore filter client-side by the tenant_id we bound for this
// round-trip (a fresh per-OAuth nonce, or the logged-in user's id). That value is unique
// to this attempt, so an exact match unambiguously identifies the just-connected account
// — picking "the newest account overall" instead would grab whoever connected most
// recently, i.e. the wrong person, when two signups overlap. Only if no account carries
// our tenant_id (legacy rows without the field, or a lag we can't wait out) do we fall
// back to the most recently connected one.
export async function getSocialAccountByTenant(
  apiKey: string,
  tenantId: string,
  attempts = 10,
): Promise<{ id: string; username: string; igUserId: string | null } | null> {
  type RawAccount = {
    id: string;
    username: string;
    createdAt?: string;
    network_unique_id?: string;
    tenant_id?: string;
  };
  // The STABLE Instagram user id (network_unique_id) survives username changes.
  const pick = (a: RawAccount) => ({
    id: a.id,
    username: a.username,
    igUserId: a.network_unique_id ?? null,
  });
  const newest = (list: RawAccount[]) =>
    [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];

  let fallback: ReturnType<typeof pick> | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(
        `${BASE}/social-accounts?network=instagram&tenant_id=${encodeURIComponent(tenantId)}`,
        { method: "GET", headers: headers(apiKey) },
      );
      const json = await handleResponse<{ data: RawAccount[] }>(res);
      const accounts = json.data ?? [];

      const mine = accounts.filter((a) => a.tenant_id === tenantId);
      if (mine.length > 0) return pick(newest(mine));

      // Remember the newest-overall once, in case our tenant never shows up.
      if (accounts.length > 0 && !fallback) fallback = pick(newest(accounts));
    } catch {
      // transient Outstand error — keep trying until the window closes
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return fallback;
}

// --- Pending Connections ---

export async function getPendingConnection(sessionToken: string): Promise<{
  network: string;
  availablePages: Array<{ id: string; name: string; username: string }>;
}> {
  const res = await fetch(`${BASE}/social-accounts/pending/${sessionToken}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const json = await handleResponse<{
    data: {
      network: string;
      availablePages: Array<{ id: string; name: string; username: string }>;
    };
  }>(res);
  return json.data;
}

export async function finalizeConnection(
  sessionToken: string,
  selectedPageIds: string[],
): Promise<Array<{ id: string; nickname: string; username: string; network: string }>> {
  const res = await fetch(`${BASE}/social-accounts/pending/${sessionToken}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedPageIds }),
  });
  const json = await handleResponse<{
    connectedAccounts: Array<{
      id: string;
      nickname: string;
      username: string;
      network: string;
    }>;
  }>(res);
  return json.connectedAccounts;
}

// --- Media Upload ---

export async function getUploadUrl(
  apiKey: string,
  filename: string,
  contentType: string,
): Promise<{ id: string; upload_url: string; expires_in: number }> {
  const res = await fetch(`${BASE}/media/upload`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ filename, content_type: contentType }),
  });
  const json = await handleResponse<{
    data: { id: string; upload_url: string; expires_in: number };
  }>(res);
  return json.data;
}

export async function confirmUpload(
  apiKey: string,
  mediaId: string,
  size?: number,
): Promise<{ id: string; url: string; filename: string; status: string }> {
  const res = await fetch(`${BASE}/media/${mediaId}/confirm`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(size ? { size } : {}),
  });
  const json = await handleResponse<{
    data: { id: string; url: string; filename: string; status: string };
  }>(res);
  return json.data;
}

// --- Posts ---

/** One attachment on a container.
 *
 *  Outstand takes the media as OBJECTS carrying a url and a filename, not the
 *  ids the upload endpoint hands back. Sending `mediaIds: [id]` is accepted
 *  with a 200 and then SILENTLY DROPPED: the created post comes back with
 *  `media: []` and Instagram rejects it later with "At least one media file
 *  (image or video) is required". Three real posts died that way on 08 Aug
 *  2026, which was the first time this code path had ever run for real.
 *
 *  Verified against the live API the same day. `confirmUpload` returns exactly
 *  these two fields, so the upload flow feeds this directly. A publicly
 *  reachable url we host ourselves is also accepted. */
export interface OutstandMedia {
  url: string;
  filename: string;
}

export interface CreatePostParams {
  content: string;
  media: OutstandMedia[];
  socialAccountIds: string[];
  scheduledAt?: string;
  instagram?: {
    publishAsStory?: boolean;
    collaborators?: string[]; // up to 3 public IG usernames (feed/reel only)
    reelThumbOffset?: number; // Reel cover frame, in milliseconds
  };
  // Posted automatically as a reply once the post is live (Outstand publishes
  // every container after the first as a comment).
  firstComment?: string;
}

export async function createPost(
  apiKey: string,
  params: CreatePostParams,
): Promise<{
  id: string;
  socialAccounts: Array<{ id: string; status: string }>;
}> {
  const containers: Array<Record<string, unknown>> = [
    {
      content: params.content,
      media: params.media,
    },
  ];
  if (params.firstComment) containers.push({ content: params.firstComment });

  const body: Record<string, unknown> = {
    containers,
    accounts: params.socialAccountIds,
  };

  if (params.scheduledAt) body.scheduledAt = params.scheduledAt;
  if (params.instagram) body.instagram = params.instagram;

  const res = await fetch(`${BASE}/posts/`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  const json = await handleResponse<{
    post: {
      id: string;
      socialAccounts: Array<{ id: string; status: string }>;
    };
  }>(res);
  return json.post;
}

/** What one published video actually did.
 *
 *  THE ENDPOINT IS `/analytics`. A note in this repo previously said Outstand
 *  had no per-post metrics at all, because `/posts/{id}/metrics` and
 *  `/posts/{id}/insights` both 404 and those were the only two tried. They are
 *  the wrong names. `/posts/{id}/analytics` returns 200 with real numbers, and
 *  did so for all 14 posts we had published when this was written. */
export interface OutstandPostAnalytics {
  platformPostId: string | null;
  /** The live Instagram permalink, also served here, so a post whose url we
   *  never stored at publish time can still be recovered. */
  platformPostUrl: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
}

/** Split out from the fetch so the live payload can be tested without a network.
 *  Zero is kept as zero: a reel with no views yet has been measured, and
 *  turning that into null would render as "unmeasured" and hide a flop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePostAnalytics(json: any): OutstandPostAnalytics | null {
  const a = json?.metrics_by_account?.[0];
  if (!a) return null;
  const m = a.metrics ?? {};
  const ps = m.platform_specific ?? {};
  // Instagram spells it "saved" inside platform_specific and "saves" outside.
  const num = (...vs: unknown[]): number | null => {
    for (const v of vs) if (typeof v === "number") return v;
    return null;
  };
  return {
    platformPostId: a.platform_post_id ?? null,
    platformPostUrl: a.platform_post_url ?? null,
    views: num(m.views, ps.views),
    likes: num(m.likes, ps.likes),
    comments: num(m.comments, ps.comments),
    shares: num(m.shares, ps.shares),
    saves: num(m.saves, ps.saved, ps.saves),
    reach: num(m.reach, ps.reach),
  };
}

export async function getPostAnalytics(
  apiKey: string,
  postId: string,
): Promise<OutstandPostAnalytics | null> {
  const res = await fetch(`${BASE}/posts/${postId}/analytics`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) {
    // A 404 here means the post is gone from Outstand, which is permanent; a
    // 5xx means try again next hour. Both are "no numbers this time", and the
    // caller treats a null as skip-and-keep-what-we-had rather than as zero.
    return null;
  }
  return parsePostAnalytics(await res.json());
}

export async function getPostStatus(
  apiKey: string,
  postId: string,
): Promise<{
  id: string;
  publishedAt: string | null;
  socialAccounts: Array<{
    id: string;
    status: string;
    platformPostId?: string;
    /** The live Instagram permalink. The only per-post link we ever get. */
    platformPostUrl?: string;
    error?: string;
  }>;
}> {
  const res = await fetch(`${BASE}/posts/${postId}`, {
    method: "GET",
    headers: headers(apiKey),
  });
  const json = await handleResponse<{
    post: {
      id: string;
      publishedAt: string | null;
      socialAccounts: Array<{
        id: string;
        status: string;
        platformPostId?: string;
    /** The live Instagram permalink. The only per-post link we ever get. */
    platformPostUrl?: string;
        error?: string;
      }>;
    };
  }>(res);
  return json.post;
}
