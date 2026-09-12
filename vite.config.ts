import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const browserWebSocketShim = new URL('./src/web/shims/isomorphic-ws.ts', import.meta.url).pathname;

export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: [
      { find: /^assert$/, replacement: 'assert/' },
      { find: /^isomorphic-ws$/, replacement: browserWebSocketShim },
    ],
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer', 'assert'],
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
});
