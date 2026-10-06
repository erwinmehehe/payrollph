import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, hcmEmploymentTerms } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  activateEmploymentTerm,
  EMPLOYMENT_TERM_KINDS,
  employmentTermLifecycle,
  philippineBusinessDate,
} from "@/lib/hcm-employment-terms";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function assertEmploymentTermsAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage employment terms.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({
      error: "Employment terms governance requires company-wide People access.",
    }, { status: 403 }) };
  }
  return { access };
}

function optionalDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return ISO_DATE.test(text) ? text : undefined;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = url.searchParams.get("employeeId") ? Number(url.searchParams.get("employeeId")) : null;
  if (!Number.isInteger(organizationId) || (employeeId !== null && !Number.isInteger(employeeId))) {
    return Response.json({ error: "A valid organizationId and optional employeeId are required." }, { status: 400 });
  }

  const gate = await assertEmploymentTermsAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rows = await db.select().from(hcmEmploymentTerms).where(
    employeeId === null
      ? eq(hcmEmploymentTerms.organizationId, organizationId)
      : and(
          eq(hcmEmploymentTerms.organizationId, organizationId),
          eq(hcmEmploymentTerms.employeeId, employeeId),
        ),
  ).orderBy(desc(hcmEmploymentTerms.effectiveFrom), desc(hcmEmploymentTerms.id));

  const today = philippineBusinessDate();
  return Response.json({
    today,
    terms: rows.map((row) => ({
      ...row,
      lifecycle: row.status === "active"
        ? employmentTermLifecycle({
            termKind: row.termKind,
            probationReviewDate: row.probationReviewDate ? String(row.probationReviewDate) : null,
            contractEndDate: row.contractEndDate ? String(row.contractEndDate) : null,
            effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
          }, today)
        : null,
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "Valid organizationId and employeeId are required." }, { status: 400 });
  }

  const gate = await assertEmploymentTermsAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-employment-terms-create",
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const employmentType = String(body.employmentType ?? "").trim().slice(0, 32);
  const termKind = String(body.termKind ?? "").trim().toLowerCase();
  const effectiveFrom = String(body.effectiveFrom ?? "").trim();
  const effectiveUntil = optionalDate(body.effectiveUntil);
  const probationReviewDate = optionalDate(body.probationReviewDate);
  const contractEndDate = optionalDate(body.contractEndDate);
  const projectName = String(body.projectName ?? "").trim().slice(0, 160) || null;
  const reason = String(body.reason ?? "").trim().slice(0, 240);

  if (!employmentType || !EMPLOYMENT_TERM_KINDS.includes(termKind as (typeof EMPLOYMENT_TERM_KINDS)[number])
      || !ISO_DATE.test(effectiveFrom) || effectiveUntil === undefined
      || probationReviewDate === undefined || contractEndDate === undefined || reason.length < 3) {
    return Response.json({ error: "Employment type, valid term kind, effective date, and reason are required." }, { status: 400 });
  }
  if (effectiveUntil && effectiveUntil < effectiveFrom) {
    return Response.json({ error: "effectiveUntil cannot be before effectiveFrom." }, { status: 400 });
  }
  if (probationReviewDate && probationReviewDate < effectiveFrom) {
    return Response.json({ error: "Probation review date cannot be before the terms effective date." }, { status: 400 });
  }
  if (contractEndDate && contractEndDate < effectiveFrom) {
    return Response.json({ error: "Contract end date cannot be before the terms effective date." }, { status: 400 });
  }
  if (termKind === "probationary" && !probationReviewDate) {
    return Response.json({ error: "Probationary terms require an explicit review date." }, { status: 400 });
  }
  if (termKind === "fixed_term" && !contractEndDate) {
    return Response.json({ error: "Fixed-term employment requires an explicit contract end date." }, { status: 400 });
  }
  if (termKind === "fixed_term" && effectiveUntil && effectiveUntil !== contractEndDate) {
    return Response.json({ error: "For fixed-term employment, effectiveUntil must match contractEndDate when both are supplied." }, { status: 400 });
  }

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  if (["Separating", "Separated"].includes(employee.status)) {
    return Response.json({ error: "Employment terms cannot be changed while the worker is in separation." }, { status: 409 });
  }
  if (effectiveFrom < String(employee.startDate)) {
    return Response.json({ error: "Employment terms cannot start before the employee hire date." }, { status: 409 });
  }

  try {
    const [created] = await db.insert(hcmEmploymentTerms).values({
      organizationId,
      employeeId,
      employmentType,
      termKind,
      effectiveFrom,
      effectiveUntil: effectiveUntil ?? (termKind === "fixed_term" ? contractEndDate : null),
      probationReviewDate,
      contractEndDate,
      projectName,
      status: "pending_approval",
      reason,
      requestedByUserId: user.id,
      requestedBy: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM employment terms requested",
      resource: `Employee #${employeeId}`,
      metadata: {
        employmentTermId: created.id,
        employmentType,
        termKind,
        effectiveFrom,
        effectiveUntil: created.effectiveUntil,
        probationReviewDate,
        contractEndDate,
        projectName,
      },
    });
    return Response.json({ term: created }, { status: 201 });
  } catch {
    return Response.json({
      error: "This worker already has an employment-terms change awaiting approval or activation.",
    }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim().toLowerCase();
  if (!Number.isInteger(id) || !Number.isInteger(organizationId) || !["approve", "cancel", "retry"].includes(action)) {
    return Response.json({ error: "Valid id, organizationId and approve/cancel/retry action are required." }, { status: 400 });
  }

  const gate = await assertEmploymentTermsAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `hcm-employment-terms-${action}`,
    resourceId: id,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [term] = await db.select().from(hcmEmploymentTerms).where(and(
    eq(hcmEmploymentTerms.id, id),
    eq(hcmEmploymentTerms.organizationId, organizationId),
  )).limit(1);
  if (!term) return Response.json({ error: "Employment terms record not found." }, { status: 404 });

  if (action === "cancel") {
    if (!["pending_approval", "scheduled", "failed"].includes(term.status)) {
      return Response.json({ error: "Only pending, scheduled, or failed terms can be cancelled." }, { status: 409 });
    }
    const [cancelled] = await db.update(hcmEmploymentTerms).set({
      status: "cancelled",
      cancelledByUserId: user.id,
      cancelledBy: user.name,
      cancelledAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(hcmEmploymentTerms.id, id),
      eq(hcmEmploymentTerms.organizationId, organizationId),
    )).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM employment terms cancelled",
      resource: `Employee #${term.employeeId}`,
      metadata: { employmentTermId: id, previousStatus: term.status },
    });
    return Response.json({ term: cancelled });
  }

  if (action === "retry") {
    if (term.status !== "failed" || !term.approvedByUserId) {
      return Response.json({ error: "Only previously approved failed terms can be retried." }, { status: 409 });
    }
    const [scheduled] = await db.update(hcmEmploymentTerms).set({
      status: "scheduled",
      failure: null,
      updatedAt: new Date(),
    }).where(and(eq(hcmEmploymentTerms.id, id), eq(hcmEmploymentTerms.status, "failed"))).returning();
    if (!scheduled) return Response.json({ error: "Employment terms changed before retry." }, { status: 409 });
    if (String(scheduled.effectiveFrom) <= philippineBusinessDate()) {
      try {
        const activated = await activateEmploymentTerm({ termId: id, actor: user.name, actorUserId: user.id });
        return Response.json({ term: activated.term, activated: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Employment terms activation failed.";
        await db.update(hcmEmploymentTerms).set({ status: "failed", failure: message, updatedAt: new Date() })
          .where(eq(hcmEmploymentTerms.id, id));
        return Response.json({ error: message }, { status: 409 });
      }
    }
    return Response.json({ term: scheduled, activated: false });
  }

  if (term.status !== "pending_approval") {
    return Response.json({ error: "Only pending employment terms can be approved." }, { status: 409 });
  }
  if (term.requestedByUserId === user.id) {
    return Response.json({ error: "Four-eyes control: the requester cannot approve their own employment terms." }, { status: 403 });
  }

  const now = new Date();
  const [scheduled] = await db.update(hcmEmploymentTerms).set({
    status: "scheduled",
    approvedByUserId: user.id,
    approvedBy: user.name,
    approvedAt: now,
    updatedAt: now,
  }).where(and(
    eq(hcmEmploymentTerms.id, id),
    eq(hcmEmploymentTerms.status, "pending_approval"),
  )).returning();
  if (!scheduled) return Response.json({ error: "Employment terms changed before approval." }, { status: 409 });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "HCM employment terms approved",
    resource: `Employee #${term.employeeId}`,
    metadata: { employmentTermId: id, effectiveFrom: scheduled.effectiveFrom },
  });

  if (String(scheduled.effectiveFrom) <= philippineBusinessDate(now)) {
    try {
      const activated = await activateEmploymentTerm({ termId: id, actor: user.name, actorUserId: user.id, now });
      return Response.json({ term: activated.term, activated: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Employment terms activation failed.";
      await db.update(hcmEmploymentTerms).set({ status: "failed", failure: message, updatedAt: new Date() })
        .where(eq(hcmEmploymentTerms.id, id));
      return Response.json({ error: message }, { status: 409 });
    }
  }

  return Response.json({ term: scheduled, activated: false });
}
