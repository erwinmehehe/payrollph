import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, automationOperationalCases } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { FIRST_PAYROLL_OWNER, isFirstPayrollKey } from "@/lib/first-payroll-ownership";

export const dynamic = "force-dynamic";
const VIEW_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;
const SEND_ROLES = ["owner", "admin", "hr", "bookkeeper"] as const;
const SOURCE_TYPE = "first_payroll_v2";
const CASE_TYPE = "first_payroll_step";
const unavailable = () => Response.json({ error: "First-payroll journey is disabled." }, { status: 404 });

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("firstPayrollInline")) return unavailable();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return Response.json({ error: "Invalid employer." }, { status: 400 });
  const denied = await assertOrganizationRole(user.id, organizationId, VIEW_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  // Only tenant-wide roles read cross-functional work items; scoped operators
  // may view the underlying Payroll/Time panels separately as authorized.
  if (!access?.companyWide) return Response.json({ error: "Tenant-wide journey requires company-wide membership." }, { status: 403 });
  const rows = await db.select({
    id:automationOperationalCases.id,
    sourceId:automationOperationalCases.sourceId,
    status:automationOperationalCases.status,
    ownerTeam:automationOperationalCases.ownerTeam,
    createdAt:automationOperationalCases.createdAt,
    updatedAt:automationOperationalCases.updatedAt,
  }).from(automationOperationalCases).where(and(
    eq(automationOperationalCases.organizationId, organizationId),
    eq(automationOperationalCases.caseType,CASE_TYPE),
    eq(automationOperationalCases.sourceType,SOURCE_TYPE),
  )).orderBy(asc(automationOperationalCases.sourceId));
  return Response.json({
    assignments: rows.map(row => ({
      ...row,
      step: (Object.entries(FIRST_PAYROLL_OWNER).find(([,value])=>value.id===row.sourceId)?.[0] ?? null),
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("firstPayrollInline")) return unavailable();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !isFirstPayrollKey(body.step))
    return Response.json({ error: "Invalid employer or journey step." }, { status: 400 });
  const denied = await assertOrganizationRole(user.id,organizationId,SEND_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id,organizationId);
  if (!access?.companyWide) return Response.json({ error: "Cross-role handoff requires tenant-wide membership." }, { status: 403 });
  const { id: sourceId, role, team } = FIRST_PAYROLL_OWNER[body.step];
  // Idempotent handoff only. This neither completes a step nor grants a role.
  const created = await db.transaction(async tx => {
    const [record] = await tx.insert(automationOperationalCases).values({
      organizationId, caseType:CASE_TYPE, sourceType:SOURCE_TYPE,
      sourceId, ownerTeam:team,
      title:"First payroll — " + body.step,
      detail:"Assigned to the existing " + role + " role for authorized review. No role or approval granted.",
      evidence:{ step:body.step, requestedByUserId:user.id, assignedRole:role, previewIsNotApproval:true },
    }).onConflictDoNothing().returning({ id:automationOperationalCases.id });
    if (record) {
      await tx.insert(auditEvents).values({
        organizationId, actor:user.name, action:"First payroll step handed off",
        resource:"First payroll " + body.step,
        metadata:{ caseId:record.id, assignedRole:role, actorUserId:user.id },
      });
    }
    return record;
  });
  const [found] = await db.select({
    id:automationOperationalCases.id,
  }).from(automationOperationalCases).where(and(
    eq(automationOperationalCases.organizationId,organizationId),
    eq(automationOperationalCases.caseType,CASE_TYPE),
    eq(automationOperationalCases.sourceType,SOURCE_TYPE),
    eq(automationOperationalCases.sourceId,sourceId),
  )).limit(1);
  if (!found) return Response.json({ error:"Handoff was not saved; retry." }, { status: 409 });
  return Response.json({
    caseId:found.id, step:body.step, role, team, existing:!created,
    completed:false, message:"Assigned for review; approval remains independent.",
  }, { status:created?201:200 });
}
