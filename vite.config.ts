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
        name: "AutomataLab — Nyelvek és automaták",
        short_name: "AutomataLab",
        description:
          "Interaktív műhely a Nyelvek és automaták tantárgyhoz: véges automaták, veremautomaták, Turing-gépek és nyelvtanok — teljesen offline.",
        theme_color: "#0f1117",
        background_color: "#0f1117",
        display: "standalone",
        start_url: ".",
        lang: "hu",
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
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"]
      }
    })
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
} as Parameters<typeof defineConfig>[0]);
