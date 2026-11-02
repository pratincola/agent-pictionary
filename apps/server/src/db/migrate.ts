import { configFromEnv } from "../config.js";
import { createDb, runMigrations } from "./index.js";

const cfg = configFromEnv();
const { sql, db } = createDb(cfg.databaseUrl, { max: 1 });
try {
  await runMigrations(db);
  console.log("migrations applied");
} finally {
  await sql.end();
}
