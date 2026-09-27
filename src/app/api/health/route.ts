import { db } from "@/db";
import { sql } from "drizzle-orm";
import { recordHealthSnapshot, tickScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    const latencyMs = Date.now() - started;
    try {
      await recordHealthSnapshot(true, latencyMs, "ok");
      await tickScheduler(false);
    } catch {
      // Health must still succeed even if snapshot/scheduler tables are mid-migration.
    }
    return Response.json({ ok: true, latencyMs, scheduler: "opportunistic" });
  } catch {
    const latencyMs = Date.now() - started;
    try { await recordHealthSnapshot(false, latencyMs, "database unreachable"); } catch { /* ignore */ }
    return Response.json({ ok: false, latencyMs }, { status: 500 });
  }
}
