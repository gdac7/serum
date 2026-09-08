import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./infra/logger";
import { healthRouter } from "./routes/health.routes";
import { authRouter } from "./routes/auth.routes";
import { runsRouter } from "./routes/runs.routes";
import { targetsRouter } from "./routes/targets.routes";
import { connectRouter } from "./routes/connect.routes";
import { connectorAssetsRouter } from "./routes/connector.routes";
import { bridgeRouter } from "./routes/bridge.routes";
import { errorHandler } from "./middleware/error.middleware";

export function createApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  // Before the shared parser: both carry whole model responses, which do not
  // fit the default body limit, and each router brings its own.
  app.use(connectRouter);
  app.use(bridgeRouter);
  app.use(express.json());
  app.use(connectorAssetsRouter);
  app.use(healthRouter);
  app.use(authRouter);
  app.use(runsRouter);
  app.use(targetsRouter);
  app.use(errorHandler);
  return app;
}
