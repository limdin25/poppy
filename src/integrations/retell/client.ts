const BASE_URL = "https://api.retellai.com";

function getHeaders(): Record<string, string> {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("RETELL_API_KEY is not set");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// --- Types ---

export interface RetellAgent {
  agent_id: string;
  agent_name: string;
  [key: string]: unknown;
}

export interface RetellAgentUpdate {
  agent_name?: string;
  llm_websocket_url?: string;
  voice_id?: string;
  [key: string]: unknown;
}

// --- Functions ---

/** Create a new Retell AI agent with a name and system prompt. */
export async function createAgent(
  name: string,
  systemPrompt: string
): Promise<RetellAgent> {
  const res = await fetch(`${BASE_URL}/create-agent`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ agent_name: name, general_prompt: systemPrompt }),
  });
  if (!res.ok) throw new Error(`Retell createAgent failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Update an existing Retell agent by ID. */
export async function updateAgent(
  agentId: string,
  updates: RetellAgentUpdate
): Promise<RetellAgent> {
  const res = await fetch(`${BASE_URL}/update-agent/${agentId}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Retell updateAgent failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Delete a Retell agent by ID. */
export async function deleteAgent(agentId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/delete-agent/${agentId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Retell deleteAgent failed: ${res.status} ${await res.text()}`);
}

/** Verify a Retell webhook signature. Returns true if valid. */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret) throw new Error("RETELL_WEBHOOK_SECRET is not set");
  // Retell uses HMAC-SHA256 for webhook verification
  const crypto = require("crypto") as typeof import("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
