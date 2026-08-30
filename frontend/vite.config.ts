import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Il backend gira in chiaro su 8000; in produzione ci si arriva via
      // HTTPS (scripts/serve-tls.sh). Il proxy tiene tutto su una sola
      // origine, quindi niente CORS e niente preflight in sviluppo.
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
