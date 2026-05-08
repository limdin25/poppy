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

export interface RetellLLM {
  llm_id: string;
  version: number;
  general_prompt?: string;
  model?: string;
  general_tools?: RetellTool[];
  [key: string]: unknown;
}

export interface RetellTool {
  name: string;
  type: string;
  description?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  parameters?: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  speak_during_execution?: boolean;
  speak_after_execution?: boolean;
  variables?: Array<{ type: string; name: string; description: string }>;
}

export interface RetellAgent {
  agent_id: string;
  agent_name?: string;
  voice_id?: string;
  language?: string;
  webhook_url?: string;
  response_engine?: {
    type: string;
    llm_id: string;
    version?: number;
  };
  [key: string]: unknown;
}

// --- LLM Functions ---

export async function createLLM(
  generalPrompt: string,
  tools?: RetellTool[],
): Promise<RetellLLM> {
  const body: Record<string, unknown> = {
    general_prompt: generalPrompt,
    model: "claude-4.6-sonnet",
    general_tools: tools || [{ name: "end_call", type: "end_call" }],
  };

  const res = await fetch(`${BASE_URL}/create-retell-llm`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Retell createLLM failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function updateLLM(
  llmId: string,
  updates: Partial<Pick<RetellLLM, "general_prompt" | "model" | "general_tools">>,
): Promise<RetellLLM> {
  const res = await fetch(`${BASE_URL}/update-retell-llm/${llmId}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Retell updateLLM failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getLLM(llmId: string): Promise<RetellLLM> {
  const res = await fetch(`${BASE_URL}/get-retell-llm/${llmId}`, {
    method: "GET",
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Retell getLLM failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Agent Functions ---

export async function createAgent(
  name: string,
  llmId: string,
  voiceId: string = "retell-Willa",
): Promise<RetellAgent> {
  const res = await fetch(`${BASE_URL}/create-agent`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      agent_name: name,
      response_engine: { type: "retell-llm", llm_id: llmId },
      voice_id: voiceId,
      language: "en-GB",
      enable_backchannel: true,
      webhook_url: `${process.env.APP_URL || "https://app.heyelsie.com"}/api/webhooks/retell`,
    }),
  });
  if (!res.ok) throw new Error(`Retell createAgent failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function updateAgent(
  agentId: string,
  updates: Partial<Pick<RetellAgent, "agent_name" | "voice_id" | "language" | "webhook_url"> & { response_engine?: { type: string; llm_id: string } }>,
): Promise<RetellAgent> {
  const res = await fetch(`${BASE_URL}/update-agent/${agentId}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Retell updateAgent failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getAgent(agentId: string): Promise<RetellAgent> {
  const res = await fetch(`${BASE_URL}/get-agent/${agentId}`, {
    method: "GET",
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Retell getAgent failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/delete-agent/${agentId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Retell deleteAgent failed: ${res.status} ${await res.text()}`);
}

// --- Phone Number Functions ---

export async function importPhoneNumber(
  phoneNumber: string,
  terminationUri: string,
  agentId: string,
  authUsername?: string,
  authPassword?: string,
): Promise<{ phone_number: string; phone_number_type: string }> {
  const body: Record<string, unknown> = {
    phone_number: phoneNumber,
    termination_uri: terminationUri,
    inbound_agents: [{ agent_id: agentId, weight: 1 }],
  };
  if (authUsername) {
    body.sip_trunk_auth_username = authUsername;
    body.sip_trunk_auth_password = authPassword;
  }

  const res = await fetch(`${BASE_URL}/import-phone-number`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Retell importPhoneNumber failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Webhook Verification (Web Crypto API — edge-compatible) ---

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("RETELL_API_KEY is not set");

  const match = signatureHeader.match(/v=(\d+),d=(.*)/);
  if (!match) return false;

  const timestamp = match[1];
  const digest = match[2];

  // Reject stale signatures (>5 min)
  const fiveMinMs = 5 * 60 * 1000;
  if (Date.now() - parseInt(timestamp) > fiveMinMs) return false;

  const message = rawBody + timestamp;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === digest;
}
