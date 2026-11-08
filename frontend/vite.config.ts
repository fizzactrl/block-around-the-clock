import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/api": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:5050", changeOrigin: true } },
  },
  preview: {
    proxy: { "/api": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:5050", changeOrigin: true } },
  },
});
