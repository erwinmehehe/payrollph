import "dotenv/config";
import { assertIsolatedDbPushTarget } from "./lib/isolated-db-push-target.mjs";

try {
  const target = assertIsolatedDbPushTarget(process.env.DATABASE_URL, process.env);
  process.stdout.write("Local-only db:push approved for " +
    target.hostname + "/" + target.databaseName + ".\n");
} catch (error) {
  // Never log the URL or its password. No database connection was opened.
  console.error(error?.message || "DB_PUSH_TARGET_REJECTED");
  process.exitCode = 1;
}
