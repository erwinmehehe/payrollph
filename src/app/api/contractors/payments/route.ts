import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { contractorPayments, contractors } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  getAccess,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function periodBounds(input: { month?: string | null; quarter?: string | null }) {
  if (input.month && /^\d{4}-\d{2}$/.test(input.month)) {
    const [year, month] = input.month.split("-").map(Number);
    if (month < 1 || month > 12) throw new Error("Invalid reporting month.");
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { start, end, label: input.month, kind: "month" as const };
  }

  const match = input.quarter?.match(/^(\d{4})-Q([1-4])$/);
  if (match) {
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const firstMonth = (quarter - 1) * 3 + 1;
    const lastMonth = firstMonth + 2;
    const start = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, lastMonth, 0)).toISOString().slice(0, 10);
    return { start, end, label: input.quarter!, kind: "quarter" as const };
  }

  throw new Error("Use month=YYYY-MM for 0619-E or quarter=YYYY-Q1..Q4 for 1601-EQ.");
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can review contractor withholding.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Contractor withholding reporting requires company-wide access." }, { status: 403 });
  }

  let period;
  try {
    period = periodBounds({
      month: url.searchParams.get("month"),
      quarter: url.searchParams.get("quarter"),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid reporting period." }, { status: 400 });
  }

  const form = String(url.searchParams.get("form") ?? (period.kind === "month" ? "0619-E" : "1601-EQ")).toUpperCase();
  if ((form === "0619-E" && period.kind !== "month") || (form === "1601-EQ" && period.kind !== "quarter")) {
    return Response.json({
      error: form === "0619-E"
        ? "BIR Form 0619-E source data must use a monthly period."
        : "BIR Form 1601-EQ source data must use a quarterly period.",
    }, { status: 400 });
  }
  if (!["0619-E", "1601-EQ"].includes(form)) {
    return Response.json({ error: "form must be 0619-E or 1601-EQ." }, { status: 400 });
  }

  const rows = await db.select({
    payment: contractorPayments,
    contractor: contractors,
  })
    .from(contractorPayments)
    .innerJoin(contractors, eq(contractorPayments.contractorId, contractors.id))
    .where(and(
      eq(contractorPayments.organizationId, organizationId),
      gte(contractorPayments.paymentDate, period.start),
      lte(contractorPayments.paymentDate, period.end),
    ))
    .orderBy(asc(contractorPayments.paymentDate), asc(contractorPayments.id));

  const aggregate = new Map<string, {
    atc: string;
    rate: number;
    grossAmountPhp: number;
    withholdingAmount: number;
    transactions: number;
  }>();
  for (const row of rows) {
    const atc = row.payment.withholdingAtc;
    const rate = Number(row.payment.withholdingRate);
    const key = `${atc}|${rate.toFixed(3)}`;
    const current = aggregate.get(key) ?? {
      atc,
      rate,
      grossAmountPhp: 0,
      withholdingAmount: 0,
      transactions: 0,
    };
    current.grossAmountPhp += Number(row.payment.grossAmountPhp);
    current.withholdingAmount += Number(row.payment.withholdingAmount);
    current.transactions += 1;
    aggregate.set(key, current);
  }

  const totals = [...aggregate.values()].map((row) => ({
    ...row,
    grossAmountPhp: round2(row.grossAmountPhp),
    withholdingAmount: round2(row.withholdingAmount),
  }));

  if (url.searchParams.get("format") !== "csv") {
    return Response.json({
      draft: true,
      filingReady: false,
      form,
      period,
      totals,
      payments: rows.map(({ payment, contractor }) => ({
        ...payment,
        contractorName: contractor.name,
        contractorTin: decryptGovernmentId(contractor.tin),
      })),
      note: "Source data only. Validate ATCs, rates, filing period and official BIR submission format before filing.",
    });
  }

  const lines = [
    ["ATC", "RatePercent", "GrossAmountPHP", "EWTAmountPHP", "Transactions"],
    ...totals.map((row) => [
      row.atc,
      row.rate.toFixed(3),
      row.grossAmountPhp.toFixed(2),
      row.withholdingAmount.toFixed(2),
      String(row.transactions),
    ]),
  ];

  return new Response(
    [
      `# DRAFT ${form} SOURCE EXTRACT - NOT A BIR IMPORTABLE/FILED RETURN`,
      `# period=${period.label}`,
      "# Validate against current BIR eFPS/eBIRForms requirements before filing.",
      ...lines.map((line) => line.map(csv).join(",")),
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contractor-ewt-${form.toLowerCase()}-${period.label}.csv"`,
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const contractorId = Number(body.contractorId);
  const grossAmountPhp = Number(body.grossAmountPhp);
  const paymentDate = String(body.paymentDate ?? "").trim();
  if (
    !Number.isInteger(organizationId)
    || !Number.isInteger(contractorId)
    || !Number.isFinite(grossAmountPhp)
    || grossAmountPhp <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
  ) {
    return Response.json({
      error: "organizationId, contractorId, positive grossAmountPhp and paymentDate (YYYY-MM-DD) are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can record contractor payments and EWT.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Contractor withholding requires company-wide access." }, { status: 403 });
  }

  const [contractor] = await db.select().from(contractors).where(and(
    eq(contractors.id, contractorId),
    eq(contractors.organizationId, organizationId),
  )).limit(1);
  if (!contractor) return Response.json({ error: "Contractor not found in this workspace." }, { status: 404 });

  const atc = contractor.withholdingAtc?.trim() ?? "";
  const rate = Number(contractor.withholdingRate ?? NaN);
  const tin = decryptGovernmentId(contractor.tin)?.replace(/\D/g, "") ?? "";
  if (!atc || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    return Response.json({
      error: "Configure the contractor's BIR ATC and EWT rate before recording a taxable payment.",
    }, { status: 422 });
  }
  if (tin.length !== 9) {
    return Response.json({ error: "A valid 9-digit contractor TIN is required for EWT reporting." }, { status: 422 });
  }

  const withholdingAmount = round2(grossAmountPhp * (rate / 100));
  const netAmountPhp = round2(grossAmountPhp - withholdingAmount);

  const [payment] = await db.insert(contractorPayments).values({
    organizationId,
    contractorId,
    paymentDate,
    grossAmountPhp: round2(grossAmountPhp).toFixed(2),
    withholdingAtc: atc,
    withholdingRate: rate.toFixed(3),
    withholdingAmount: withholdingAmount.toFixed(2),
    netAmountPhp: netAmountPhp.toFixed(2),
    reference: body.reference ? String(body.reference).trim().slice(0, 160) : null,
    createdBy: session.name,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Contractor payment EWT recorded",
    resource: `${contractor.name} · ${paymentDate}`,
    metadata: {
      contractorId,
      paymentId: payment.id,
      atc,
      rate,
      grossAmountPhp: round2(grossAmountPhp),
      withholdingAmount,
      netAmountPhp,
    },
  });

  return Response.json({ payment, contractor: { id: contractor.id, name: contractor.name } }, { status: 201 });
}
