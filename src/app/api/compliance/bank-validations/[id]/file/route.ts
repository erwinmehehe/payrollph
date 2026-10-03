import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import {
  getBankFileValidation,
  regenerateRecordedBankFile,
} from "@/lib/bank-evidence-store";
import { getSessionUser } from "@/lib/auth";
import { requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const id = Number((await params).id);
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid record id and organizationId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can download bank validation files.",
  );
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const record = await getBankFileValidation(organizationId, id);
  if (!record) return Response.json({ error: "Bank validation record not found." }, { status: 404 });
  if (!record.payrollRunId) {
    return Response.json({ error: "The source payroll run is no longer available." }, { status: 409 });
  }

  const [run] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, record.payrollRunId),
    eq(payrollRuns.organizationId, organizationId),
  )).limit(1);
  if (!run) return Response.json({ error: "The source payroll run is no longer available." }, { status: 409 });

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    organizationId,
    run.scopeOrgUnitId,
    "This bank validation file is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  try {
    const file = await regenerateRecordedBankFile(record);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename=${record.fileName}`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "X-Linaw-File-SHA256": record.fileSha256,
      },
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The recorded bank file could not be regenerated.",
    }, { status: 409 });
  }
}
