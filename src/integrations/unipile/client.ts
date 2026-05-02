function getConfig() {
  const token = process.env.UNIPILE_TOKEN;
  const dsn = process.env.UNIPILE_DSN;
  if (!token || !dsn) throw new Error("UNIPILE_TOKEN and UNIPILE_DSN must be set");
  return { token, baseUrl: `https://${dsn}/api/v1` };
}

function getHeaders(): Record<string, string> {
  const { token } = getConfig();
  return {
    "X-API-KEY": token,
    "Content-Type": "application/json",
  };
}

// --- Types ---

export interface HostedLinkResponse {
  url: string;
  [key: string]: unknown;
}

export interface UnipileAccount {
  id: string;
  provider: string;
  status: string;
  [key: string]: unknown;
}

export interface UnipileMessage {
  id: string;
  text: string;
  sender_id: string;
  [key: string]: unknown;
}

export interface SendMessageResponse {
  id: string;
  [key: string]: unknown;
}

// --- Functions ---

/** Create a hosted connect link for WhatsApp QR or Email OAuth. */
export async function createHostedLink(
  provider: string,
  businessId: string,
  successUrl: string,
  failureUrl: string,
  notifyUrl: string
): Promise<HostedLinkResponse> {
  const { baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}/hosted/accounts/link`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      provider,
      expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      success_redirect_url: successUrl,
      failure_redirect_url: failureUrl,
      notify_url: notifyUrl,
      api_url: baseUrl,
      name: businessId,
    }),
  });
  if (!res.ok) throw new Error(`Unipile createHostedLink failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Get a connected account by ID. */
export async function getAccount(accountId: string): Promise<UnipileAccount> {
  const { baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}/accounts/${accountId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Unipile getAccount failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** List recent messages for a connected account. */
export async function listMessages(
  accountId: string,
  limit: number = 20
): Promise<UnipileMessage[]> {
  const { baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}/messages?account_id=${accountId}&limit=${limit}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Unipile listMessages failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.items ?? data;
}

/** Send a WhatsApp message via a connected account. */
export async function sendWhatsApp(
  accountId: string,
  recipientId: string,
  text: string
): Promise<SendMessageResponse> {
  const { baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      account_id: accountId,
      chat_id: recipientId,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Unipile sendWhatsApp failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Send an email via a connected email account. */
export async function sendEmail(
  accountId: string,
  to: string,
  subject: string,
  body: string
): Promise<SendMessageResponse> {
  const { baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}/emails`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      account_id: accountId,
      to: [{ email: to }],
      subject,
      body,
    }),
  });
  if (!res.ok) throw new Error(`Unipile sendEmail failed: ${res.status} ${await res.text()}`);
  return res.json();
}
