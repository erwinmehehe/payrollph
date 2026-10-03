import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { retentionRules } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import {
  isRetentionRecordClass,
  missingRetentionClasses,
  REQUIRED_RETENTION_CLASSES,
  RETENTION_CLASS_LABELS,
  RETENTION_DISPOSAL_ACTIONS,
} from "@/lib/retention-schedule";

export const dynamic = "force-dynamic";

const PRIVACY_ROLES = ["owner", "admin", "hr"] as const;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PRIVACY_ROLES,
    "Only privacy administrators can review retention rules.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Retention policy requires company-wide privacy administrator access." }, { status: 403 });
  }

  const rules = await db.select().from(retentionRules)
    .where(eq(retentionRules.organizationId, organizationId))
    .orderBy(asc(retentionRules.recordClass));

  return Response.json({
    requiredClasses: REQUIRED_RETENTION_CLASSES.map((recordClass) => ({
      recordClass,
      label: RETENTION_CLASS_LABELS[recordClass],
    })),
    rules,
    missing: missingRetentionClasses(rules),
    ready: missingRetentionClasses(rules).length === 0,
    note: "PayrollPH requires an organization-approved legal basis and retention period. It does not invent statutory periods for the employer.",
  });
}

export async function PUT(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const recordClass = String(body.recordClass ?? "").trim();
  const retentionYears = Number(body.retentionYears);
  const disposalAction = String(body.disposalAction ?? "").trim();
  const legalBasis = String(body.legalBasis ?? "").trim();
  const legalHold = Boolean(body.legalHold);
  const notes = String(body.notes ?? "").trim().slice(0, 2000) || null;

  if (
    !Number.isInteger(organizationId)
    || !isRetentionRecordClass(recordClass)
    || !Number.isInteger(retentionYears)
    || retentionYears < 1
    || retentionYears > 100
    || !(RETENTION_DISPOSAL_ACTIONS as readonly string[]).includes(disposalAction)
    || legalBasis.length < 10
  ) {
    return Response.json({
      error: "A valid organizationId, required recordClass, retentionYears (1-100), disposalAction, and documented legalBasis are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PRIVACY_ROLES,
    "Only privacy administrators can approve retention rules.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Retention policy requires company-wide privacy administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;

  const [existing] = await db.select().from(retentionRules).where(and(
    eq(retentionRules.organizationId, organizationId),
    eq(retentionRules.recordClass, recordClass),
  )).limit(1);

  const values = {
    retentionYears,
    disposalAction,
    legalBasis,
    legalHold,
    approvedBy: session.name,
    approvedAt: new Date(),
    updatedAt: new Date(),
    notes,
  };

  const [row] = existing
    ? await db.update(retentionRules).set(values).where(eq(retentionRules.id, existing.id)).returning()
    : await db.insert(retentionRules).values({
        organizationId,
        recordClass,
        ...values,
      }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: existing ? "Retention rule re-approved" : "Retention rule approved",
    resource: RETENTION_CLASS_LABELS[recordClass],
    metadata: {
      recordClass,
      retentionYears,
      disposalAction,
      legalHold,
      legalBasis,
    },
  });

  return Response.json(row, { status: existing ? 200 : 201 });
}
