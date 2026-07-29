import type { Config } from 'tailwindcss';

/**
 * global.css :root의 CSS 변수를 Tailwind 색상으로 매핑 → 토큰 단일 소스 유지.
 * 사용 예: bg-panel, border-line, text-sub, text-mut, bg-panel2, text-brand, rounded-card, font-mono
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        panel2: 'var(--panel-2)',
        line: 'var(--border)',
        row: 'var(--row)',
        brand: 'var(--brand)',
        fg: 'var(--text)',
        sub: 'var(--text-sub)',
        mut: 'var(--text-mut)',
      },
      fontFamily: {
        sans: 'var(--sans)',
        mono: 'var(--mono)',
      },
      borderRadius: {
        card: 'var(--radius)',
      },
    },
  },
  plugins: [],
} satisfies Config;
