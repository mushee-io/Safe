import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
  },
});
