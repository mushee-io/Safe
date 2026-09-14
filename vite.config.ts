import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const browserWebSocketShim = new URL('./src/web/shims/isomorphic-ws.ts', import.meta.url).pathname;

// Compact-generated contract bindings, midnight-js-protocol and Midnight's
// transaction rehearsal path exchange identity-sensitive runtime/WASM values.
// They must resolve to one browser module instance or calls can fail with
// wasm-bindgen `expected instance of ...` errors even after deployment succeeds.
const MIDNIGHT_SINGLETON_MODULES = [
  '@midnight-ntwrk/compact-runtime',
  '@midnight-ntwrk/midnight-js-protocol',
  '@midnight-ntwrk/onchain-runtime-v3',
];

export default defineConfig({
  // Midnight's browser runtime loads its on-chain WASM through ESM. Modern
  // browsers support native top-level await, so keep the emitted module native
  // instead of rewriting it through vite-plugin-top-level-await.
  plugins: [wasm()],
  resolve: {
    // Force generated Compact code and MidnightJS to share the exact same
    // runtime objects instead of allowing Vite to materialize duplicate copies.
    dedupe: MIDNIGHT_SINGLETON_MODULES,
    alias: [
      { find: /^assert$/, replacement: 'assert/' },
      { find: /^isomorphic-ws$/, replacement: browserWebSocketShim },
    ],
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Do not publish source maps from the treasury client. This keeps private
    // implementation detail out of the production deployment while CI still
    // typechecks the original sources.
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer', 'assert'],
    // Prebundling one side of the Compact/Midnight boundary can manufacture a
    // second WASM wrapper instance. Keep all identity-sensitive runtime modules
    // on the same native ESM resolution path.
    exclude: MIDNIGHT_SINGLETON_MODULES,
    esbuildOptions: {
      target: 'esnext',
    },
  },
});
