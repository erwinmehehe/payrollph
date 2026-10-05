import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { statutoryRemittanceObligations } from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  remittanceAmountMatches,
  remittanceIsOverdue,
} from "@/lib/statutory-remittance";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const DENIED = "Only company-wide People/payroll users can manage statutory remittance evidence.";

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
}

function validDateTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

async function authorize(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    DENIED,
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: DENIED }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await authorize(user.id, organizationId);
  if (denied) return denied;

  const rows = await db.select().from(statutoryRemittanceObligations)
    .where(eq(statutoryRemittanceObligations.organizationId, organizationId))
    .orderBy(
      desc(statutoryRemittanceObligations.applicableMonth),
      desc(statutoryRemittanceObligations.id),
    )
    .limit(120);

  const today = todayPh();
  return Response.json({
    today,
    obligations: rows.map((row) => ({
      ...row,
      overdue: remittanceIsOverdue({
        dueDate: row.dueDate ? String(row.dueDate) : null,
        status: row.status,
        today,
      }) || (!row.dueDate && row.status !== "confirmed" && row.applicableMonth < today.slice(0, 7)),
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const id = Number(body.id);
  const action = String(body.action ?? "").trim();

  if (!Number.isInteger(organizationId) || !Number.isInteger(id)) {
    return Response.json({ error: "organizationId and id are required." }, { status: 400 });
  }

  const denied = await authorize(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `statutory-remittance-${action || "mutation"}`,
    resourceId: id,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [row] = await db.select().from(statutoryRemittanceObligations).where(and(
    eq(statutoryRemittanceObligations.id, id),
    eq(statutoryRemittanceObligations.organizationId, organizationId),
  )).limit(1);
  if (!row) return Response.json({ error: "Remittance obligation not found." }, { status: 404 });

  if (action === "record_payment") {
    if (row.status === "confirmed") {
      return Response.json({ error: "Confirmed remittance evidence is immutable." }, { status: 409 });
    }

    const paidAmount = Number(body.paidAmount);
    const paymentReference = String(body.paymentReference ?? "").trim().slice(0, 120);
    const remittedAt = validDateTime(body.remittedAt);
    const evidenceNote = String(body.evidenceNote ?? "").trim().slice(0, 2000) || null;

    if (!Number.isFinite(paidAmount) || paidAmount <= 0 || paymentReference.length < 4 || !remittedAt) {
      return Response.json({
        error: "paidAmount, paymentReference (at least 4 characters), and remittedAt are required.",
      }, { status: 400 });
    }
    if (remittedAt.getTime() > Date.now() + 24 * 60 * 60_000) {
      return Response.json({ error: "remittedAt cannot be in the future." }, { status: 422 });
    }
    if (!remittanceAmountMatches(Number(row.expectedTotalAmount), paidAmount)) {
      return Response.json({
        error: `Recorded remittance amount must match the payroll liability exactly. Expected PHP ${Number(row.expectedTotalAmount).toFixed(2)}.`,
        code: "REMITTANCE_AMOUNT_MISMATCH",
      }, { status: 409 });
    }

    const [updated] = await db.update(statutoryRemittanceObligations).set({
      status: "payment_recorded",
      paymentReference,
      paidAmount: paidAmount.toFixed(2),
      remittedAt,
      evidenceNote,
      recordedBy: user.name,
      recordedByUserId: user.id,
      postingReference: null,
      postingConfirmedAt: null,
      confirmedBy: null,
      confirmedByUserId: null,
      confirmedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryRemittanceObligations.id, id),
      eq(statutoryRemittanceObligations.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance payment recorded",
      resource: `${row.agency} · ${row.applicableMonth}`,
      metadata: {
        remittanceObligationId: id,
        agency: row.agency,
        applicableMonth: row.applicableMonth,
        expectedTotalAmount: row.expectedTotalAmount,
        paidAmount: paidAmount.toFixed(2),
        paymentReference,
        remittedAt: remittedAt.toISOString(),
      },
    });

    return Response.json({ obligation: updated });
  }

  if (action === "confirm_posting") {
    if (row.status !== "payment_recorded") {
      return Response.json({
        error: "Record the exact payment amount and payment reference before confirming agency posting.",
      }, { status: 409 });
    }
    if (row.recordedByUserId != null && row.recordedByUserId === user.id) {
      return Response.json({
        error: "The person who recorded the payment cannot also confirm agency posting. Use an independent reviewer.",
      }, { status: 409 });
    }
    if (!remittanceAmountMatches(Number(row.expectedTotalAmount), Number(row.paidAmount ?? 0))) {
      return Response.json({
        error: "The recorded payment no longer matches the expected payroll liability. Review the obligation before confirming.",
      }, { status: 409 });
    }

    const postingReference = String(body.postingReference ?? "").trim().slice(0, 120);
    const postingConfirmedAt = validDateTime(body.postingConfirmedAt);
    const evidenceNote = String(body.evidenceNote ?? row.evidenceNote ?? "").trim().slice(0, 2000) || null;
    if (postingReference.length < 4 || !postingConfirmedAt) {
      return Response.json({
        error: "postingReference and postingConfirmedAt are required.",
      }, { status: 400 });
    }
    if (postingConfirmedAt.getTime() > Date.now() + 24 * 60 * 60_000) {
      return Response.json({ error: "postingConfirmedAt cannot be in the future." }, { status: 422 });
    }

    const [updated] = await db.update(statutoryRemittanceObligations).set({
      status: "confirmed",
      postingReference,
      postingConfirmedAt,
      evidenceNote,
      confirmedBy: user.name,
      confirmedByUserId: user.id,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryRemittanceObligations.id, id),
      eq(statutoryRemittanceObligations.organizationId, organizationId),
      eq(statutoryRemittanceObligations.status, "payment_recorded"),
    )).returning();
    if (!updated) {
      return Response.json({ error: "Remittance state changed while it was being confirmed." }, { status: 409 });
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance agency posting confirmed",
      resource: `${row.agency} · ${row.applicableMonth}`,
      metadata: {
        remittanceObligationId: id,
        agency: row.agency,
        applicableMonth: row.applicableMonth,
        expectedTotalAmount: row.expectedTotalAmount,
        paymentReference: row.paymentReference,
        postingReference,
        postingConfirmedAt: postingConfirmedAt.toISOString(),
        recordedByUserId: row.recordedByUserId,
        confirmedByUserId: user.id,
      },
    });

    return Response.json({ obligation: updated });
  }

  if (action === "flag_dispute") {
    if (row.status === "confirmed") {
      return Response.json({ error: "Confirmed remittance evidence is immutable. Open a separate correction record." }, { status: 409 });
    }
    const evidenceNote = String(body.evidenceNote ?? "").trim().slice(0, 2000);
    if (!evidenceNote) {
      return Response.json({ error: "Describe the remittance discrepancy." }, { status: 400 });
    }
    const [updated] = await db.update(statutoryRemittanceObligations).set({
      status: "disputed",
      evidenceNote,
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryRemittanceObligations.id, id),
      eq(statutoryRemittanceObligations.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance discrepancy flagged",
      resource: `${row.agency} · ${row.applicableMonth}`,
      metadata: { remittanceObligationId: id, evidenceNote },
    });
    return Response.json({ obligation: updated });
  }

  return Response.json({
    error: "Unsupported action. Use record_payment, confirm_posting, or flag_dispute.",
  }, { status: 400 });
}
