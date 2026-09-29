import { authorizeInternalWorker } from "@/lib/internal-worker-auth";
import { tickScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeInternalWorker(request);
  if (!auth.ok) return auth.response;
  const result = await tickScheduler(true);
  return Response.json({
    scheduler: "opportunistic in-process",
    note: "Not a dedicated cron. Also invoked from /api/health when at least 30s have elapsed.",
    result,
  });
}
