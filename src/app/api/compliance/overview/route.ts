import { and, desc, eq, lte, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bankFileValidations,
  complianceRules,
  governmentFilingValidations,
  payrollRuns,
  statutoryRemittanceObligations,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { calculateComplianceEvidenceScore } from "@/lib/compliance-evidence-score";
import { FILING_FORMS } from "@/lib/filing-evidence";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

export const dynamic = "force-dynamic";

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can review compliance evidence.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Compliance evidence requires company-wide payroll access.",
    }, { status: 403 });
  }

  const today = todayPh();
  const month = today.slice(0, 7);

  const [runs, remittances, filings, bankValidations, activeRules] = await Promise.all([
    db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId))
      .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))
      .limit(20),
    db.select().from(statutoryRemittanceObligations)
      .where(eq(statutoryRemittanceObligations.organizationId, organizationId)),
    db.select().from(governmentFilingValidations)
      .where(eq(governmentFilingValidations.organizationId, organizationId)),
    db.select().from(bankFileValidations)
      .where(eq(bankFileValidations.organizationId, organizationId)),
    db.select().from(complianceRules).where(and(
      eq(complianceRules.status, "approved"),
      lte(complianceRules.effectiveFrom, today),
      or(isNull(complianceRules.effectiveUntil), lte(today, complianceRules.effectiveUntil)),
    )),
  ]);

  const latestRun = runs.find((run) =>
    !["Draft", "Queued", "Processing", "Recalculating", "Failed"].includes(run.status)
  ) ?? null;
  const assurance = latestRun ? await buildPayrollAssurance(latestRun.id) : null;
  const blockingFindings = assurance?.assurance.findings.filter((finding) => finding.blocking) ?? [];

  const acceptedFilingKeys = new Set(
    filings
      .filter((row) => row.status === "accepted")
      .map((row) => `${row.agency}:${row.form}:${row.generatorVersion}`),
  );
  const acceptedFilingForms = FILING_FORMS.filter((form) =>
    acceptedFilingKeys.has(`${form.agency}:${form.form}:${form.generatorVersion}`)
  );

  const dueRemittances = remittances.filter((row) => {
    const dueDate = row.dueDate ? String(row.dueDate) : null;
    return dueDate ? dueDate <= today : String(row.applicableMonth) < month;
  });
  const confirmedDueRemittances = dueRemittances.filter((row) => row.status === "confirmed");
  const overdueRemittances = dueRemittances.filter((row) => row.status !== "confirmed" && (
    row.dueDate ? String(row.dueDate) < today : String(row.applicableMonth) < month
  ));
  const acceptedBankValidations = bankValidations.filter((row) => row.status === "accepted");
  const knownRemittanceExposure = overdueRemittances.reduce(
    (sum, row) => sum + Number(row.expectedTotalAmount || 0),
    0,
  );

  const evidence = calculateComplianceEvidenceScore({
    activeApprovedRules: activeRules.length,
    latestPayrollBlockingFindings: latestRun ? blockingFindings.length : null,
    acceptedFilingForms: acceptedFilingForms.length,
    requiredFilingForms: FILING_FORMS.length,
    dueRemittanceObligations: dueRemittances.length,
    confirmedDueRemittances: confirmedDueRemittances.length,
    overdueRemittances: overdueRemittances.length,
    acceptedBankValidations: acceptedBankValidations.length,
  });

  const findings = [
    ...blockingFindings.map((finding) => ({
      severity: finding.severity,
      kind: "payroll",
      title: finding.title,
      detail: finding.detail,
      amount: null,
      action: "Open Payroll and resolve the assurance finding before release.",
    })),
    ...overdueRemittances.map((row) => ({
      severity: "high",
      kind: "remittance",
      title: `${row.agency} remittance is overdue`,
      detail: `${row.applicableMonth} liability of PHP ${Number(row.expectedTotalAmount).toFixed(2)} is not confirmed as posted.`,
      amount: Number(row.expectedTotalAmount),
      action: "Record the exact payment and have a different authorized reviewer confirm agency posting.",
    })),
  ];

  if (acceptedFilingForms.length < FILING_FORMS.length) {
    const missing = FILING_FORMS.filter((form) =>
      !acceptedFilingKeys.has(`${form.agency}:${form.form}:${form.generatorVersion}`)
    );
    findings.push({
      severity: "medium",
      kind: "filing",
      title: "Government filing formats are not fully portal-proven",
      detail: `${missing.length} tracked format(s) still lack accepted current-version evidence: ${missing.map((item) => `${item.agency} ${item.form}`).join(", ")}.`,
      amount: null,
      action: "Generate the exact file, submit it through the official employer workflow, and record the agency acknowledgement.",
    });
  }

  if (acceptedBankValidations.length === 0) {
    findings.push({
      severity: "medium",
      kind: "bank",
      title: "Bank payout file has no accepted UAT evidence",
      detail: "No current bank-file validation has a recorded portal acceptance.",
      amount: null,
      action: "Use a bank-provided layout, run a controlled UAT, and record the bank portal confirmation.",
    });
  }

  if (activeRules.length === 0) {
    findings.push({
      severity: "high",
      kind: "rules",
      title: "No approved effective rule record is active",
      detail: "The Compliance Rules Registry has no approved rule version effective today.",
      amount: null,
      action: "Review the official source, approve the effective rule version, and retain source/reviewer metadata.",
    });
  }

  return Response.json({
    checkedAt: new Date().toISOString(),
    today,
    score: evidence.score,
    scoreLabel: "Compliance evidence readiness",
    disclaimer: "This score measures recorded evidence and control readiness. It is not a legal opinion, agency certification, or guarantee of compliance.",
    domains: evidence.domains,
    knownRemittanceExposure,
    findings,
    evidence: {
      activeApprovedRules: activeRules.length,
      latestPayrollRun: latestRun ? {
        id: latestRun.id,
        periodLabel: latestRun.periodLabel,
        status: latestRun.status,
        blockingFindings: blockingFindings.length,
      } : null,
      filing: {
        accepted: acceptedFilingForms.length,
        required: FILING_FORMS.length,
      },
      remittance: {
        due: dueRemittances.length,
        confirmed: confirmedDueRemittances.length,
        overdue: overdueRemittances.length,
      },
      bank: {
        acceptedValidations: acceptedBankValidations.length,
      },
    },
  });
}
