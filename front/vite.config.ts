import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3005,
        host: '0.0.0.0',
        hmr: false,
        proxy: {
          '/api': {
            target: 'http://localhost:3007',
            changeOrigin: true,
          },
          '/metadata': {
            target: 'http://localhost:3006',
            changeOrigin: true,
          },
          '/health': {
            target: 'http://localhost:3007',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        global: 'globalThis',
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        // Deduplicate React to avoid "multiple copies of React" error when
        // wagmi / @tanstack/react-query bundle their own React resolution
        dedupe: ['react', 'react-dom'],
      }
    };
});
