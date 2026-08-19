import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: [
    "api_key",
    "encrypted_api_key",
    "*.api_key",
    "*.encrypted_api_key",
    "req.headers.authorization",
    "req.query.access_token",
    "token",
    "*.token",
  ],
});
