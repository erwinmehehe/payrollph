import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  governmentFilingValidations,
  organizations,
  payrollRuns,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { findFilingForm, provesOperationalFiling } from "@/lib/filing-evidence";
import { buildComplianceCalendar } from "@/lib/compliance-calendar";

export const dynamic = "force-dynamic";

const COMPLIANCE_CALENDAR_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;

function manilaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    COMPLIANCE_CALENDAR_ROLES,
    "Your role cannot view the company compliance calendar.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "The statutory compliance calendar is company-wide and is not available to unit-scoped roles.",
    }, { status: 403 });
  }

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return Response.json({ error: "Organization not found." }, { status: 404 });

  const runs = await db.select({
    periodEnd: payrollRuns.periodEnd,
    payDate: payrollRuns.payDate,
  }).from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId))
    .orderBy(desc(payrollRuns.periodEnd), desc(payrollRuns.id))
    .limit(24);

  const applicableMonths = [...new Set(
    runs.map((run) => String(run.periodEnd).slice(0, 7)),
  )].slice(0, 4);
  const birApplicableMonths = [...new Set(
    runs.map((run) => String(run.payDate).slice(0, 7)),
  )].slice(0, 4);

  if (applicableMonths.length === 0) {
    return Response.json({
      today: manilaDate(),
      applicableMonths: [],
      items: [],
      note: "The compliance calendar starts when payroll periods exist.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const batches = await db.select().from(statutoryRemittanceBatches)
    .where(and(
      eq(statutoryRemittanceBatches.organizationId, organizationId),
      inArray(statutoryRemittanceBatches.applicableMonth, applicableMonths),
    ))
    .orderBy(asc(statutoryRemittanceBatches.applicableMonth), asc(statutoryRemittanceBatches.agency));

  const organizationBatches = batches;
  const batchIds = organizationBatches.map((batch) => batch.id);
  const members = batchIds.length
    ? await db.select({
        batchId: statutoryRemittanceMembers.batchId,
        postingStatus: statutoryRemittanceMembers.postingStatus,
      }).from(statutoryRemittanceMembers)
        .where(inArray(statutoryRemittanceMembers.batchId, batchIds))
    : [];

  const bir1601Definition = findFilingForm("BIR", "1601-C");
  const bir1601Evidence = bir1601Definition
    ? await db.select({
        agency: governmentFilingValidations.agency,
        form: governmentFilingValidations.form,
        status: governmentFilingValidations.status,
        submissionMethod: governmentFilingValidations.submissionMethod,
        generatorVersion: governmentFilingValidations.generatorVersion,
        agencyReference: governmentFilingValidations.agencyReference,
        submittedAt: governmentFilingValidations.submittedAt,
        payDate: payrollRuns.payDate,
      })
        .from(governmentFilingValidations)
        .innerJoin(payrollRuns, eq(governmentFilingValidations.payrollRunId, payrollRuns.id))
        .where(and(
          eq(governmentFilingValidations.organizationId, organizationId),
          eq(governmentFilingValidations.agency, "BIR"),
          eq(governmentFilingValidations.form, "1601-C"),
        ))
    : [];
  const bir1601cOperationalMonths = bir1601Definition
    ? [...new Set(
        bir1601Evidence
          .filter((row) => provesOperationalFiling(row, bir1601Definition))
          .map((row) => String(row.payDate).slice(0, 7)),
      )]
    : [];

  const today = manilaDate();
  const currentMonth = today.slice(0, 7);
  const items = buildComplianceCalendar({
    today,
    currentMonth,
    applicableMonths,
    birApplicableMonths,
    legalName: organization.legalName,
    philHealthEmployerNo: organization.philHealthEmployerNo,
    bir1601cOperationalMonths,
    includeAnnualObligations: true,
    batches: organizationBatches.map((batch) => ({
      agency: batch.agency,
      applicableMonth: batch.applicableMonth,
      dueDate: String(batch.dueDate),
      status: batch.status,
      pendingPostingCount: members.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "pending",
      ).length,
      exceptionCount: members.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "exception",
      ).length,
    })),
  });

  return Response.json({
    today,
    applicableMonths: [...new Set([...applicableMonths, ...birApplicableMonths])],
    items,
    note: "Dates are nominal statutory dates or conservative internal targets. Published agency calendars, filer classification, weekends and holidays can change the final filing/payment date.",
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
