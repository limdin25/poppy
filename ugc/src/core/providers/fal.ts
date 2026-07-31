// fal.ai queue builders, pure. One shape reaches every fal-hosted model
// (Kling Avatar, OmniHuman fallback, the whole bake-off), so the worker and
// the bench share these three functions.

export interface FalRequest {
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

function headers(apiKey: string): Record<string, string> {
  if (!apiKey) throw new Error('fal key missing');
  return { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };
}

export function buildFalSubmit(args: {
  apiKey: string;
  modelPath: string;
  input: Record<string, unknown>;
}): FalRequest {
  if (!args.modelPath || args.modelPath.includes('://')) {
    throw new Error(`Bad fal model path: ${args.modelPath}`);
  }
  return {
    url: `https://queue.fal.run/${args.modelPath}`,
    headers: headers(args.apiKey),
    body: args.input,
  };
}

// Status and result live under the BASE model path (first two segments) even
// when the submit path has a subpath suffix; fal routes them by request id.
export function falBasePath(modelPath: string): string {
  const parts = modelPath.split('/');
  return parts.slice(0, 2).join('/');
}

export function buildFalStatus(args: { apiKey: string; modelPath: string; requestId: string }): FalRequest {
  return {
    url: `https://queue.fal.run/${falBasePath(args.modelPath)}/requests/${args.requestId}/status`,
    headers: headers(args.apiKey),
  };
}

export function buildFalResult(args: { apiKey: string; modelPath: string; requestId: string }): FalRequest {
  return {
    url: `https://queue.fal.run/${falBasePath(args.modelPath)}/requests/${args.requestId}`,
    headers: headers(args.apiKey),
  };
}
