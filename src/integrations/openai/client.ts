const BASE_URL = "https://api.openai.com/v1";
const MODEL = "gpt-4o";

function getHeaders(): Record<string, string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// --- Types ---

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIResponse {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// --- Functions ---

/** Generate an AI reply given a system prompt, conversation history, and the latest message. */
export async function generateReply(
  systemPrompt: string,
  history: ChatMessage[],
  latestMessage: string,
  channel: string,
  maxTokens: number = 1024
): Promise<OpenAIResponse> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${systemPrompt}\n\n[Channel: ${channel}]` },
    ...history,
    { role: "user", content: latestMessage },
  ];

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`OpenAI generateReply failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage,
  };
}

/** Extract structured information from a call transcript using a custom extraction prompt. */
export async function extractFromTranscript(
  transcript: string,
  extractionPrompt: string
): Promise<OpenAIResponse> {
  const messages: ChatMessage[] = [
    { role: "system", content: extractionPrompt },
    { role: "user", content: transcript },
  ];

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 2048 }),
  });
  if (!res.ok) throw new Error(`OpenAI extractFromTranscript failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage,
  };
}

/** Generate training data or summaries from scraped business data. */
export async function generateTrainingData(
  scrapedData: string
): Promise<OpenAIResponse> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a data processing assistant. Convert the following scraped business data into clean, structured training data for an AI receptionist. Output as JSON with Q&A pairs.",
    },
    { role: "user", content: scrapedData },
  ];

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`OpenAI generateTrainingData failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage,
  };
}
