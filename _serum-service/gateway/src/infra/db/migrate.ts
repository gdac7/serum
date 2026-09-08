import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./pool";

const here = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("schema applied");
  await pool.end();
}

migrate().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
