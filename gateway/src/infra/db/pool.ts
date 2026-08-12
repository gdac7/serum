import { Pool } from "pg";
import { env } from "../../config/env";

export const pool = new Pool({ connectionString: env.GATEWAY_DATABASE_URL });
