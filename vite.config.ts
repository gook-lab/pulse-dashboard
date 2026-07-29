import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// M1 dev server. Backend (M0) will be proxied under /api once it exists.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5180,
    proxy: { '/api': 'http://localhost:8080' },  // M0 백엔드 (server/index.mjs)
  },
  // @ts-expect-error vitest 전용 옵션 — vite5 타입에는 없음(런타임에는 vitest가 읽음)
  test: {
    // 에이전트 격리 워크트리(.claude/worktrees)의 사본 테스트가 중복 수집되는 것 방지
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
