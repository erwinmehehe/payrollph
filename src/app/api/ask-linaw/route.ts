import { and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceRules,
  employees,
  governmentFilingValidations,
  payrollEntries,
  payrollRuns,
  statutoryRemittanceObligations,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  getAccess,
  PAYROLL_VIEW_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import {
  ASK_LINAW_SUPPORTED_PROMPTS,
  classifyAskLinawQuestion,
} from "@/lib/ask-linaw";
import { getSessionUser } from "@/lib/auth";
import { FILING_FORMS } from "@/lib/filing-evidence";
import { buildPayExplanation } from "@/lib/payroll-explain";
import { buildPayrollReleaseChecklist } from "@/lib/payroll-release-checklist";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function phToday() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
}

const peso = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  const runId = Number(body.runId);
  const employeeId = Number(body.employeeId);
  if (!Number.isInteger(organizationId) || organizationId <= 0 || !question) {
    return Response.json({ error: "organizationId and question are required." }, { status: 400 });
  }

  const intent = classifyAskLinawQuestion(question);
  if (intent === "unsupported") {
    return Response.json({
      intent,
      title: "Ask a payroll or compliance evidence question.",
      answer: "I only answer questions that can be grounded in Linaw's stored payroll, rule, filing, or remittance evidence. I do not invent general HR or legal advice.",
      evidence: [],
      supportedPrompts: ASK_LINAW_SUPPORTED_PROMPTS,
    });
  }

  if (intent === "release-blockers" || intent === "pay-explanation") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PAYROLL_VIEW_ROLES,
      "Your role cannot inspect payroll evidence.",
    );
    if (denied) return denied;

    const [run] = Number.isInteger(runId) && runId > 0
      ? await db.select().from(payrollRuns).where(and(
          eq(payrollRuns.id, runId),
          eq(payrollRuns.organizationId, organizationId),
        )).limit(1)
      : await db.select().from(payrollRuns)
          .where(eq(payrollRuns.organizationId, organizationId))
          .orderBy(desc(payrollRuns.id))
          .limit(1);
    if (!run) return Response.json({ error: "No payroll run is available for this question." }, { status: 404 });

    const scopeDenied = await assertOrganizationUnitAccess(
      user.id,
      organizationId,
      run.scopeOrgUnitId,
      "This payroll run is outside your assigned organization unit.",
    );
    if (scopeDenied) return scopeDenied;

    if (intent === "release-blockers") {
      const checklist = await buildPayrollReleaseChecklist(run.id);
      if (!checklist) return Response.json({ error: "Payroll release evidence is unavailable." }, { status: 404 });
      const failed = checklist.items.filter((item) => item.blocking && !item.passed);
      const findings = checklist.assurance?.findings.filter((finding) => finding.blocking) ?? [];
      return Response.json({
        intent,
        title: failed.length === 0 ? "No recorded release blocker remains." : `${failed.length} release blocker(s) remain.`,
        answer: failed.length === 0
          ? `${run.periodLabel} passes every recorded release-checklist item. Release still requires the authorized role and recent MFA.`
          : failed.map((item) => `${item.label}: ${item.detail}`).join(" "),
        evidence: [
          ...failed.map((item) => ({
            label: item.label,
            value: item.detail,
            source: `release-checklist:${item.key}`,
          })),
          ...findings.slice(0, 8).map((finding) => ({
            label: finding.title,
            value: finding.detail,
            source: `payroll-assurance:${finding.code}`,
          })),
        ],
        run: { id: run.id, periodLabel: run.periodLabel, status: run.status, ruleVersion: run.ruleVersion },
        limitations: "This reads Linaw's release controls and stored evidence. It does not replace an external payroll reconciliation.",
        supportedPrompts: ASK_LINAW_SUPPORTED_PROMPTS,
      });
    }

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return Response.json({
        error: "Select an employee to explain pay.",
        requires: { employeeId: true, runId: run.id },
      }, { status: 422 });
    }
    const [[employee], [entry]] = await Promise.all([
      db.select().from(employees).where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
      db.select().from(payrollEntries).where(and(
        eq(payrollEntries.payrollRunId, run.id),
        eq(payrollEntries.employeeId, employeeId),
      )).limit(1),
    ]);
    if (!employee || !entry) return Response.json({ error: "Payroll entry not found for the selected employee and run." }, { status: 404 });

    const [previousRun] = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      lt(payrollRuns.payDate, run.payDate),
    )).orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id)).limit(1);
    const [previousEntry] = previousRun
      ? await db.select().from(payrollEntries).where(and(
          eq(payrollEntries.payrollRunId, previousRun.id),
          eq(payrollEntries.employeeId, employeeId),
        )).limit(1)
      : [];
    const explanation = buildPayExplanation(entry, previousEntry ?? null);
    const top = explanation.lines.slice(0, 6);
    const change = explanation.netDelta == null
      ? `Net pay is ${peso(explanation.currentNet)} for this cutoff.`
      : `Net pay is ${peso(explanation.currentNet)}, ${explanation.netDelta >= 0 ? "up" : "down"} ${peso(Math.abs(explanation.netDelta))} from the prior released payroll.`;

    return Response.json({
      intent,
      title: `${employee.firstName} ${employee.lastName}: pay explanation`,
      answer: `${change} The largest stored payroll components are: ${top.map((line) => `${line.label} ${peso(line.current)} — ${line.reason}`).join(" ")}`,
      evidence: top.map((line) => ({
        label: `${line.code} · ${line.label}`,
        value: `${peso(line.current)} · ${line.reason}`,
        source: `payroll-entry:${entry.id} · rule:${explanation.ruleVersion ?? run.ruleVersion}`,
      })),
      run: { id: run.id, periodLabel: run.periodLabel, status: run.status, ruleVersion: explanation.ruleVersion ?? run.ruleVersion },
      limitations: "Explanation is generated deterministically from stored line items and payroll trace. It is not a free-form AI interpretation.",
      supportedPrompts: ASK_LINAW_SUPPORTED_PROMPTS,
    });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role cannot inspect company-wide compliance evidence.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Company-wide compliance evidence requires company-wide access." }, { status: 403 });
  }

  const today = phToday();

  if (intent === "remittance-status") {
    const rows = await db.select().from(statutoryRemittanceObligations)
      .where(eq(statutoryRemittanceObligations.organizationId, organizationId));
    const overdue = rows.filter((row) => {
      if (row.status === "confirmed") return false;
      const due = row.dueDate ? String(row.dueDate) : null;
      return due ? due < today : String(row.applicableMonth) < today.slice(0, 7);
    });
    const confirmed = rows.filter((row) => row.status === "confirmed");
    const exposure = overdue.reduce((sum, row) => sum + Number(row.expectedTotalAmount || 0), 0);
    return Response.json({
      intent,
      title: overdue.length ? `${overdue.length} statutory remittance obligation(s) need attention.` : "No recorded overdue statutory remittance remains.",
      answer: overdue.length
        ? `Known overdue/unconfirmed statutory liability is ${peso(exposure)} across ${overdue.length} obligation(s). Payment evidence and independent posting confirmation are separate steps.`
        : `${confirmed.length} obligation(s) are confirmed as posted in the recorded evidence; no recorded overdue obligation remains as of ${today}.`,
      evidence: rows.slice(0, 20).map((row) => ({
        label: `${row.agency} · ${row.applicableMonth}`,
        value: `${row.status} · ${peso(Number(row.expectedTotalAmount || 0))} · due ${row.dueDate ?? "deadline configuration pending"}`,
        source: `statutory-remittance:${row.id}`,
      })),
      limitations: "A recorded confirmation is operator evidence. Linaw does not claim direct agency-portal verification unless a future integration supplies it.",
      supportedPrompts: ASK_LINAW_SUPPORTED_PROMPTS,
    });
  }

  if (intent === "filing-status") {
    const validations = await db.select().from(governmentFilingValidations)
      .where(eq(governmentFilingValidations.organizationId, organizationId))
      .orderBy(desc(governmentFilingValidations.id));
    const accepted = new Map<string, typeof validations[number]>();
    for (const row of validations) {
      const key = `${row.agency}:${row.form}:${row.generatorVersion}`;
      if (!accepted.has(key) && row.status === "accepted") accepted.set(key, row);
    }
    const statusRows = FILING_FORMS.map((form) => {
      const evidence = accepted.get(`${form.agency}:${form.form}:${form.generatorVersion}`) ?? null;
      return { form, evidence };
    });
    const proven = statusRows.filter((row) => row.evidence).length;
    return Response.json({
      intent,
      title: `${proven}/${statusRows.length} tracked government filing format(s) have accepted current-version evidence.`,
      answer: statusRows.map(({ form, evidence }) =>
        `${form.agency} ${form.form}: ${evidence ? `accepted · ref ${evidence.agencyReference ?? "recorded"}` : "acceptance evidence missing"}`
      ).join(" "),
      evidence: statusRows.map(({ form, evidence }) => ({
        label: `${form.agency} ${form.form}`,
        value: evidence ? `Accepted · ${evidence.agencyReference ?? "reference recorded"}` : "No accepted current-version evidence",
        source: evidence ? `government-filing-validation:${evidence.id}` : `generator:${form.generatorVersion}`,
      })),
      limitations: "Local file generation or preflight does not count as agency acceptance.",
      supportedPrompts: ASK_LINAW_SUPPORTED_PROMPTS,
    });
  }

  const rules = await db.select().from(complianceRules).where(and(
    eq(complianceRules.status, "approved"),
    lte(complianceRules.effectiveFrom, today),
    or(isNull(complianceRules.effectiveUntil), gte(complianceRules.effectiveUntil, today)),
  )).orderBy(complianceRules.agency, complianceRules.ruleKey);
  return Response.json({
    intent: "rule-status",
    title: `${rules.length} approved compliance rule version(s) are effective today.`,
    answer: rules.length
      ? rules.map((rule) => `${rule.agency} ${rule.ruleKey} uses ${rule.ruleVersion}, effective ${rule.effectiveFrom}${rule.effectiveUntil ? ` to ${rule.effectiveUntil}` : ""}.`).join(" ")
      : "No approved effective rule record is available for today. Payroll should fail closed where the governed registry is required.",
    evidence: rules.map((rule) => ({
      label: `${rule.agency} · ${rule.ruleKey}`,
      value: `${rule.ruleVersion} · effective ${rule.effectiveFrom}${rule.effectiveUntil ? ` to ${rule.effectiveUntil}` : ""}`,
      source: rule.sourceUrl || rule.sourceDocument,
    })),
    limitations: "Rule records show governed source/effective-date evidence; they are not a legal opinion.",
    supportedPrompts: ASK_LINAW_SUPPORTED_PROMPTS,
  });
}
