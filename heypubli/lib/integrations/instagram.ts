const INSTAGRAM_API = "https://graph.instagram.com";
const INSTAGRAM_OAUTH = "https://api.instagram.com/oauth";

export function getInstagramAuthUrl(redirectUri: string) {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: redirectUri,
    scope: "instagram_business_basic,instagram_business_content_publish",
    response_type: "code",
    state: crypto.randomUUID(),
  });
  return `${INSTAGRAM_OAUTH}/authorize?${params}`;
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const res = await fetch(`${INSTAGRAM_OAUTH}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.error_message ?? data.error?.message ?? data.message ?? JSON.stringify(data),
    );
  }
  return data as { access_token: string; user_id: string };
}

export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: process.env.INSTAGRAM_APP_SECRET!,
    access_token: shortLivedToken,
  });
  const res = await fetch(`${INSTAGRAM_API}/access_token?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Long-lived token exchange failed");
  return data as { access_token: string; expires_in: number };
}

export async function refreshLongLivedToken(token: string) {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: token,
  });
  const res = await fetch(`${INSTAGRAM_API}/refresh_access_token?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Token refresh failed");
  return data as { access_token: string; expires_in: number };
}

export async function getInstagramProfile(token: string) {
  const res = await fetch(
    `${INSTAGRAM_API}/me?fields=user_id,username,account_type,media_count,profile_picture_url,name,biography,followers_count,follows_count&access_token=${token}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Profile fetch failed");
  return data as {
    user_id: string;
    username: string;
    account_type: string;
    media_count: number;
    profile_picture_url?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    follows_count?: number;
  };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";
  media_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export async function getInstagramMedia(
  token: string,
  limit = 25,
): Promise<InstagramMedia[]> {
  const res = await fetch(
    `${INSTAGRAM_API}/me/media?fields=id,caption,media_type,media_url,timestamp,like_count,comments_count&limit=${limit}&access_token=${token}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Media fetch failed");
  return (data.data ?? []) as InstagramMedia[];
}

export type MediaType = "IMAGE" | "VIDEO" | "STORIES" | "REELS" | "CAROUSEL";

interface CreateContainerParams {
  igUserId: string;
  token: string;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  mediaType?: "STORIES" | "REELS" | "CAROUSEL";
  coverUrl?: string;
  children?: string[];
}

export async function createMediaContainer(params: CreateContainerParams) {
  const body: Record<string, string> = { access_token: params.token };

  if (params.imageUrl) body.image_url = params.imageUrl;
  if (params.videoUrl) body.video_url = params.videoUrl;
  if (params.caption) body.caption = params.caption;
  if (params.mediaType) body.media_type = params.mediaType;
  if (params.coverUrl) body.cover_url = params.coverUrl;
  if (params.children) body.children = params.children.join(",");

  const res = await fetch(`${INSTAGRAM_API}/${params.igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Container creation failed");
  return data as { id: string };
}

export async function checkContainerStatus(containerId: string, token: string) {
  const res = await fetch(
    `${INSTAGRAM_API}/${containerId}?fields=status_code&access_token=${token}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Container status check failed");
  return data as {
    status_code: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  };
}

export async function publishMedia(igUserId: string, containerId: string, token: string) {
  const res = await fetch(`${INSTAGRAM_API}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: token,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Publish failed");
  return data as { id: string };
}
