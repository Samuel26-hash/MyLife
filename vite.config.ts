import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Im Entwicklungsmodus werden API-Aufrufe an "wrangler dev" weitergeleitet.
    // Der Origin-Header wird angepasst, damit der CSRF-Schutz der API lokal funktioniert.
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", "http://localhost:8787");
          });
        },
      },
    },
  },
});
