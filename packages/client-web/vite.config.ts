import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // SPA-Fallback: alle Navigationen auf index.html. Nicht fuer
        // Supabase-API-Calls (die laufen ueber fetch() und liegen
        // ausserhalb der Navigations-Route).
        navigateFallback: '/index.html',
        // Auth- und API-Requests NIE cachen: Token-Refresh, Realtime-
        // Handshake und RLS-gescopte Reads muessen den echten Server
        // treffen. Supabase liegt am selben Host unter /auth, /rest,
        // /realtime — deshalb explizit denylisten.
        navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//, /^\/realtime\//, /^\/storage\//],
        runtimeCaching: [
          {
            // Supabase-API: immer Netz, nie Cache. Offline liefert der
            // SW einen synthetischen 503, die Mutations-Layer-Toasts
            // fangen das dann ab. Echtes Offline-Verhalten baut 0g.2c.
            urlPattern: /\/(auth|rest|realtime|storage)\//,
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
