import { createHash } from "node:crypto";
import { finalPayDueDate, readBasicAndThirteenth } from "@/lib/final-pay";
import { isBelowMinimum, WAGE_ORDERS } from "@/lib/wage-orders";

export type InspectionSeverity = "high" | "medium" | "info";
export type InspectionCategory =
  | "Payroll records"
  | "Time records"
  | "Wages"
  | "13th month"
  | "Leave"
  | "Final pay"
  | "Statutory remittance";

export type ExposureConfidence = "recorded-liability" | "screening-estimate" | null;

export type LaborInspectionFinding = {
  key: string;
  ruleCode: string;
  category: InspectionCategory;
  severity: InspectionSeverity;
  title: string;
  detail: string;
  employeeId?: number;
  employeeNo?: string;
  employeeName?: string;
  payrollRunId?: number;
  periodLabel?: string;
  exposureAmount: number | null;
  exposureConfidence: ExposureConfidence;
  governingRule: string;
  sourceLabel: string;
  sourceUrl: string;
  evidenceRequired: string[];
  remediationHint: string;
  defaultOwner: "Payroll" | "People Ops" | "Finance" | "Compliance";
  snapshotHash: string;
};

export type InspectionEmployee = {
  id: number;
  employeeNo: string;
  name: string;
  title: string;
  status: string;
  startDate: string;
  region: string;
  mwe: boolean;
  basicRate: number;
  restDay: string | null;
};

export type InspectionPayProfile = {
  employeeId: number;
  payBasis: string;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
};

export type InspectionPayrollRun = {
  id: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  employeeCount: number;
};

export type InspectionPayrollEntry = {
  id: number;
  payrollRunId: number;
  employeeId: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  status: string;
  lineItems: unknown;
  trace: unknown;
};

export type InspectionHistoricalEntry = {
  employeeId: number;
  payDate: string;
  basicSalary: number | null;
  thirteenthMonth: number;
};

export type InspectionRemittanceBatch = {
  id: number;
  agency: "SSS" | "PhilHealth" | "Pag-IBIG";
  applicableMonth: string;
  dueDate: string;
  status: string;
  expectedTotal: number;
  amountPaid: number | null;
};

export type InspectionRemittanceMember = {
  id: number;
  batchId: number;
  employeeId: number;
  employeeNo: string;
  totalContribution: number;
  postingStatus: string;
  exceptionNote: string | null;
};

export type InspectionSeparation = {
  id: number;
  employeeId: number;
  lastDay: string;
  finalPayDueDate: string | null;
  status: string;
  netFinalPay: number;
  coeIssued: boolean;
  releaseReference: string | null;
};

export type InspectionLeavePolicy = {
  leaveType: string;
  annualDays: number;
  payTreatment: string;
  active: boolean;
};

export type InspectionInput = {
  today: string;
  taxYear: number;
  startDate: string;
  endDate: string;
  employees: InspectionEmployee[];
  payProfiles: InspectionPayProfile[];
  runs: InspectionPayrollRun[];
  entries: InspectionPayrollEntry[];
  payslipEntryIds: number[];
  historicalEntries: InspectionHistoricalEntry[];
  remittanceBatches: InspectionRemittanceBatch[];
  remittanceMembers: InspectionRemittanceMember[];
  separations: InspectionSeparation[];
  leavePolicies: InspectionLeavePolicy[];
};

const SOURCES = {
  inspection: {
    label: "DOLE Labor Inspection Program document checklist",
    url: "https://car.dole.gov.ph/news/labor-inspection-program/",
  },
  inspectionProcess: {
    label: "DOLE Bureau of Working Conditions: Labor Inspection",
    url: "https://bwc.dole.gov.ph/ensuring-compliance-and-safeguarding-workers-insights-on-labor-inspection/",
  },
  wages: {
    label: "NWPC current regional wage orders",
    url: "https://nwpc.dole.gov.ph/",
  },
  handbook: {
    label: "DOLE Labor Code Book III, Article 95",
    url: "https://dole.gov.ph/book-3-conditions-of-employment/",
  },
  thirteenth: {
    label: "Memorandum Order No. 28 amending P.D. 851",
    url: "https://lawphil.net/executive/mo/mo1986/mo_28_1986.html",
  },
  finalPay: {
    label: "DOLE final pay and COE reminder, January 2026",
    url: "https://dole.gov.ph/news/final-pay-coe-must-be-released-on-time-dole/",
  },
} as const;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function addFinding(
  target: LaborInspectionFinding[],
  finding: Omit<LaborInspectionFinding, "snapshotHash">,
) {
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify({
      key: finding.key,
      ruleCode: finding.ruleCode,
      severity: finding.severity,
      detail: finding.detail,
      exposureAmount: finding.exposureAmount,
      exposureConfidence: finding.exposureConfidence,
      evidenceRequired: finding.evidenceRequired,
    }))
    .digest("hex");

  target.push({ ...finding, snapshotHash });
}

function traceNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return null;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return null;
  const prefix = `${key}=`;
  const row = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  if (typeof row !== "string") return null;
  const value = Number(row.slice(prefix.length));
  return Number.isFinite(value) ? value : null;
}

function traceFlags(trace: unknown) {
  if (!trace || typeof trace !== "object") return [] as string[];
  const flags = (trace as { flags?: unknown }).flags;
  return Array.isArray(flags) ? flags.filter((item): item is string => typeof item === "string") : [];
}

function isSeparated(status: string) {
  const value = status.toLowerCase();
  return value.includes("separat") || value.includes("resign") || value.includes("terminat");
}

export function buildLaborInspectionFindings(input: InspectionInput) {
  const findings: LaborInspectionFinding[] = [];
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const profileByEmployee = new Map(input.payProfiles.map((profile) => [profile.employeeId, profile]));
  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const payslipIds = new Set(input.payslipEntryIds);

  for (const employee of input.employees.filter((row) => !isSeparated(row.status))) {
    const profile = profileByEmployee.get(employee.id);
    if (!profile) {
      addFinding(findings, {
        key: `PAY_PROFILE_MISSING:employee:${employee.id}`,
        ruleCode: "PAY_PROFILE_MISSING",
        category: "Payroll records",
        severity: "high",
        title: "Employee wage basis is not fully documented",
        detail: `${employee.employeeNo} · ${employee.name} has no pay profile describing pay basis, rate and standard work assumptions.`,
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: employee.name,
        exposureAmount: null,
        exposureConfidence: null,
        governingRule: "DOLE inspection preparation includes the worker roster, designation, date hired and wage rate.",
        sourceLabel: SOURCES.inspection.label,
        sourceUrl: SOURCES.inspection.url,
        evidenceRequired: ["Employee pay profile", "Current wage rate", "Pay basis and standard work schedule"],
        remediationHint: "Create and verify the employee pay profile before the next payroll inspection export.",
        defaultOwner: "People Ops",
      });
      continue;
    }

    const wageRegionKnown = WAGE_ORDERS.some((row) => row.region === employee.region);
    if (!wageRegionKnown) {
      addFinding(findings, {
        key: `WAGE_REGION_UNMAPPED:employee:${employee.id}`,
        ruleCode: "WAGE_REGION_UNMAPPED",
        category: "Wages",
        severity: "high",
        title: "Employee wage jurisdiction is not mapped",
        detail: `${employee.employeeNo} · ${employee.name} has region "${employee.region || "blank"}", which is not mapped to the verified NWPC wage registry. PayrollPH will not substitute NCR or another region for inspection screening.`,
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: employee.name,
        exposureAmount: null,
        exposureConfidence: null,
        governingRule: "Minimum-wage review must use the employee's actual applicable regional wage order and category.",
        sourceLabel: SOURCES.wages.label,
        sourceUrl: SOURCES.wages.url,
        evidenceRequired: ["Actual worksite/region", "Applicable wage order and establishment category"],
        remediationHint: "Correct the employee work region before relying on wage-floor screening.",
        defaultOwner: "People Ops",
      });
      continue;
    }

    const monthlyEquivalent =
      profile.payBasis === "monthly"
        ? profile.rateAmount
        : profile.payBasis === "daily"
          ? profile.rateAmount * profile.standardWorkDaysPerMonth
          : profile.payBasis === "hourly"
            ? profile.rateAmount * profile.standardHoursPerDay * profile.standardWorkDaysPerMonth
            : employee.basicRate;

    const wage = isBelowMinimum(
      monthlyEquivalent,
      employee.region || "NCR",
      profile.standardWorkDaysPerMonth || 22,
    );
    if (wage.below) {
      addFinding(findings, {
        key: `WAGE_FLOOR_SCREEN:employee:${employee.id}`,
        ruleCode: "WAGE_FLOOR_SCREEN",
        category: "Wages",
        severity: "medium",
        title: "Configured rate falls below the regional screening reference",
        detail: `${employee.employeeNo} · ${employee.name} implies about ₱${wage.impliedDaily.toFixed(2)}/day versus the stored ${wage.order.wageOrder} high-tier screening rate of ₱${wage.order.dailyRate.toFixed(2)}/day for ${wage.order.region}. Exact legal exposure depends on the employer's wage category, establishment size, location and exemptions, so PayrollPH does not label this an underpayment automatically.`,
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: employee.name,
        exposureAmount: null,
        exposureConfidence: null,
        governingRule: `${wage.order.wageOrder} regional minimum-wage screening reference; exact applicable tier must be confirmed.`,
        sourceLabel: SOURCES.wages.label,
        sourceUrl: SOURCES.wages.url,
        evidenceRequired: ["Applicable wage-order category", "Worksite/location", "Employee wage rate and pay basis"],
        remediationHint: "Confirm the exact regional wage tier and update the employee rate if the configured rate is below the applicable minimum.",
        defaultOwner: "People Ops",
      });
    }
  }

  const releasedRuns = input.runs.filter((run) => run.status === "Released");
  const entriesByRun = new Map<number, InspectionPayrollEntry[]>();
  for (const entry of input.entries) {
    entriesByRun.set(entry.payrollRunId, [...(entriesByRun.get(entry.payrollRunId) ?? []), entry]);
  }

  for (const run of releasedRuns) {
    const rows = entriesByRun.get(run.id) ?? [];
    if (rows.length !== run.employeeCount) {
      addFinding(findings, {
        key: `PAYROLL_REGISTER_GAP:run:${run.id}`,
        ruleCode: "PAYROLL_REGISTER_GAP",
        category: "Payroll records",
        severity: "high",
        title: "Released payroll register is incomplete",
        detail: `${run.periodLabel} records ${run.employeeCount} employee(s), but only ${rows.length} payroll entr${rows.length === 1 ? "y is" : "ies are"} stored.`,
        payrollRunId: run.id,
        periodLabel: run.periodLabel,
        exposureAmount: null,
        exposureConfidence: null,
        governingRule: "DOLE inspection preparation includes payrolls and/or vouchers for inspection.",
        sourceLabel: SOURCES.inspection.label,
        sourceUrl: SOURCES.inspection.url,
        evidenceRequired: ["Complete payroll register", "Release approval/audit trail"],
        remediationHint: "Reconcile the released run against its employee population and restore the missing payroll evidence.",
        defaultOwner: "Payroll",
      });
    }

    for (const entry of rows) {
      const employee = employeeById.get(entry.employeeId);
      const identity = employee
        ? `${employee.employeeNo} · ${employee.name}`
        : `Employee #${entry.employeeId}`;

      if (!payslipIds.has(entry.id)) {
        addFinding(findings, {
          key: `PAYSLIP_MISSING:run:${run.id}:employee:${entry.employeeId}`,
          ruleCode: "PAYSLIP_MISSING",
          category: "Payroll records",
          severity: "high",
          title: "Released payroll has no stored payslip",
          detail: `${identity} has a released payroll entry for ${run.periodLabel}, but no payslip record is stored for that exact entry.`,
          employeeId: entry.employeeId,
          employeeNo: employee?.employeeNo,
          employeeName: employee?.name,
          payrollRunId: run.id,
          periodLabel: run.periodLabel,
          exposureAmount: null,
          exposureConfidence: null,
          governingRule: "DOLE inspection preparation expressly lists payslips among records employers should prepare.",
          sourceLabel: SOURCES.inspection.label,
          sourceUrl: SOURCES.inspection.url,
          evidenceRequired: ["Payslip for the released payroll entry"],
          remediationHint: "Restore or regenerate the payslip from the released immutable payroll entry without altering the released calculation.",
          defaultOwner: "Payroll",
        });
      }

      const punches = traceNumber(entry.trace, "punches");
      if (entry.grossPay > 0 && punches === 0) {
        addFinding(findings, {
          key: `TIME_RECORD_GAP:run:${run.id}:employee:${entry.employeeId}`,
          ruleCode: "TIME_RECORD_GAP",
          category: "Time records",
          severity: "medium",
          title: "Paid payroll entry has no recorded attendance punches",
          detail: `${identity} has positive gross pay for ${run.periodLabel} but the payroll trace records zero attendance punches. Paid leave or fixed monthly salary can explain this, so this is an evidence gap until the DTR/leave basis is linked.`,
          employeeId: entry.employeeId,
          employeeNo: employee?.employeeNo,
          employeeName: employee?.name,
          payrollRunId: run.id,
          periodLabel: run.periodLabel,
          exposureAmount: null,
          exposureConfidence: null,
          governingRule: "DOLE inspection preparation includes Daily Time Records and/or time sheets.",
          sourceLabel: SOURCES.inspection.label,
          sourceUrl: SOURCES.inspection.url,
          evidenceRequired: ["DTR/time sheet or paid-leave basis", "Payroll trace for the cutoff"],
          remediationHint: "Link the attendance or paid-leave evidence that supports the payroll entry.",
          defaultOwner: "Payroll",
        });
      }

      const flags = traceFlags(entry.trace);
      if (entry.status === "Exception" || flags.length > 0) {
        addFinding(findings, {
          key: `RELEASED_ENGINE_EXCEPTION:run:${run.id}:employee:${entry.employeeId}`,
          ruleCode: "RELEASED_ENGINE_EXCEPTION",
          category: "Payroll records",
          severity: "high",
          title: "Released payroll still carries a calculation exception",
          detail: `${identity} was released with a payroll exception or trace flag. First recorded flag: ${flags[0] ?? entry.status}.`,
          employeeId: entry.employeeId,
          employeeNo: employee?.employeeNo,
          employeeName: employee?.name,
          payrollRunId: run.id,
          periodLabel: run.periodLabel,
          exposureAmount: null,
          exposureConfidence: null,
          governingRule: "Payroll and time records should support the wages actually paid; unresolved calculation exceptions weaken inspection evidence.",
          sourceLabel: SOURCES.inspectionProcess.label,
          sourceUrl: SOURCES.inspectionProcess.url,
          evidenceRequired: ["Exception review", "Corrected payroll or documented reviewer disposition"],
          remediationHint: "Reconcile the flagged condition and document why the released amount is correct or process an audited correction.",
          defaultOwner: "Payroll",
        });
      }
    }
  }

  const remittanceMembersByBatch = new Map<number, InspectionRemittanceMember[]>();
  for (const member of input.remittanceMembers) {
    remittanceMembersByBatch.set(member.batchId, [...(remittanceMembersByBatch.get(member.batchId) ?? []), member]);
  }
  for (const batch of input.remittanceBatches) {
    const overdue = dayNumber(batch.dueDate) < dayNumber(input.today);
    if (overdue && batch.status !== "reconciled") {
      addFinding(findings, {
        key: `STATUTORY_REMITTANCE_OVERDUE:batch:${batch.id}`,
        ruleCode: "STATUTORY_REMITTANCE_OVERDUE",
        category: "Statutory remittance",
        severity: "high",
        title: `${batch.agency} remittance is past due without full reconciliation`,
        detail: `${batch.agency} for ${batch.applicableMonth} was due ${batch.dueDate}. PayrollPH records an expected liability of ₱${batch.expectedTotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} and status "${batch.status}".`,
        exposureAmount: round2(Math.max(0, batch.expectedTotal - Math.max(0, batch.amountPaid ?? 0))),
        exposureConfidence: "recorded-liability",
        governingRule: "DOLE inspection preparation includes proof of SSS, PhilHealth and Pag-IBIG contribution payment/remittance.",
        sourceLabel: SOURCES.inspection.label,
        sourceUrl: SOURCES.inspection.url,
        evidenceRequired: ["Payment reference", "Agency acknowledgement", "Employee-level posting reconciliation"],
        remediationHint: "Complete the remittance, retain agency evidence, and reconcile member posting in the Statutory Remittance Control.",
        defaultOwner: "Finance",
      });
    }

    for (const member of remittanceMembersByBatch.get(batch.id) ?? []) {
      if (member.postingStatus !== "exception") continue;
      const employee = employeeById.get(member.employeeId);
      addFinding(findings, {
        key: `STATUTORY_POSTING_EXCEPTION:batch:${batch.id}:employee:${member.employeeId}`,
        ruleCode: "STATUTORY_POSTING_EXCEPTION",
        category: "Statutory remittance",
        severity: "high",
        title: `${batch.agency} contribution has an employee posting exception`,
        detail: `${employee?.employeeNo ?? member.employeeNo} · ${employee?.name ?? "Employee"} has ₱${member.totalContribution.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${batch.applicableMonth} marked as an agency posting exception${member.exceptionNote ? `: ${member.exceptionNote}` : "."}`,
        employeeId: member.employeeId,
        employeeNo: employee?.employeeNo ?? member.employeeNo,
        employeeName: employee?.name,
        exposureAmount: round2(member.totalContribution),
        exposureConfidence: "recorded-liability",
        governingRule: "DOLE inspection preparation includes proof of mandatory contribution payment/remittance; employee-level posting evidence supports that withheld contributions reached the member record.",
        sourceLabel: SOURCES.inspection.label,
        sourceUrl: SOURCES.inspection.url,
        evidenceRequired: ["Agency member posting record", "Correction/reference for the affected employee"],
        remediationHint: "Resolve the agency posting exception and record the corrected member reference.",
        defaultOwner: "Finance",
      });
    }
  }

  for (const separation of input.separations) {
    const employee = employeeById.get(separation.employeeId);
    const dueDate = separation.finalPayDueDate || finalPayDueDate(separation.lastDay);
    if (dayNumber(dueDate) < dayNumber(input.today) && separation.status !== "released") {
      addFinding(findings, {
        key: `FINAL_PAY_OVERDUE:separation:${separation.id}`,
        ruleCode: "FINAL_PAY_OVERDUE",
        category: "Final pay",
        severity: "high",
        title: "Final pay is beyond the 30-day release target",
        detail: `${employee?.employeeNo ?? `Employee #${separation.employeeId}`} · ${employee?.name ?? "Separated employee"} left on ${separation.lastDay}. The recorded final-pay due date is ${dueDate}, but status is "${separation.status}".`,
        employeeId: separation.employeeId,
        employeeNo: employee?.employeeNo,
        employeeName: employee?.name,
        exposureAmount: round2(Math.max(0, separation.netFinalPay)),
        exposureConfidence: "recorded-liability",
        governingRule: "Labor Advisory No. 06, Series of 2020: final pay should generally be released within 30 days from separation unless a more favorable company policy applies.",
        sourceLabel: SOURCES.finalPay.label,
        sourceUrl: SOURCES.finalPay.url,
        evidenceRequired: ["Final-pay computation", "Release/payment reference", "Employee acknowledgement where available"],
        remediationHint: "Release the final pay or document the lawful reason and settlement evidence immediately.",
        defaultOwner: "Payroll",
      });
    }

    if (separation.status === "released" && !separation.releaseReference?.trim()) {
      addFinding(findings, {
        key: `FINAL_PAY_RELEASE_REFERENCE_MISSING:separation:${separation.id}`,
        ruleCode: "FINAL_PAY_RELEASE_REFERENCE_MISSING",
        category: "Final pay",
        severity: "medium",
        title: "Final pay is marked released without a payment reference",
        detail: `${employee?.employeeNo ?? `Employee #${separation.employeeId}`} · ${employee?.name ?? "Separated employee"} is marked released, but PayrollPH has no release/payment reference to show an inspector.`,
        employeeId: separation.employeeId,
        employeeNo: employee?.employeeNo,
        employeeName: employee?.name,
        exposureAmount: null,
        exposureConfidence: null,
        governingRule: "Final-pay readiness requires evidence that the computed amount was actually released.",
        sourceLabel: SOURCES.finalPay.label,
        sourceUrl: SOURCES.finalPay.url,
        evidenceRequired: ["Bank/payment reference or signed settlement acknowledgement"],
        remediationHint: "Attach or record the payment reference without altering the final-pay computation.",
        defaultOwner: "Payroll",
      });
    }

    if (!separation.coeIssued) {
      addFinding(findings, {
        key: `COE_EVIDENCE_MISSING:separation:${separation.id}`,
        ruleCode: "COE_EVIDENCE_MISSING",
        category: "Final pay",
        severity: "info",
        title: "No Certificate of Employment issuance is recorded",
        detail: `${employee?.employeeNo ?? `Employee #${separation.employeeId}`} · ${employee?.name ?? "Separated employee"} has no COE issuance recorded. PayrollPH does not currently store the employee's COE request date, so this is an inspection-readiness evidence gap, not an automatic late-COE finding.`,
        employeeId: separation.employeeId,
        employeeNo: employee?.employeeNo,
        employeeName: employee?.name,
        exposureAmount: null,
        exposureConfidence: null,
        governingRule: "Labor Advisory No. 06, Series of 2020 requires a Certificate of Employment to be issued within three days from the employee's request.",
        sourceLabel: SOURCES.finalPay.label,
        sourceUrl: SOURCES.finalPay.url,
        evidenceRequired: ["COE copy and issue date", "COE request date if timeliness must be proven"],
        remediationHint: "Record COE issuance and retain the request/issue dates where the employee requested one.",
        defaultOwner: "People Ops",
      });
    }
  }

  const oneYearAgo = new Date(`${input.today}T00:00:00Z`);
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const hasPotentialSilCoverage = input.leavePolicies.some((policy) =>
    policy.active
    && policy.payTreatment === "paid"
    && policy.annualDays >= 5
  );
  const longServiceEmployees = input.employees.filter((employee) =>
    !isSeparated(employee.status)
    && new Date(`${employee.startDate}T00:00:00Z`) <= oneYearAgo
  );
  if (longServiceEmployees.length > 0 && !hasPotentialSilCoverage) {
    addFinding(findings, {
      key: "SIL_POLICY_REVIEW",
      ruleCode: "SIL_POLICY_REVIEW",
      category: "Leave",
      severity: "medium",
      title: "No paid-leave policy visibly covers the five-day SIL floor",
      detail: `${longServiceEmployees.length} active employee(s) have at least one year of service, but PayrollPH has no active paid leave policy with at least five days. Statutory exemptions and equivalent company leave can change the result, so this is a policy review finding rather than an automatic liability.`,
      exposureAmount: null,
      exposureConfidence: null,
      governingRule: "Service Incentive Leave generally provides five days with pay after one year of service, subject to statutory exemptions and equivalent benefits.",
      sourceLabel: SOURCES.handbook.label,
      sourceUrl: SOURCES.handbook.url,
      evidenceRequired: ["Leave policy", "Employee coverage/exemption basis", "Leave balance/usage records"],
      remediationHint: "Confirm SIL coverage or the applicable exemption/equivalent leave benefit and configure the policy in PayrollPH.",
      defaultOwner: "People Ops",
    });
  }

  if (input.today >= `${input.taxYear}-12-24`) {
    const ytd = new Map<number, { basic: number; thirteenthPaid: number }>();
    for (const entry of input.entries) {
      const run = runById.get(entry.payrollRunId);
      if (!run || run.status !== "Released" || !String(run.payDate).startsWith(`${input.taxYear}-`)) continue;
      const parsed = readBasicAndThirteenth(entry.lineItems);
      const bucket = ytd.get(entry.employeeId) ?? { basic: 0, thirteenthPaid: 0 };
      bucket.basic += parsed.basic;
      bucket.thirteenthPaid += parsed.thirteenthPaid;
      ytd.set(entry.employeeId, bucket);
    }
    for (const history of input.historicalEntries) {
      if (!history.payDate.startsWith(`${input.taxYear}-`)) continue;
      const bucket = ytd.get(history.employeeId) ?? { basic: 0, thirteenthPaid: 0 };
      bucket.basic += Math.max(0, history.basicSalary ?? 0);
      bucket.thirteenthPaid += Math.max(0, history.thirteenthMonth);
      ytd.set(history.employeeId, bucket);
    }

    for (const [employeeId, totals] of ytd) {
      const entitlement = round2(Math.max(0, totals.basic) / 12);
      const shortfall = round2(Math.max(0, entitlement - Math.max(0, totals.thirteenthPaid)));
      if (shortfall < 0.01) continue;
      const employee = employeeById.get(employeeId);
      addFinding(findings, {
        key: `THIRTEENTH_MONTH_SCREEN:employee:${employeeId}:year:${input.taxYear}`,
        ruleCode: "THIRTEENTH_MONTH_SCREEN",
        category: "13th month",
        severity: "high",
        title: "Recorded 13th-month pay is below the basic-salary formula after December 24",
        detail: `${employee?.employeeNo ?? `Employee #${employeeId}`} · ${employee?.name ?? "Employee"} has ₱${totals.basic.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded basic salary for ${input.taxYear}, implying ₱${entitlement.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} under the 1/12 formula, while PayrollPH finds ₱${totals.thirteenthPaid.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid. Confirm rank-and-file coverage and any qualifying equivalent benefit before treating the ₱${shortfall.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} as a final liability.`,
        employeeId,
        employeeNo: employee?.employeeNo,
        employeeName: employee?.name,
        exposureAmount: shortfall,
        exposureConfidence: "screening-estimate",
        governingRule: "P.D. 851 as amended requires 13th-month pay for covered rank-and-file employees not later than December 24; the statutory formula is generally one-twelfth of basic salary earned.",
        sourceLabel: SOURCES.thirteenth.label,
        sourceUrl: SOURCES.thirteenth.url,
        evidenceRequired: ["Calendar-year basic salary record", "13th-month payment proof", "Coverage/exemption or equivalent-benefit basis if applicable"],
        remediationHint: "Reconcile the 13th-month computation, confirm coverage, and pay/document any verified shortfall.",
        defaultOwner: "Payroll",
      });
    }
  }

  const categoryRank: Record<InspectionSeverity, number> = { high: 0, medium: 1, info: 2 };
  findings.sort((a, b) =>
    categoryRank[a.severity] - categoryRank[b.severity]
    || (b.exposureAmount ?? 0) - (a.exposureAmount ?? 0)
    || a.key.localeCompare(b.key)
  );

  const affectedEmployees = new Set(findings.flatMap((finding) => finding.employeeId ? [finding.employeeId] : []));
  const recordedExposure = round2(findings.reduce(
    (sum, finding) => sum + (finding.exposureConfidence === "recorded-liability" ? finding.exposureAmount ?? 0 : 0),
    0,
  ));
  const screeningExposure = round2(findings.reduce(
    (sum, finding) => sum + (finding.exposureConfidence === "screening-estimate" ? finding.exposureAmount ?? 0 : 0),
    0,
  ));

  return {
    findings,
    summary: {
      high: findings.filter((finding) => finding.severity === "high").length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      info: findings.filter((finding) => finding.severity === "info").length,
      affectedEmployees: affectedEmployees.size,
      recordedExposure,
      screeningExposure,
    },
    inspectionEvidence: [
      "Worker roster, designation, hire date and wage rate",
      "Payroll registers and/or vouchers",
      "Daily Time Records and/or time sheets",
      "Payslips",
      "13th-month and service-incentive-leave proof",
      "SSS, PhilHealth and Pag-IBIG remittance proof",
      "Final-pay and COE records for separated employees",
    ],
  };
}
