import type { Config } from 'tailwindcss';

// White cinematic Apple language. Every colour maps to a CSS custom property in
// src/theme/tokens.css so the values live in exactly one place (tokens.ts mirrors
// them for SVG-drawn canvas parts that cannot read CSS variables).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--ugc-page)',
        canvas: 'var(--ugc-canvas)',
        surface: 'var(--ugc-surface)',
        hairline: 'var(--ugc-hairline)',
        ink: {
          DEFAULT: 'var(--ugc-ink)',
          muted: 'var(--ugc-ink-muted)',
          subtle: 'var(--ugc-ink-subtle)',
        },
        live: 'var(--ugc-live)',
        done: 'var(--ugc-done)',
        failed: 'var(--ugc-failed)',
        gated: 'var(--ugc-gated)',
      },
      borderRadius: {
        node: '16px',
        btn: '12px',
        slot: '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.06)',
        selected: '0 8px 30px rgba(0,0,0,.10)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
