import "dotenv/config";
import { assertIsolatedDbPushTarget } from "./scripts/lib/isolated-db-push-target.mjs";
import { defineConfig } from "drizzle-kit";

/**
 * Experimental ONLY: tests new workplace tables against a verified disposable
 * local database. Normal drizzle.config.ts and its source-pinned security
 * evidence must remain unchanged.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
assertIsolatedDbPushTarget(process.env.DATABASE_URL, process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/db/schema.ts",
    "./src/db/workplace-compliance-schema.ts",
    "./src/lib/ess-profile-schema.ts",
    "./src/lib/saas-billing-schema.ts",
    "./src/lib/workforce-schedule-receipt-schema.ts",
  ],
  dbCredentials: { url: process.env.DATABASE_URL },
});
