const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

function getCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  return { clientId, clientSecret };
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
}

export function getAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

async function getValidToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  if (Date.now() < tokens.expiry_date - 60_000) return tokens;
  return refreshAccessToken(tokens);
}

export async function getFreeBusy(
  tokens: GoogleTokens,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<FreeBusySlot[]> {
  const valid = await getValidToken(tokens);
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${valid.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) throw new Error(`Google freeBusy failed: ${await res.text()}`);
  const data = await res.json() as { calendars?: Record<string, { busy?: FreeBusySlot[] }> };
  return data.calendars?.[calendarId]?.busy ?? [];
}

export async function createEvent(
  tokens: GoogleTokens,
  calendarId: string,
  summary: string,
  description: string,
  startTime: string,
  endTime: string,
): Promise<CalendarEvent> {
  const valid = await getValidToken(tokens);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${valid.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: startTime },
        end: { dateTime: endTime },
      }),
    },
  );
  if (!res.ok) throw new Error(`Google createEvent failed: ${await res.text()}`);
  const data = await res.json() as {
    id: string; summary: string; htmlLink: string;
    start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  };
  return {
    id: data.id,
    summary: data.summary,
    start: data.start?.dateTime ?? data.start?.date ?? startTime,
    end: data.end?.dateTime ?? data.end?.date ?? endTime,
    htmlLink: data.htmlLink,
  };
}

export async function listCalendars(
  tokens: GoogleTokens,
): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const valid = await getValidToken(tokens);
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${valid.access_token}` },
  });
  if (!res.ok) throw new Error(`Google listCalendars failed: ${await res.text()}`);
  const data = await res.json() as { items?: Array<{ id: string; summary: string; primary?: boolean }> };
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary === true,
  }));
}
