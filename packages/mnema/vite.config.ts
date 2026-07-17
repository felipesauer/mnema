import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dashboard SPA build (MNEMA-ADR-8 / ADR-66). Emits a self-contained static
 * bundle into dist/dashboard that the loopback `mnema serve` process serves.
 *
 * Offline-first is a hard constraint (ADR-8/ADR-65): no CDN, no runtime
 * external request. `base: './'` keeps every asset reference relative so the
 * bundle works under any mount path with zero absolute-host URLs; assets
 * (including fonts) are inlined/emitted locally, never fetched from a CDN.
 * The `verify-spa-bundle` CI check asserts the built output references no
 * external host and stays under the 250KB gzipped budget.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/dashboard', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/dashboard', import.meta.url)),
    emptyOutDir: true,
    // Inline every asset so the bundle is a closed set of files with no
    // separate small-asset fetches; keeps the offline-first posture simple.
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      // Fail the build if anything resolves to an external (http) URL — the
      // offline-first guarantee must hold at build time, not just by review.
      external: (id) => {
        if (/^https?:\/\//.test(id)) {
          throw new Error(`SPA bundle must not reference an external URL: ${id}`);
        }
        return false;
      },
    },
  },
});
