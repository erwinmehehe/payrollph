/**
 * Independent, server-only rollout gate for the entire natural-language lane.
 * OPENAI_AUTOMATION_DRAFT_ENABLED separately controls use of an external model.
 * Absence or "false" in a deployed environment keeps BOTH model and keyless
 * fallback unavailable; the existing manual Automation Studio is unaffected.
 *
 * Synthetic CI uses a narrowly constrained, local disposable fixture. An
 * explicit "false" always wins, even for CI; this exception is not a rollout
 * mechanism and may never target remotely hosted applications/databases.
 */
export function automationLanguageStudioEnabled(): boolean {
  const setting = process.env.AUTOMATION_LANGUAGE_STUDIO_ENABLED;
  if (setting === "true") return true;
  if (setting !== undefined) return false;

  if (process.env.CI !== "true"
    || process.env.AUTOMATION_LANGUAGE_ACCEPTANCE_MODE !== "synthetic-postgres-only"
    || process.env.APP_BASE_URL !== "http://127.0.0.1:3000"
    || process.env.OPENAI_AUTOMATION_DRAFT_ENABLED !== "false"
    || Boolean(process.env.OPENAI_API_KEY)) return false;

  try {
    const db = new URL(process.env.DATABASE_URL ?? "");
    return (db.protocol === "postgresql:" || db.protocol === "postgres:")
      && (db.hostname === "localhost" || db.hostname === "127.0.0.1")
      && db.pathname === "/app_db";
  } catch {
    return false;
  }
}
