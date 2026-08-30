import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Domus — Password Manager",
        short_name: "Domus",
        description: "Password manager familiare zero-knowledge, self-hosted.",
        lang: "it",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        // Il service worker mette in cache SOLO il guscio dell'applicazione.
        // Nessuna risposta di /api viene mai memorizzata: i dati del vault
        // stanno in IndexedDB, cifrati, e li gestisce l'app. Una cache HTTP
        // del service worker conserverebbe ciphertext fuori dal nostro
        // controllo e sopravviverebbe al logout.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // VAULT_API permette di puntare il frontend a un backend diverso da
      // quello di default: utile per provare su un'istanza di prova senza
      // toccare il vault reale.
      "/api": {
        target: process.env.VAULT_API ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
})
