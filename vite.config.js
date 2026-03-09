import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // All /api/* requests from the browser are forwarded to the Express server.
      // This means the browser sees one origin (localhost:5173) for both UI and API
      // so cookies work without any CORS headers in development.
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
