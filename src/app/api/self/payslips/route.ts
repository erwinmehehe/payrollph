import { contributionCaseServiceStatus } from "@/lib/statutory-contribution-case-aging";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, governmentLoanRemittanceBatches, governmentLoanRemittanceMembers, leaveBalances, leavePolicies, leaveRequests, organizations, payrollEntries, payrollRuns, payslips, statutoryContributionIssueCases, statutoryContributionIssueEvents, statutoryRemittanceBatches, statutoryRemittanceMembers, statutoryPostingEvidenceArtifacts, timePunches, userOrganizations, users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { employeePayStatusLabel } from "@/lib/payroll-handoff";
import { recordAuditEvent } from "@/lib/audit";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { computeBalance } from "@/lib/leave-accrual";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import { postingEvidenceSourceLabel } from "@/lib/statutory-posting-evidence";

export const dynamic = "force-dynamic";

/**
 * Employee self-service. A session with role="employee" resolves to exactly one
 * employee record, and every query below is filtered by that id, not by a
 * client-supplied parameter, so an employee cannot read a colleague's payslip.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  if (session.role !== "employee") {
    return Response.json({ error: "This endpoint is for employee self-service accounts." }, { status: 403 });
  }
  if (!session.employeeId) {
    return Response.json({ error: "This account is not linked to an employee record. Contact your administrator." }, { status: 403 });
  }
  await ensureLeavePayrollSchema();

  const [employee] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!employee) return Response.json({ error: "Employee record not found." }, { status: 404 });

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, employee.organizationId)).limit(1);

  const rows = await db
    .select({ entry: payrollEntries, run: payrollRuns, slip: payslips })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .leftJoin(payslips, eq(payslips.payrollEntryId, payrollEntries.id))
    .where(and(
      eq(payrollEntries.employeeId, session.employeeId),
      eq(payrollRuns.organizationId, employee.organizationId),
    ))
    .orderBy(desc(payrollRuns.payDate))
    .limit(52);

  const released = rows.filter((row) => row.run.status === "Released");
  const upcoming = rows
    .filter((row) => row.run.status !== "Released")
    .sort((a, b) => a.run.payDate.localeCompare(b.run.payDate))[0];

  const currentTaxYear = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const todayPh = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const currentYear = Number(currentTaxYear);

  const [attendanceRows, leaveRows, policyRows, storedBalanceRows, contributionRows, governmentLoanRows] = await Promise.all([
    db.select({
      id: timePunches.id,
      workDate: timePunches.workDate,
      timeIn: timePunches.timeIn,
      timeOut: timePunches.timeOut,
      breakStart: timePunches.breakStart,
      breakEnd: timePunches.breakEnd,
      status: timePunches.status,
      source: timePunches.source,
    }).from(timePunches)
      .where(and(
        eq(timePunches.organizationId, employee.organizationId),
        eq(timePunches.employeeId, session.employeeId),
      ))
      .orderBy(desc(timePunches.workDate), desc(timePunches.id))
      .limit(31),
    db.select().from(leaveRequests)
      .where(and(
        eq(leaveRequests.organizationId, employee.organizationId),
        eq(leaveRequests.employeeId, session.employeeId),
      ))
      .orderBy(desc(leaveRequests.id)),
    db.select().from(leavePolicies)
      .where(and(
        eq(leavePolicies.organizationId, employee.organizationId),
        eq(leavePolicies.active, true),
      )),
    db.select().from(leaveBalances)
      .where(and(
        eq(leaveBalances.organizationId, employee.organizationId),
        eq(leaveBalances.employeeId, session.employeeId),
        eq(leaveBalances.year, currentYear),
      )),
    db.select({
      memberId: statutoryRemittanceMembers.id,
      batchId: statutoryRemittanceBatches.id,
      agency: statutoryRemittanceBatches.agency,
      applicableMonth: statutoryRemittanceBatches.applicableMonth,
      dueDate: statutoryRemittanceBatches.dueDate,
      batchStatus: statutoryRemittanceBatches.status,
      amountPaid: statutoryRemittanceBatches.amountPaid,
      paidAt: statutoryRemittanceBatches.paidAt,
      employeeShare: statutoryRemittanceMembers.employeeShare,
      employerShare: statutoryRemittanceMembers.employerShare,
      totalContribution: statutoryRemittanceMembers.totalContribution,
      postingStatus: statutoryRemittanceMembers.postingStatus,
      postingReference: statutoryRemittanceMembers.postingReference,
      postedAmount: statutoryRemittanceMembers.postedAmount,
      postedAt: statutoryRemittanceMembers.postedAt,
      postingEvidenceArtifactId: statutoryRemittanceMembers.postingEvidenceArtifactId,
      postingEvidenceSourceType: statutoryPostingEvidenceArtifacts.sourceType,
      postingEvidenceHashSha256: statutoryPostingEvidenceArtifacts.contentSha256,
      postingEvidenceFileName: statutoryPostingEvidenceArtifacts.fileName,
      exceptionNote: statutoryRemittanceMembers.exceptionNote,
    }).from(statutoryRemittanceMembers)
      .innerJoin(
        statutoryRemittanceBatches,
        eq(statutoryRemittanceMembers.batchId, statutoryRemittanceBatches.id),
      )
      .leftJoin(
        statutoryPostingEvidenceArtifacts,
        eq(statutoryRemittanceMembers.postingEvidenceArtifactId, statutoryPostingEvidenceArtifacts.id),
      )
      .where(and(
        eq(statutoryRemittanceMembers.organizationId, employee.organizationId),
        eq(statutoryRemittanceMembers.employeeId, session.employeeId),
      ))
      .orderBy(desc(statutoryRemittanceBatches.applicableMonth), desc(statutoryRemittanceBatches.id))
      .limit(36),
    db.select({
      memberId: governmentLoanRemittanceMembers.id,
      batchId: governmentLoanRemittanceBatches.id,
      agency: governmentLoanRemittanceBatches.agency,
      applicableMonth: governmentLoanRemittanceBatches.applicableMonth,
      dueDate: governmentLoanRemittanceBatches.dueDate,
      batchStatus: governmentLoanRemittanceBatches.status,
      amountPaid: governmentLoanRemittanceBatches.amountPaid,
      paidAt: governmentLoanRemittanceBatches.paidAt,
      loanType: governmentLoanRemittanceMembers.loanType,
      loanReferenceNo: governmentLoanRemittanceMembers.loanReferenceNo,
      deductedAmount: governmentLoanRemittanceMembers.deductedAmount,
      postingStatus: governmentLoanRemittanceMembers.postingStatus,
      postingReference: governmentLoanRemittanceMembers.postingReference,
      postedAmount: governmentLoanRemittanceMembers.postedAmount,
      postedAt: governmentLoanRemittanceMembers.postedAt,
      exceptionNote: governmentLoanRemittanceMembers.exceptionNote,
    }).from(governmentLoanRemittanceMembers)
      .innerJoin(
        governmentLoanRemittanceBatches,
        eq(governmentLoanRemittanceMembers.batchId, governmentLoanRemittanceBatches.id),
      )
      .where(and(
        eq(governmentLoanRemittanceMembers.organizationId, employee.organizationId),
        eq(governmentLoanRemittanceMembers.employeeId, session.employeeId),
      ))
      .orderBy(desc(governmentLoanRemittanceBatches.applicableMonth), desc(governmentLoanRemittanceBatches.id))
      .limit(36),
  ]);

  const contributionIssueRows = await db.select().from(statutoryContributionIssueCases)
    .where(and(
      eq(statutoryContributionIssueCases.organizationId, employee.organizationId),
      eq(statutoryContributionIssueCases.employeeId, session.employeeId),
    ))
    .orderBy(desc(statutoryContributionIssueCases.createdAt), desc(statutoryContributionIssueCases.id))
    .limit(30);

  const contributionIssueEvents = await db.select().from(statutoryContributionIssueEvents)
    .where(and(
      eq(statutoryContributionIssueEvents.organizationId, employee.organizationId),
      eq(statutoryContributionIssueEvents.employeeId, session.employeeId),
      eq(statutoryContributionIssueEvents.visibility, "employee"),
    ))
    .orderBy(desc(statutoryContributionIssueEvents.createdAt), desc(statutoryContributionIssueEvents.id))
    .limit(200);
  const contributionIssueEventsByCase = new Map<number, typeof contributionIssueEvents>();
  for (const event of contributionIssueEvents) {
    contributionIssueEventsByCase.set(event.caseId, [
      ...(contributionIssueEventsByCase.get(event.caseId) ?? []),
      event,
    ]);
  }

  const releasedThisYear = released.filter((row) => String(row.run.payDate).startsWith(`${currentTaxYear}-`));

  const yearToDate = releasedThisYear.reduce(
    (totals, row) => {
      const items = Array.isArray(row.entry.lineItems) ? row.entry.lineItems as Array<{ code?: string; amount?: number }> : [];
      for (const item of items) {
        const amount = Number(item.amount ?? 0);
        if (item.code === "WHT") totals.tax += Math.abs(amount);
      }
      totals.gross += Number(row.entry.grossPay);
      totals.net += Number(row.entry.netPay);
      totals.deductions += Number(row.entry.deductions);
      return totals;
    },
    { gross: 0, net: 0, deductions: 0, tax: 0 },
  );

  const storedByType = new Map(storedBalanceRows.map((row) => [row.leaveType, row]));
  const leaveBalanceSummary = policyRows.map((policy) => {
    const mine = leaveRows.filter(
      (request) => request.leaveType === policy.leaveType && String(request.startDate).startsWith(String(currentYear)),
    );
    const used = mine.filter((request) => request.status === "Approved").reduce((sum, request) => sum + Number(request.days), 0);
    const pending = mine.filter((request) => request.status === "Pending").reduce((sum, request) => sum + Number(request.days), 0);
    const opening = Number(storedByType.get(policy.leaveType)?.opening ?? 0);
    const balance = computeBalance({
      policy: {
        leaveType: policy.leaveType,
        annualDays: Number(policy.annualDays),
        carryOverMax: policy.carryOverMax == null ? null : Number(policy.carryOverMax),
        maxBalance: policy.maxBalance == null ? null : Number(policy.maxBalance),
      },
      startDate: String(employee.startDate),
      asOf: todayPh,
      opening,
      used,
      pending,
    });
    return {
      ...balance,
      payTreatment: policy.payTreatment,
      paidPercentage: policy.paidPercentage,
    };
  });

  return Response.json({
    employee: {
      employeeNo: employee.employeeNo,
      firstName: employee.firstName,
      lastName: employee.lastName,
      title: employee.title,
      employmentType: employee.employmentType,
      status: employee.status,
      monthlyBasic: employee.basicRate,
      startDate: employee.startDate,
      restDay: employee.restDay,
      region: employee.region,
      mobile: employee.mobile,
      email: employee.email,
      emergencyContact: employee.emergencyContact,
      emergencyPhone: employee.emergencyPhone,
    },
    employer: organization ? { id: organization.id, name: organization.name } : null,
    yearToDate: {
      gross: yearToDate.gross.toFixed(2),
      net: yearToDate.net.toFixed(2),
      deductions: yearToDate.deductions.toFixed(2),
      tax: yearToDate.tax.toFixed(2),
      periodsPaid: releasedThisYear.length,
    },
    nextPay: upcoming
      ? {
          period: upcoming.run.periodLabel,
          payDate: upcoming.run.payDate,
          status: upcoming.run.status,
          label: employeePayStatusLabel(upcoming.run.status),
        }
      : null,
    payslips: released.map((row) => ({
      entryId: row.entry.id,
      period: row.run.periodLabel,
      payDate: row.run.payDate,
      gross: row.entry.grossPay,
      deductions: row.entry.deductions,
      net: row.entry.netPay,
      ruleVersion: row.run.ruleVersion,
      lineItems: row.entry.lineItems,
    })),
    contributions: contributionRows.map((row) => ({
      memberId: row.memberId,
      batchId: row.batchId,
      agency: row.agency,
      applicableMonth: row.applicableMonth,
      dueDate: row.dueDate,
      paymentStatus: row.batchStatus,
      amountPaid: row.amountPaid,
      paidAt: row.paidAt,
      employeeShare: row.employeeShare,
      employerShare: row.employerShare,
      totalContribution: row.totalContribution,
      postingStatus: row.postingStatus,
      postingReference: row.postingReference,
      postedAmount: row.postedAmount,
      postedAt: row.postedAt,
      postingEvidenceArtifactId: row.postingEvidenceArtifactId,
      postingEvidenceSource: row.postingEvidenceSourceType
        ? postingEvidenceSourceLabel(row.postingEvidenceSourceType)
        : null,
      postingEvidenceHashSha256: row.postingEvidenceHashSha256,
      postingEvidenceFileName: row.postingEvidenceFileName,
      exceptionNote: row.exceptionNote,
    })),
    governmentLoanRemittances: governmentLoanRows.map((row) => ({
      memberId: row.memberId,
      batchId: row.batchId,
      agency: row.agency,
      applicableMonth: row.applicableMonth,
      dueDate: row.dueDate,
      paymentStatus: row.batchStatus,
      amountPaid: row.amountPaid,
      paidAt: row.paidAt,
      loanType: row.loanType,
      loanReferenceNo: row.loanReferenceNo,
      deductedAmount: row.deductedAmount,
      postingStatus: row.postingStatus,
      postingReference: row.postingReference,
      postedAmount: row.postedAmount,
      postedAt: row.postedAt,
      exceptionNote: row.exceptionNote,
    })),
    contributionIssues: contributionIssueRows.map((row) => ({
      id: row.id,
      agency: row.agency,
      applicableMonth: row.applicableMonth,
      issueType: row.issueType,
      description: row.description,
      status: row.status,
      assignedToName: row.assignedToName,
      resolutionOutcome: row.resolutionOutcome,
      resolutionNote: row.resolutionNote,
      resolvedByName: row.resolvedByName,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      service: contributionCaseServiceStatus(row),
      events: contributionIssueEventsByCase.get(row.id) ?? [],
    })),
    attendance: {
      recent: attendanceRows,
      today: attendanceRows.find((row) => row.workDate === todayPh) ?? null,
      completeCount: attendanceRows.filter((row) => Boolean(row.timeIn && row.timeOut)).length,
      incompleteCount: attendanceRows.filter((row) => !row.timeIn || !row.timeOut).length,
    },
    leave: {
      balances: leaveBalanceSummary,
      requests: leaveRows.slice(0, 12).map((row) => ({
        id: row.id,
        leaveType: row.leaveType,
        startDate: row.startDate,
        endDate: row.endDate,
        days: row.days,
        reason: row.reason,
        status: row.status,
        decidedBy: row.decidedBy,
        createdAt: row.createdAt,
      })),
      policies: policyRows.map((policy) => ({
        leaveType: policy.leaveType,
        payTreatment: policy.payTreatment,
        paidPercentage: policy.paidPercentage,
      })),
    },
  });
}

/** Links (or re-links) a signed-in employee account to their employee record. */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const employeeNo = String(body.employeeNo ?? "").trim();
  if (!employeeNo) return Response.json({ error: "employeeNo is required." }, { status: 400 });

  // Cross-tenant guard: the caller may only link to an employee record inside an
  // organization they are actually a member of. The organizationId in the request
  // body is ignored entirely, trusting it let any authenticated user claim a
  // record at another company by guessing an employee number.
  const memberships = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, session.id));
  const myOrganizations = memberships.map((row) => row.organizationId);
  if (myOrganizations.length === 0) {
    return Response.json({ error: "Your account is not a member of any workspace." }, { status: 403 });
  }

  const candidates = await db.select().from(employees).where(
    and(eq(employees.employeeNo, employeeNo), inArray(employees.organizationId, myOrganizations)),
  );
  if (candidates.length === 0) {
    return Response.json({ error: "No employee found with that number in your workspace." }, { status: 404 });
  }
  if (candidates.length > 1) {
    return Response.json({ error: "That employee number exists in more than one of your workspaces. Ask your administrator to link it directly." }, { status: 409 });
  }
  const employee = candidates[0];

  const claimed = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.employeeId, employee.id)).limit(1);
  if (claimed.length && claimed[0].id !== session.id) {
    return Response.json({ error: `This employee record is already linked to ${claimed[0].email}.` }, { status: 409 });
  }

  // Linking is only for dedicated employee identities. Never let an owner,
  // HR, payroll, checker, manager, admin or bookkeeper session demote itself by
  // submitting an employee number.
  if (session.role !== "employee") {
    return Response.json({
      error: "Only employee self-service accounts can link an employee record.",
      hint: "Invite a separate employee account instead of reusing a privileged account.",
    }, { status: 403 });
  }

  await db.update(users).set({ employeeId: employee.id }).where(eq(users.id, session.id));

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: session.name,
    action: "Employee self-service account linked",
    resource: employee.employeeNo,
    metadata: { userId: session.id, employeeId: employee.id },
  });

  return Response.json({ ok: true, employeeId: employee.id, employeeNo: employee.employeeNo });
}
