import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { doleComplianceSubmissions, doleReportingProfiles } from "@/db/schema";
import { ORG_ADMIN_ROLES, PAYROLL_OPERATOR_ROLES, assertOrganizationRole, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { ensureDoleReportingSchema } from "@/lib/dole-reporting-schema";
import { buildDoleThirteenthMonthState } from "@/lib/dole-thirteenth-month-report-server";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function requireCompanyWide(
  userId: number,
  organizationId: number,
  roles: readonly string[],
  message: string,
) {
  const denied = await assertOrganizationRole(userId, organizationId, roles, message);
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "DOLE annual reporting requires company-wide workspace access.",
    }, { status: 403 });
  }
  return null;
}

function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  await ensureDoleReportingSchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const taxYear = Number(url.searchParams.get("taxYear"));
  const format = String(url.searchParams.get("format") ?? "json");
  if (!Number.isInteger(organizationId) || !Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2200) {
    return Response.json({ error: "organizationId and a valid taxYear are required." }, { status: 400 });
  }

  const denied = await requireCompanyWide(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only company-wide payroll operators can view the DOLE 13th-month compliance report.",
  );
  if (denied) return denied;

  const state = await buildDoleThirteenthMonthState(organizationId, taxYear);
  if (!state) return Response.json({ error: "Organization not found." }, { status: 404 });

  if (format === "csv") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const summaryRows = [
      ["SUMMARY", "Establishment name", "", "", state.report.establishmentName],
      ["SUMMARY", "Establishment address", "", "", state.report.establishmentAddress],
      ["SUMMARY", "Principal product/business", "", "", state.report.principalBusiness],
      ["SUMMARY", "Total employment", "", "", String(state.report.totalEmployment)],
      ["SUMMARY", "Workers benefited", "", "", String(state.report.workersBenefited)],
      ["SUMMARY", "Total benefits granted", "", "", state.report.totalBenefitsGranted.toFixed(2)],
      ["SUMMARY", "Reporting contact", "", "", state.report.contactName],
      ["SUMMARY", "Contact position", "", "", state.report.contactPosition],
      ["SUMMARY", "Contact phone", "", "", state.report.contactPhone],
      ["SUMMARY", "Report deadline", "", "", state.report.dueDate],
      ["NOTE", "Portal", "", "", "Submit through the DOLE Online Compliance Portal. This CSV is a PayrollPH source worksheet, not an OCP upload template."],
    ];
    const employeeRows = state.report.employees.map((employee) => [
      "EMPLOYEE",
      "Amount granted",
      employee.employeeNo,
      employee.employeeName,
      employee.amountGranted.toFixed(2),
    ]);
    const csv = toCsv({
      columns: ["Record Type", "Field", "Employee No", "Employee Name", "Value"],
      rows: [...summaryRows, ...employeeRows],
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "DOLE 13th-month source worksheet generated",
      resource: `Report year ${taxYear}`,
      metadata: {
        taxYear,
        reportHash: state.reportHash,
        totalEmployment: state.report.totalEmployment,
        workersBenefited: state.report.workersBenefited,
        totalBenefitsGranted: state.report.totalBenefitsGranted,
        sourceWorksheetOnly: true,
        portalSubmissionPerformedByPayrollPH: false,
      },
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dole-13th-month-source-${taxYear}.csv"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return Response.json({
    ...state,
    officialSource: {
      label: "DOLE Online Compliance Portal",
      url: "https://reports.dole.gov.ph/",
      deadline: state.report.dueDate,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await ensureDoleReportingSchema();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Managing DOLE compliance reporting");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const taxYear = Number(body.taxYear);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId) || !Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2200) {
    return Response.json({ error: "organizationId and a valid taxYear are required." }, { status: 400 });
  }

  const denied = await requireCompanyWide(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only a company-wide Owner, Admin or Bookkeeper can manage DOLE report profile and submission evidence.",
  );
  if (denied) return denied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `dole-13th-month-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 20,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "save_profile") {
    const profile = {
      establishmentAddress: bounded(body.establishmentAddress, 1000),
      principalBusiness: bounded(body.principalBusiness, 240),
      contactName: bounded(body.contactName, 160),
      contactPosition: bounded(body.contactPosition, 160),
      contactPhone: bounded(body.contactPhone, 48),
    };
    if (Object.values(profile).some((value) => value.length < 2)) {
      return Response.json({
        error: "Complete the establishment address, principal business and reporting contact before saving.",
      }, { status: 400 });
    }

    const [saved] = await db.insert(doleReportingProfiles).values({
      organizationId,
      ...profile,
      updatedBy: user.name,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: doleReportingProfiles.organizationId,
      set: {
        ...profile,
        updatedBy: user.name,
        updatedAt: new Date(),
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "DOLE reporting profile updated",
      resource: `13th-month reporting · ${taxYear}`,
      metadata: { taxYear, profileComplete: true },
    });
    return Response.json({ profile: saved });
  }

  if (action === "record_submission") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const state = await buildDoleThirteenthMonthState(organizationId, taxYear);
    if (!state) return Response.json({ error: "Organization not found." }, { status: 404 });
    if (!state.readyToSubmit) {
      return Response.json({
        error: "Complete the DOLE reporting profile and payroll source data before recording portal submission.",
      }, { status: 409 });
    }

    const portalReference = bounded(body.portalReference, 160);
    const submittedAt = new Date(String(body.submittedAt ?? ""));
    if (portalReference.length < 4) {
      return Response.json({ error: "Record the confirmation/reference shown by the DOLE portal." }, { status: 400 });
    }
    if (Number.isNaN(submittedAt.getTime()) || submittedAt.getTime() > Date.now() + 86_400_000) {
      return Response.json({ error: "submittedAt must be a valid date that is not in the future." }, { status: 400 });
    }

    const [existing] = await db.select().from(doleComplianceSubmissions).where(and(
      eq(doleComplianceSubmissions.organizationId, organizationId),
      eq(doleComplianceSubmissions.reportType, "13th_month_pay"),
      eq(doleComplianceSubmissions.reportYear, taxYear),
      eq(doleComplianceSubmissions.reportHash, state.reportHash),
    )).limit(1);

    const submission = existing ?? (await db.insert(doleComplianceSubmissions).values({
      organizationId,
      reportType: "13th_month_pay",
      reportYear: taxYear,
      reportHash: state.reportHash,
      status: "submitted",
      portalReference,
      submittedAt,
      recordedByUserId: user.id,
      recordedByName: user.name,
    }).returning())[0];

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "DOLE 13th-month portal submission recorded",
      resource: `Report year ${taxYear}`,
      metadata: {
        taxYear,
        reportHash: state.reportHash,
        portalReference: submission.portalReference,
        submittedAt: submission.submittedAt.toISOString(),
        portalSubmissionPerformedByPayrollPH: false,
      },
    });

    return Response.json({
      submission,
      submissionCurrent: true,
      reportHash: state.reportHash,
    });
  }

  return Response.json({
    error: "Unsupported action. Use save_profile or record_submission.",
  }, { status: 400 });
}
