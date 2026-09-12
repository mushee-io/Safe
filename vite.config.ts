import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // Midnight's browser runtime loads its on-chain WASM through ESM. Modern
  // browsers support native top-level await, so keep the emitted module native
  // instead of rewriting it through vite-plugin-top-level-await (which crashes
  // during Rollup/SWC code generation under this Vite toolchain).
  plugins: [wasm()],
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
});
