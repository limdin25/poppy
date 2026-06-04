const BASE_URL = "https://api.tavily.com";

// --- Types ---

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilySearchResponse {
  answer?: string;
  results: TavilyResult[];
}

// --- Functions ---

/**
 * Search the web via Tavily — built for AI agents, returns a short synthesised
 * `answer` plus the top source snippets. Kept fast (basic depth) because this
 * runs mid-call and the caller is waiting on the line.
 */
export async function webSearch(
  query: string,
  maxResults: number = 3,
): Promise<TavilySearchResponse> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");

  const res = await fetch(`${BASE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: maxResults,
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { answer?: string; results?: TavilyResult[] };
  return { answer: data.answer, results: data.results ?? [] };
}
