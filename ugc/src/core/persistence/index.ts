// Backend selection. 'mock' is the default in dev and the ONLY mode the e2e
// suite runs in; 'http' arrives in step 12 behind this same interface.

import type { UgcBackend } from './backend';
import { MockBackend } from './mockBackend';

let instance: UgcBackend | null = null;

export function backend(): UgcBackend {
  if (instance) return instance;
  const mode = import.meta.env.VITE_UGC_API_MODE ?? 'mock';
  if (mode === 'http') {
    throw new Error('The http backend lands in step 12; run with VITE_UGC_API_MODE=mock');
  }
  instance = new MockBackend();
  return instance;
}
