import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "AutomataLab — Languages and Automata",
        short_name: "AutomataLab",
        description:
          "An interactive workshop for formal languages and automata theory: finite automata, pushdown automata, Turing machines and grammars — fully offline. Available in English, German and Hungarian.",
        theme_color: "#0f1117",
        background_color: "#0f1117",
        display: "standalone",
        start_url: ".",
        lang: "en",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // the server's own pages (the API reference, the MCP endpoint) are not the app
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/]
      }
    })
  ],
  server: {
    // `npm run dev:server` serves the API on this port
    proxy: { "/api": "http://localhost:8787", "/mcp": "http://localhost:8787" }
  }
});
