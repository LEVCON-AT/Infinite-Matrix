import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

// Base-Pfad fuer den Vite-Build. VITE_BASE_PATH ueberschreibt das
// (z.B. '/app/' fuer staging.matrix.levcon.at/app/-Deploy). Default
// '/' fuer lokales dev + matrix.levcon.at-Root-Deploy spaeter.
const BASE = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
  plugins: [
    solid(),
    // PWA-Foundation (0g.2a). autoUpdate: neue Version wird still im
    // Hintergrund aufgenommen; der User bekommt den neuen Build bei
    // naechstem Reload. Fuer Workflow-kritische Updates spaeter auf
    // prompt umstellen + Reload-Toast zeigen.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-maskable.svg'],
      manifest: {
        name: 'Infinite Matrix',
        short_name: 'Matrix',
        description: 'Rekursive Matrix-Struktur zum strukturierten Denken.',
        lang: 'de',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          {
            // BASE-Praefix damit /app/-Deploy korrekt aufloest. Ohne den
            // Prefix sucht der Browser /icon.svg und nginx liefert 404
            // weil die Asset im /app/-Subordner liegt.
            src: `${BASE}icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: `${BASE}icon-maskable.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // skipWaiting+clientsClaim: neuer SW uebernimmt sofort beim
        // ersten Reload nach Deploy — ohne den User um zweites
        // Reload zu bitten. Wichtig fuer kritische Bug-Fixes wie
        // AI-Proxy-Routing.
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: `${BASE}index.html`,
        navigateFallbackDenylist: [
          /^\/auth\//,
          /^\/rest\//,
          /^\/realtime\//,
          /^\/storage\//,
          /^\/api\//,
        ],
        runtimeCaching: [
          {
            // Supabase-API + AI-Proxy: immer Netz, nie Cache. POSTs
            // sollen sowieso nie zwischengespeichert werden, aber
            // workbox routet sonst alles durch den SW — bei nicht
            // gematchten Patterns kommt ein synthetischer Fail. Mit
            // explizitem NetworkOnly ist der Pfad klar.
            urlPattern: /\/(auth|rest|realtime|storage|api)\//,
            handler: 'NetworkOnly',
          },
          {
            // Statische Assets (hashed JS/CSS aus Vite-Build) koennen
            // aggressiv gecached werden — Vite wirft bei jedem Build
            // neue Hashes. StaleWhileRevalidate ist hier ok.
            urlPattern: /\.(?:js|css|woff2?|svg|png|ico)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'assets-v1',
              expiration: {
                maxEntries: 128,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
      devOptions: {
        // Im Dev-Server nicht aktiv — sonst cached vite-plugin-pwa das
        // HMR-Inline-Skript und man jagt Phantome.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    host: 'localhost',
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
