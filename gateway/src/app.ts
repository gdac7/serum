import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./infra/logger";
import { healthRouter } from "./routes/health.routes";

export function createApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use(healthRouter);
  return app;
}
