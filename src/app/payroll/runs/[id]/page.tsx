import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { LinawWorkspace } from "@/components/linaw-workspace";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "employee") redirect("/");

  const [run] = await db
    .select({ id: payrollRuns.id, organizationId: payrollRuns.organizationId })
    .from(payrollRuns)
    .where(eq(payrollRuns.id, runId))
    .limit(1);
  if (!run) notFound();

  let data: Awaited<ReturnType<typeof getDashboardData>>;
  try {
    data = await getDashboardData(run.organizationId);
  } catch {
    notFound();
  }

  if (!data.payrollRuns.some((item) => item.id === runId)) notFound();

  return (
    <LinawWorkspace
      initialData={data}
      initialPage="Payroll"
      initialPayrollRunId={runId}
    />
  );
}
