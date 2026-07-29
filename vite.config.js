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
        proxy: { '/api': 'http://localhost:8080' }, // M0 백엔드 (server/index.mjs)
    },
});
