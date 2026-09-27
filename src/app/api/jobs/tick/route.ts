import { getSessionUser } from "@/lib/auth";
import { tickScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const workerToken = request.headers.get("x-worker-token");
  const expected = process.env.WORKER_TOKEN;
  if (!user && !(expected && workerToken === expected)) {
    return Response.json({ error: "Authentication or a valid worker token is required." }, { status: 401 });
  }
  const result = await tickScheduler(true);
  return Response.json({
    scheduler: "opportunistic in-process",
    note: "Not a dedicated cron. Also invoked from /api/health when at least 30s have elapsed.",
    result,
  });
}
