const BASE = "https://api.outstand.so/v1";

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Outstand API error ${res.status}: ${text}`);
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

export interface CreatePostParams {
  content: string;
  mediaIds: string[];
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
      mediaIds: params.mediaIds,
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
        error?: string;
      }>;
    };
  }>(res);
  return json.post;
}
