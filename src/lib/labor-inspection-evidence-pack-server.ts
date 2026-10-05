import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayProfiles,
  employees,
  historicalPayrollEntries,
  laborInspectionRemediations,
  organizations,
  payrollEntries,
  payrollRuns,
  payslips,
  separationRecords,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
  timePunches,
} from "@/db/schema";
import { readBasicAndThirteenth } from "@/lib/final-pay";
import {
  buildLaborInspectionEvidencePack,
  evidenceSection,
  sha256Text,
} from "@/lib/labor-inspection-evidence-pack";
import { buildLaborInspectionReadiness } from "@/lib/labor-inspection-readiness-server";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function buildLaborInspectionEvidencePackForOrganization(input: {
  organizationId: number;
  generatedBy: string;
  today: string;
}) {
  const taxYear = Number(input.today.slice(0, 4));
  const startDate = `${taxYear}-01-01`;
  const endDate = input.today;

  const [organization] = await db.select({
    id: organizations.id,
    legalName: organizations.legalName,
  }).from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) throw new Error("Organization not found.");

  const [
    employeeRows,
    profileRows,
    runRows,
    historicalRows,
    punchRows,
    remittanceRowsAll,
    remittanceMemberRows,
    separationRowsAll,
    remediationRows,
    readiness,
  ] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, input.organizationId))
      .orderBy(asc(employees.employeeNo), asc(employees.id)),
    db.select().from(employeePayProfiles)
      .where(eq(employeePayProfiles.organizationId, input.organizationId))
      .orderBy(asc(employeePayProfiles.employeeId)),
    db.select().from(payrollRuns)
      .where(and(
        eq(payrollRuns.organizationId, input.organizationId),
        gte(payrollRuns.payDate, startDate),
        lte(payrollRuns.payDate, endDate),
      ))
      .orderBy(asc(payrollRuns.payDate), asc(payrollRuns.id)),
    db.select().from(historicalPayrollEntries)
      .where(and(
        eq(historicalPayrollEntries.organizationId, input.organizationId),
        gte(historicalPayrollEntries.payDate, startDate),
        lte(historicalPayrollEntries.payDate, endDate),
      ))
      .orderBy(asc(historicalPayrollEntries.payDate), asc(historicalPayrollEntries.id)),
    db.select().from(timePunches)
      .where(and(
        eq(timePunches.organizationId, input.organizationId),
        gte(timePunches.workDate, startDate),
        lte(timePunches.workDate, endDate),
      ))
      .orderBy(asc(timePunches.workDate), asc(timePunches.employeeId), asc(timePunches.id)),
    db.select().from(statutoryRemittanceBatches)
      .where(eq(statutoryRemittanceBatches.organizationId, input.organizationId))
      .orderBy(asc(statutoryRemittanceBatches.applicableMonth), asc(statutoryRemittanceBatches.agency)),
    db.select().from(statutoryRemittanceMembers)
      .where(eq(statutoryRemittanceMembers.organizationId, input.organizationId))
      .orderBy(asc(statutoryRemittanceMembers.batchId), asc(statutoryRemittanceMembers.employeeNo)),
    db.select().from(separationRecords)
      .where(eq(separationRecords.organizationId, input.organizationId))
      .orderBy(asc(separationRecords.lastDay), asc(separationRecords.id)),
    db.select().from(laborInspectionRemediations)
      .where(eq(laborInspectionRemediations.organizationId, input.organizationId))
      .orderBy(asc(laborInspectionRemediations.createdAt), asc(laborInspectionRemediations.id)),
    buildLaborInspectionReadiness(input.organizationId, { today: input.today }),
  ]);

  const employeeById = new Map(employeeRows.map((row) => [row.id, row]));
  const profileByEmployee = new Map(profileRows.map((row) => [row.employeeId, row]));
  const runById = new Map(runRows.map((row) => [row.id, row]));
  const runIds = runRows.map((row) => row.id);

  const entryRows = runIds.length
    ? await db.select().from(payrollEntries)
        .where(inArray(payrollEntries.payrollRunId, runIds))
        .orderBy(asc(payrollEntries.payrollRunId), asc(payrollEntries.employeeId), asc(payrollEntries.id))
    : [];
  const entryIds = entryRows.map((row) => row.id);
  const payslipRows = entryIds.length
    ? await db.select().from(payslips)
        .where(and(
          eq(payslips.organizationId, input.organizationId),
          inArray(payslips.payrollEntryId, entryIds),
        ))
        .orderBy(asc(payslips.employeeId), asc(payslips.id))
    : [];

  const workerRoster = employeeRows.map((employee) => {
    const profile = profileByEmployee.get(employee.id);
    return {
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
      title: employee.title,
      employmentType: employee.employmentType,
      status: employee.status,
      startDate: String(employee.startDate),
      region: employee.region,
      restDay: employee.restDay,
      payBasis: profile?.payBasis ?? null,
      rateAmount: profile ? Number(profile.rateAmount) : null,
      standardWorkDaysPerMonth: profile ? Number(profile.standardWorkDaysPerMonth) : null,
      standardHoursPerDay: profile ? Number(profile.standardHoursPerDay) : null,
    };
  });

  const payrollRegister = entryRows
    .filter((entry) => runById.get(entry.payrollRunId)?.status === "Released")
    .map((entry) => {
      const run = runById.get(entry.payrollRunId)!;
      const employee = employeeById.get(entry.employeeId);
      return {
        payrollRunId: run.id,
        periodLabel: run.periodLabel,
        periodStart: String(run.periodStart),
        periodEnd: String(run.periodEnd),
        payDate: String(run.payDate),
        ruleVersion: run.ruleVersion,
        employeeNo: employee?.employeeNo ?? `#${entry.employeeId}`,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
        grossPay: Number(entry.grossPay),
        deductions: Number(entry.deductions),
        netPay: Number(entry.netPay),
        status: entry.status,
        lineItems: entry.lineItems,
      };
    });

  const timeRecords = punchRows.map((punch) => {
    const employee = employeeById.get(punch.employeeId);
    return {
      employeeNo: employee?.employeeNo ?? `#${punch.employeeId}`,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
      workDate: String(punch.workDate),
      timeIn: punch.timeIn ? new Date(punch.timeIn).toISOString() : null,
      timeOut: punch.timeOut ? new Date(punch.timeOut).toISOString() : null,
      breakStart: punch.breakStart ? new Date(punch.breakStart).toISOString() : null,
      breakEnd: punch.breakEnd ? new Date(punch.breakEnd).toISOString() : null,
      shiftStart: punch.shiftStart,
      shiftEnd: punch.shiftEnd,
      status: punch.status,
      source: punch.source,
    };
  });

  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));
  const payslipIndex = payslipRows.flatMap((slip) => {
    const entry = entryById.get(slip.payrollEntryId);
    const run = entry ? runById.get(entry.payrollRunId) : null;
    if (!entry || !run || run.status !== "Released") return [];
    const employee = employeeById.get(slip.employeeId);
    return [{
      payslipId: slip.id,
      payrollEntryId: slip.payrollEntryId,
      payrollRunId: run.id,
      periodLabel: slip.periodLabel,
      employeeNo: employee?.employeeNo ?? `#${slip.employeeId}`,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
      ruleVersion: slip.ruleVersion,
      contentSha256: sha256Text(slip.content),
      downloadPath: `/api/payroll-runs/${run.id}/exports?kind=payslip&payslipId=${slip.id}`,
    }];
  });

  const thirteenthByEmployee = new Map<number, {
    releasedBasic: number;
    importedBasic: number;
    importedBasicMissingRows: number;
    thirteenthPaid: number;
  }>();
  for (const entry of entryRows) {
    const run = runById.get(entry.payrollRunId);
    if (!run || run.status !== "Released") continue;
    const parsed = readBasicAndThirteenth(entry.lineItems);
    const bucket = thirteenthByEmployee.get(entry.employeeId) ?? {
      releasedBasic: 0,
      importedBasic: 0,
      importedBasicMissingRows: 0,
      thirteenthPaid: 0,
    };
    bucket.releasedBasic += parsed.basic;
    bucket.thirteenthPaid += parsed.thirteenthPaid;
    thirteenthByEmployee.set(entry.employeeId, bucket);
  }
  for (const history of historicalRows) {
    const bucket = thirteenthByEmployee.get(history.employeeId) ?? {
      releasedBasic: 0,
      importedBasic: 0,
      importedBasicMissingRows: 0,
      thirteenthPaid: 0,
    };
    if (history.basicSalary == null) bucket.importedBasicMissingRows += 1;
    else bucket.importedBasic += Number(history.basicSalary);
    bucket.thirteenthPaid += Number(history.thirteenthMonth);
    thirteenthByEmployee.set(history.employeeId, bucket);
  }
  const thirteenthMonth = [...thirteenthByEmployee.entries()].map(([employeeId, totals]) => {
    const employee = employeeById.get(employeeId);
    const basicSalaryKnown = round2(totals.releasedBasic + totals.importedBasic);
    const entitlement = totals.importedBasicMissingRows > 0 ? null : round2(basicSalaryKnown / 12);
    return {
      employeeNo: employee?.employeeNo ?? `#${employeeId}`,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
      basicSalaryKnown,
      importedBasicMissingRows: totals.importedBasicMissingRows,
      formulaEntitlement: entitlement,
      thirteenthPaid: round2(totals.thirteenthPaid),
      difference: entitlement == null ? null : round2(totals.thirteenthPaid - entitlement),
      status: totals.importedBasicMissingRows > 0
        ? "incomplete-source-data"
        : totals.thirteenthPaid + 0.005 >= (entitlement ?? 0)
          ? "covered-by-recorded-payments"
          : "review-shortfall",
    };
  }).sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const remittanceRows = remittanceRowsAll.filter((batch) =>
    batch.applicableMonth.startsWith(`${taxYear}-`) || batch.status !== "reconciled"
  );
  const membersByBatch = new Map<number, typeof remittanceMemberRows>();
  for (const member of remittanceMemberRows) {
    membersByBatch.set(member.batchId, [...(membersByBatch.get(member.batchId) ?? []), member]);
  }
  const statutoryRemittances = remittanceRows.map((batch) => ({
    agency: batch.agency,
    applicableMonth: batch.applicableMonth,
    dueDate: String(batch.dueDate),
    status: batch.status,
    expectedEmployeeShare: Number(batch.expectedEmployeeShare),
    expectedEmployerShare: Number(batch.expectedEmployerShare),
    expectedTotal: Number(batch.expectedTotal),
    amountPaid: batch.amountPaid == null ? null : Number(batch.amountPaid),
    paymentReference: batch.paymentReference,
    agencyReceiptReference: batch.agencyReceiptReference,
    paymentChannel: batch.paymentChannel,
    paidAt: batch.paidAt ? new Date(batch.paidAt).toISOString() : null,
    reconciledAt: batch.reconciledAt ? new Date(batch.reconciledAt).toISOString() : null,
    snapshotHash: batch.snapshotHash,
    members: (membersByBatch.get(batch.id) ?? []).map((member) => ({
      employeeNo: member.employeeNo,
      totalContribution: Number(member.totalContribution),
      postingStatus: member.postingStatus,
      postingReference: member.postingReference,
      postedAt: member.postedAt ? new Date(member.postedAt).toISOString() : null,
      exceptionNote: member.exceptionNote,
    })),
  }));

  const separationRows = separationRowsAll.filter((row) =>
    String(row.lastDay).startsWith(`${taxYear}-`) || row.status !== "released"
  );
  const finalPay = separationRows.map((row) => {
    const employee = employeeById.get(row.employeeId);
    return {
      employeeNo: employee?.employeeNo ?? `#${row.employeeId}`,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
      separationType: row.separationType,
      noticeDate: String(row.noticeDate),
      lastDay: String(row.lastDay),
      finalPayDueDate: row.finalPayDueDate ? String(row.finalPayDueDate) : null,
      grossFinalPay: Number(row.grossFinalPay),
      netFinalPay: Number(row.netFinalPay),
      thirteenthEntitlement: Number(row.thirteenthEntitlement),
      thirteenthPaidYtd: Number(row.thirteenthPaidYtd),
      leaveMonetizationPay: Number(row.leaveMonetizationPay),
      separationPay: Number(row.separationPay),
      retirementPay: Number(row.retirementPay),
      taxAdjustment: Number(row.taxAdjustment),
      status: row.status,
      releaseReference: row.releaseReference,
      releasedAt: row.releasedAt ? new Date(row.releasedAt).toISOString() : null,
      coeIssued: row.coeIssued,
    };
  });

  const remediationRegister = remediationRows.map((row) => ({
    findingKey: row.findingKey,
    ruleCode: row.ruleCode,
    status: row.status,
    owner: row.owner,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt).toISOString() : null,
    resolutionNote: row.resolutionNote,
    evidenceReference: row.evidenceReference,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
  }));

  const activeFindings = readiness.findings.map((finding) => ({
    key: finding.key,
    ruleCode: finding.ruleCode,
    category: finding.category,
    severity: finding.severity,
    title: finding.title,
    employeeNo: finding.employeeNo ?? null,
    employeeName: finding.employeeName ?? null,
    periodLabel: finding.periodLabel ?? null,
    exposureAmount: finding.exposureAmount,
    exposureConfidence: finding.exposureConfidence,
    snapshotHash: finding.snapshotHash,
    owner: finding.remediation?.owner ?? finding.defaultOwner,
    remediationStatus: finding.remediation?.status ?? "untracked",
  }));

  return buildLaborInspectionEvidencePack({
    generatedAt: new Date().toISOString(),
    generatedBy: input.generatedBy,
    organization,
    range: {
      startDate,
      endDate,
      label: `Calendar year ${taxYear}`,
    },
    boundaries: {
      certification: "This evidence pack is generated from PayrollPH records for inspection preparation. It is not a DOLE certification, compliance order, or agency acceptance.",
      sensitiveData: "Raw bank account numbers, government ID/member numbers, IP addresses, device serials, geolocation and authentication data are intentionally excluded.",
      scope: "Payroll and general labor-standards evidence only. Occupational safety and health evidence is outside this package.",
    },
    sections: {
      workerRoster: evidenceSection("worker-roster", workerRoster),
      payrollRegister: evidenceSection("payroll-register", payrollRegister),
      timeRecords: evidenceSection("time-records", timeRecords),
      payslipIndex: evidenceSection("payslip-index", payslipIndex),
      thirteenthMonth: evidenceSection("13th-month", thirteenthMonth),
      statutoryRemittances: evidenceSection("statutory-remittances", statutoryRemittances),
      finalPay: evidenceSection("final-pay", finalPay),
      remediationRegister: evidenceSection("remediation-register", remediationRegister),
      activeFindings: evidenceSection("active-findings", activeFindings),
    },
  });
}
