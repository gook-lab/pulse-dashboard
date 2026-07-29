import type { Config } from 'tailwindcss';

// global.css의 CSS 변수(--bg, --panel …)를 단일 소스로 두고 Tailwind 색상으로 매핑.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        panel2: 'var(--panel-2)',
        row: 'var(--row)',
        line: 'var(--border)',
        brand: 'var(--brand)',
        fg: 'var(--text)',
        sub: 'var(--text-sub)',
        mut: 'var(--text-mut)',
      },
      borderRadius: { card: '14px' },
      fontFamily: { mono: 'var(--mono)' },
    },
  },
  plugins: [],
} satisfies Config;
