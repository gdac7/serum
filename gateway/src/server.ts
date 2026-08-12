import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./infra/logger";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "gateway listening");
});

