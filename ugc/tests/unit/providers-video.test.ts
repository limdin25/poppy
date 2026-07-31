// Image and video provider builders: exact queue URLs, keys only ever in
// headers, required inputs refused loudly.

import { describe, it, expect } from 'vitest';
import { buildFalSubmit, buildFalStatus, buildFalResult, falBasePath } from '../../src/core/providers/fal';
import { buildKlingAvatarSubmit, KLING_AVATAR_MODEL_PATH } from '../../src/core/providers/kling';
import { buildOmniHumanSubmit, OMNIHUMAN_MAX_SECONDS } from '../../src/core/providers/omnihuman';
import { buildGeminiImageRequest, extractGeminiImage } from '../../src/core/providers/gemini';

describe('fal queue builders', () => {
  it('submit posts to the model path with the key in the header only', () => {
    const r = buildFalSubmit({ apiKey: 'fk-1', modelPath: 'fal-ai/some/model', input: { a: 1 } });
    expect(r.url).toBe('https://queue.fal.run/fal-ai/some/model');
    expect(r.headers['Authorization']).toBe('Key fk-1');
    expect(r.url).not.toContain('fk-1');
  });

  it('status and result route by the BASE model path (fal drops subpaths)', () => {
    expect(falBasePath('fal-ai/kling-video/ai-avatar/v2/standard')).toBe('fal-ai/kling-video');
    const s = buildFalStatus({ apiKey: 'k', modelPath: 'fal-ai/kling-video/ai-avatar/v2/standard', requestId: 'req-9' });
    expect(s.url).toBe('https://queue.fal.run/fal-ai/kling-video/requests/req-9/status');
    const res = buildFalResult({ apiKey: 'k', modelPath: 'fal-ai/x/y', requestId: 'req-9' });
    expect(res.url).toBe('https://queue.fal.run/fal-ai/x/requests/req-9');
  });

  it('rejects a full URL passed as a model path', () => {
    expect(() => buildFalSubmit({ apiKey: 'k', modelPath: 'https://evil', input: {} })).toThrow();
  });
});

describe('kling avatar builder (the launch default)', () => {
  it('needs image + audio, carries the behavioral prompt', () => {
    const r = buildKlingAvatarSubmit({ apiKey: 'k', imageUrl: 'https://i', audioUrl: 'https://a', prompt: 'smile' });
    expect(r.url).toContain(KLING_AVATAR_MODEL_PATH);
    expect(r.body).toEqual({ image_url: 'https://i', audio_url: 'https://a', prompt: 'smile' });
    expect(() => buildKlingAvatarSubmit({ apiKey: 'k', imageUrl: '', audioUrl: 'https://a' })).toThrow();
    expect(() => buildKlingAvatarSubmit({ apiKey: 'k', imageUrl: 'https://i', audioUrl: '' })).toThrow();
  });
});

describe('omnihuman builder (the premium contender)', () => {
  it('same contract as kling, 30s cap exported for the chunk planner', () => {
    const r = buildOmniHumanSubmit({ apiKey: 'k', imageUrl: 'https://i', audioUrl: 'https://a' });
    expect(r.url).toContain('omnihuman');
    expect(OMNIHUMAN_MAX_SECONDS).toBe(30);
  });
});

describe('gemini image builder', () => {
  it('builds generateContent with prompt + inline reference images', () => {
    const r = buildGeminiImageRequest({
      apiKey: 'gk',
      model: 'gemini-3-pro-image',
      prompt: 'person holding product',
      referenceImages: [
        { mime: 'image/png', base64: 'AAA' },
        { mime: 'image/jpeg', base64: 'BBB' },
      ],
      imageSize: '2K',
    });
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent');
    expect(r.headers['x-goog-api-key']).toBe('gk');
    expect(r.url).not.toContain('gk');
    expect(r.body.contents[0]!.parts).toHaveLength(3);
    expect(r.body.generationConfig.imageConfig).toEqual({ aspectRatio: '9:16', imageSize: '2K' });
  });

  it('refuses a promptless or referenceless composite', () => {
    expect(() =>
      buildGeminiImageRequest({ apiKey: 'k', model: 'm', prompt: ' ', referenceImages: [{ mime: 'x', base64: 'y' }] }),
    ).toThrow();
    expect(() =>
      buildGeminiImageRequest({ apiKey: 'k', model: 'm', prompt: 'p', referenceImages: [] }),
    ).toThrow();
  });

  it('extracts the image or throws (never a silent empty asset)', () => {
    expect(
      extractGeminiImage({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'IMG' } }] } }],
      }),
    ).toEqual({ mime: 'image/png', base64: 'IMG' });
    expect(() => extractGeminiImage({ candidates: [] })).toThrow();
  });
});
