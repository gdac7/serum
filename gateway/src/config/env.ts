import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  PYTHON_SERVICE_URL: z.string().url().default("http://localhost:8080"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  GATEWAY_DATABASE_URL: z.string().min(1, "GATEWAY_DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_SECONDS: z.coerce.number().default(3600),
  // 32 bytes as 64 hex chars — the AES-256 key for target secrets at rest.
  SECRETS_ENC_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "SECRETS_ENC_KEY must be 64 hex chars (32 bytes)"),
  // Opens the endpoint allow-list to http and loopback/private hosts, for
  // targets served from the developer's own machine. Never set in production:
  // the guard is what stops a target config from becoming an SSRF vector.
  ALLOW_PRIVATE_ENDPOINTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
