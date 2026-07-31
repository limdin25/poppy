// Gemini image builders: the composite stage. Nano Banana 2 drafts, Nano
// Banana Pro finals, one key, multi-reference identity preservation.
// FLAG verified-at-bake-off: exact model ids and the imageSize switch.

export const GEMINI_DRAFT_MODEL = 'gemini-3.1-flash-image';
export const GEMINI_FINAL_MODEL = 'gemini-3-pro-image';

export interface GeminiImageRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
    generationConfig: {
      responseModalities: string[];
      imageConfig: { aspectRatio: string; imageSize?: string };
    };
  };
}

export function buildGeminiImageRequest(args: {
  apiKey: string;
  model: string;
  prompt: string;
  referenceImages: Array<{ mime: string; base64: string }>;
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
}): GeminiImageRequest {
  if (!args.prompt.trim()) throw new Error('The composite needs a prompt');
  if (!args.referenceImages.length) throw new Error('The composite needs reference images');
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent`,
    headers: { 'x-goog-api-key': args.apiKey, 'Content-Type': 'application/json' },
    body: {
      contents: [
        {
          parts: [
            { text: args.prompt },
            ...args.referenceImages.map((r) => ({
              inline_data: { mime_type: r.mime, data: r.base64 },
            })),
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: args.aspectRatio ?? '9:16',
          ...(args.imageSize ? { imageSize: args.imageSize } : {}),
        },
      },
    },
  };
}

// Pulls the image out of a generateContent response.
export function extractGeminiImage(response: {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
}): { mime: string; base64: string } {
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return { mime: part.inlineData.mimeType ?? 'image/png', base64: part.inlineData.data };
      }
    }
  }
  throw new Error('Gemini returned no image');
}
