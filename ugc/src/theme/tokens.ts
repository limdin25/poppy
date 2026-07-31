// TS mirror of tokens.css for SVG-drawn canvas parts (React Flow edges and
// handles cannot read CSS variables in all paint paths). Keep in sync with
// tokens.css; both files are the same list in the same order.

export const TOKENS = {
  page: '#fafaf8',
  canvas: '#ffffff',
  grid: '#e9e9e4',
  surface: '#ffffff',
  hairline: '#e8e8e3',

  ink: '#1a1a1a',
  inkMuted: '#6b7280',
  inkSubtle: '#9ca3af',

  live: '#1a73e8',
  done: '#188038',
  failed: '#b42318',
  gated: '#b45309',

  bandInput: 'rgba(26, 115, 232, 0.05)',
  bandGeneration: 'rgba(124, 96, 232, 0.05)',
  bandOutput: 'rgba(24, 128, 56, 0.05)',

  edge: '#c9c9c2',
} as const;

export const EASE_APPLE = 'cubic-bezier(0.32, 0.72, 0, 1)';
