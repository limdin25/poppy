// Backend selection. 'mock' is the default in dev and what the spend-free
// e2e suite runs against; 'http' is production (real Supabase + serverless).

import type { UgcBackend } from './backend';
import { MockBackend } from './mockBackend';
import { HttpBackend } from './httpBackend';

let instance: UgcBackend | null = null;

export function backend(): UgcBackend {
  if (instance) return instance;
  const mode = import.meta.env.VITE_UGC_API_MODE ?? 'mock';
  instance = mode === 'http' ? new HttpBackend() : new MockBackend();
  return instance;
}
