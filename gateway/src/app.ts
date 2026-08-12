import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./infra/logger";
import { healthRouter } from "./routes/health.routes";
import { authRouter } from "./routes/auth.routes";
import { errorHandler } from "./middleware/error.middleware";

export function createApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use(healthRouter);
  app.use(authRouter);
  app.use(errorHandler);
  return app;
}
