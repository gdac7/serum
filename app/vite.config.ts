import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The gateway has no CORS; proxying its routes through the dev server keeps the
// browser on one origin so no gateway change is needed for this app.
const DEFAULT_GATEWAY = "https://robin-pranker-fritter.ngrok-free.dev";

export default defineConfig(({ mode }) => {
  const gateway = loadEnv(mode, ".", "").GATEWAY_URL || DEFAULT_GATEWAY;

  const proxy = {
    target: gateway,
    changeOrigin: true,
    // ngrok's free tier serves an interstitial to anything that looks like a
    // browser navigation; without it the JSON routes come back as HTML.
    headers: { "ngrok-skip-browser-warning": "1" },
  };

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/auth": proxy,
        "/runs": proxy,
        "/targets": proxy,
        "/me": proxy,
        "/health": proxy,
      },
    },
  };
});
