import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./infra/logger";
import { pool } from "./infra/db/pool";

async function main() {
  await pool.query("SELECT 1");
  logger.info("database connection ok");

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "gateway listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "failed to start gateway");
  process.exit(1);
});
