import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const browserWebSocketShim = fileURLToPath(new URL('./src/web/shims/isomorphic-ws.ts', import.meta.url));

export default defineConfig({
  // Midnight's browser runtime loads its on-chain WASM through ESM. Modern
  // browsers support native top-level await, so keep the emitted module native
  // instead of rewriting it through vite-plugin-top-level-await (which crashes
  // during Rollup/SWC code generation under this Vite toolchain).
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
