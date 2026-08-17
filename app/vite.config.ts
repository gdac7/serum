import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The gateway has no CORS; proxying its routes through the dev server keeps the
// browser on one origin so no gateway change is needed for this app.
const gateway = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/auth": gateway,
      "/runs": gateway,
      "/me": gateway,
      "/health": gateway,
    },
  },
});
