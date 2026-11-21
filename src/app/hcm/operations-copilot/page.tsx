import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import OperationsCopilotPanel from "@/components/operations-copilot-panel";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole, assertOrganizationUnitAccess, getAccess,
  PAYROLL_OPERATOR_ROLES, PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { findPayrollRunForMember } from "@/lib/payroll-run-membership";
import { parseHcmWorkItemsEmployerId } from "@/lib/hcm-work-items-page-tenancy";
import { operationsCopilotEnabled } from "@/lib/operations-copilot";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Operations Copilot Pilot | Linaw",
  robots: { index: false, follow: false },
};

/** Independently gate the UI. The API rechecks every role, scope and employer. */
export default async function OperationsCopilotPage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    area?: string | string[];
    runId?: string | string[];
    legalEntityId?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const organizationId = parseHcmWorkItemsEmployerId(params.organizationId);
  if (!organizationId || (params.area !== "hr" && params.area !== "payroll")) notFound();
  if (!operationsCopilotEnabled(organizationId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  let runId: number | null = null;
  let legalEntityId: number | null = null;
  if (params.area === "hr") {
    if (params.runId !== undefined || params.legalEntityId !== undefined) notFound();
    const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (denied) notFound();
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) notFound();
  } else {
    runId = parseHcmWorkItemsEmployerId(params.runId);
    if (!runId) notFound();
    if (params.legalEntityId !== undefined) {
      legalEntityId = parseHcmWorkItemsEmployerId(params.legalEntityId);
      if (!legalEntityId) notFound();
    }
    const run = await findPayrollRunForMember(user.id, runId);
    if (!run || run.organizationId !== organizationId) notFound();
    const denied = await assertOrganizationRole(user.id, organizationId, PAYROLL_OPERATOR_ROLES);
    if (denied) notFound();
    const scoped = await assertOrganizationUnitAccess(user.id, organizationId, run.scopeOrgUnitId);
    if (scoped) notFound();
    if (legalEntityId !== null && run.legalEntityId !== legalEntityId) notFound();
  }

  return <main className="mx-auto max-w-6xl px-5 py-10 text-slate-900">
    <header>
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">
        Linaw · Authorized read-only pilot
      </p>
      <h1 className="mt-2 text-3xl font-bold">
        {params.area === "hr" ? "HR Operations Agent" : "Payroll Exception Copilot"}
      </h1>
      <p className="mt-2 max-w-3xl text-slate-700">
        Review what existing records say, understand the next human review step, and open the
        original workflow. The assistant cannot change employees, case status, payroll figures,
        approvals, bank files, or payments.
      </p>
    </header>
    <OperationsCopilotPanel key={organizationId + ":" + params.area + ":" + (runId ?? "")}
      organizationId={organizationId} area={params.area}
      runId={runId} legalEntityId={legalEntityId}/>
  </main>;
}
