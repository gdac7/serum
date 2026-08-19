import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      GATEWAY_DATABASE_URL: "postgresql://test:test@localhost:5433/test",
      JWT_SECRET: "test-secret-at-least-16",
      SECRETS_ENC_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      // Pinned so the endpoint-guard tests don't depend on the developer's .env.
      ALLOW_PRIVATE_ENDPOINTS: "false",
    },
  },
});
