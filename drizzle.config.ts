import "dotenv/config";
import { assertIsolatedDbPushTarget } from "./scripts/lib/isolated-db-push-target.mjs";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Drizzle Kit");
}

// Drizzle Kit can be invoked directly without npm's db:push wrapper.
 // Guard that path too: only schema pushes to verified local PostgreSQL.
 // Other commands (such as 'generate') can still use the existing config.
if (process.argv.slice(1).some((arg) => arg === "push" || arg === "push:pg")) {
  assertIsolatedDbPushTarget(process.env.DATABASE_URL, process.env);
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts", "./src/lib/ess-profile-schema.ts", "./src/lib/saas-billing-schema.ts", "./src/lib/workforce-schedule-receipt-schema.ts"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
