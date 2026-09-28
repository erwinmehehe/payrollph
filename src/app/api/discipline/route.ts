import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { disciplinaryCases, employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const filter = employeeId > 0
    ? and(eq(disciplinaryCases.organizationId, organizationId), eq(disciplinaryCases.employeeId, employeeId))
    : eq(disciplinaryCases.organizationId, organizationId);

  const cases = await db.select({
    discCase: disciplinaryCases,
    employee: employees,
  })
    .from(disciplinaryCases)
    .innerJoin(employees, eq(disciplinaryCases.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(disciplinaryCases.id));

  return Response.json({
    cases: cases.map(({ discCase, employee }) => ({
      ...discCase,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      employeeTitle: employee.title,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId ?? 1);
  const employeeId = Number(body.employeeId);
  const offense = String(body.offense ?? "").trim();
  const incidentDate = String(body.incidentDate ?? new Date().toISOString().slice(0, 10));
  const nteDetails = String(body.nteDetails ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  if (!employeeId || !offense || !nteDetails) {
    return Response.json({ error: "Employee, offense category, and Notice to Explain (NTE) details are required." }, { status: 400 });
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const caseNumber = `DISC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const [created] = await db.insert(disciplinaryCases).values({
    organizationId,
    employeeId,
    caseNumber,
    offense,
    incidentDate,
    status: "nte_issued",
    nteIssuedAt: new Date(),
    nteDetails,
    penalty: "Under Review (NTE Issued)",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Notice to Explain (NTE) issued",
    resource: `${employee.firstName} ${employee.lastName} · ${caseNumber}`,
    metadata: { caseNumber, offense, incidentDate },
  });

  return Response.json(created, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "submit_explanation"); // "submit_explanation" | "schedule_hearing" | "issue_nod" | "close"

  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [discCase] = await db.select().from(disciplinaryCases).where(eq(disciplinaryCases.id, id)).limit(1);
  if (!discCase) return Response.json({ error: "Disciplinary case not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    discCase.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to manage disciplinary cases.",
  );
  if (denied) return denied;

  if (action === "submit_explanation") {
    const explanation = String(body.employeeExplanation ?? "").trim();
    if (!explanation) return Response.json({ error: "Written explanation text is required." }, { status: 400 });

    const [updated] = await db.update(disciplinaryCases).set({
      employeeExplanation: explanation,
      explanationSubmittedAt: new Date(),
      status: "explanation_submitted",
    }).where(eq(disciplinaryCases.id, id)).returning();

    await recordAuditEvent({
      organizationId: discCase.organizationId,
      actor: user.name,
      action: "Employee explanation submitted",
      resource: discCase.caseNumber,
      metadata: { caseId: id },
    });

    return Response.json(updated);
  }

  if (action === "schedule_hearing") {
    const hearingDateStr = String(body.hearingDate ?? "").trim();
    if (!hearingDateStr) return Response.json({ error: "Hearing date is required." }, { status: 400 });

    const [updated] = await db.update(disciplinaryCases).set({
      hearingDate: new Date(hearingDateStr),
      status: "hearing_scheduled",
    }).where(eq(disciplinaryCases.id, id)).returning();

    await recordAuditEvent({
      organizationId: discCase.organizationId,
      actor: user.name,
      action: "Administrative hearing scheduled",
      resource: discCase.caseNumber,
      metadata: { hearingDate: hearingDateStr },
    });

    return Response.json(updated);
  }

  if (action === "issue_nod") {
    const nodDecision = String(body.nodDecision ?? "").trim();
    const penalty = String(body.penalty ?? "Written Warning").trim(); // "Written Warning", "Suspension", "Termination", "Exonerated"

    if (!nodDecision) return Response.json({ error: "Notice of Decision (NOD) findings and rationale are required." }, { status: 400 });

    const [updated] = await db.update(disciplinaryCases).set({
      nodDecision,
      penalty,
      nodIssuedAt: new Date(),
      status: "nod_issued",
    }).where(eq(disciplinaryCases.id, id)).returning();

    await recordAuditEvent({
      organizationId: discCase.organizationId,
      actor: user.name,
      action: "Notice of Decision (NOD) issued",
      resource: `${discCase.caseNumber} · ${penalty}`,
      metadata: { penalty, decision: nodDecision },
    });

    return Response.json(updated);
  }

  if (action === "close") {
    const [updated] = await db.update(disciplinaryCases).set({
      status: "closed",
    }).where(eq(disciplinaryCases.id, id)).returning();

    return Response.json(updated);
  }

  return Response.json({ error: "Unknown disciplinary action." }, { status: 400 });
}
