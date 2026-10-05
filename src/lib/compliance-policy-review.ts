import { isValidPayInterval } from "@/lib/ph-compliance";

export type PolicyReviewSeverity = "high" | "medium" | "info" | "pass";
export type PolicyReviewFinding = {
  key: string;
  domain: "Pay frequency" | "Rest days" | "Leave" | "Pay profiles" | "Working time";
  severity: PolicyReviewSeverity;
  title: string;
  detail: string;
  governingRule: string;
  sourceLabel: string;
  sourceUrl: string;
  affectedEmployees?: number;
  affectedPatterns?: string[];
  remediation: string;
};

export type PolicyReviewInput = {
  payrollCalendarMode: string;
  releasedRuns: Array<{ id: number; periodLabel: string; periodStart: string; periodEnd: string; payDate: string }>;
  employees: Array<{ id: number; employeeNo: string; name: string; status: string; startDate: string; restDay: string | null }>;
  payProfiles: Array<{ employeeId: number; payBasis: string; standardHoursPerDay: number }>;
  leavePolicies: Array<{ leaveType: string; annualDays: number; payTreatment: string; paidPercentage: number; active: boolean }>;
  scheduleAssignments: Array<{ employeeId: number; patternId: number; effectiveFrom: string; effectiveUntil: string | null }>;
  patterns: Array<{ id: number; code: string; name: string; cycleDays: number; active: boolean }>;
  patternDays: Array<{ patternId: number; dayIndex: number; isRestDay: boolean }>;
  today: string;
};

const SOURCES = {
  payFrequency: { label: "DOLE general labor standards: payment of wages", url: "https://car.dole.gov.ph/news/what-to-know-about-general-labor-standards/" },
  restDay: { label: "DOLE workers basic rights: weekly rest day", url: "https://car.dole.gov.ph/news/the-workersae-basic-rights/" },
  laborCode: { label: "DOLE Labor Code Book III", url: "https://dole.gov.ph/book-3-conditions-of-employment/" },
} as const;

function dayNumber(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function isSeparated(status: string) {
  const value = status.toLowerCase();
  return value.includes("separat") || value.includes("resign") || value.includes("terminat");
}

export function patternProvidesWeeklyRest(cycleDays: number, days: Array<{ dayIndex: number; isRestDay: boolean }>) {
  if (!Number.isInteger(cycleDays) || cycleDays <= 0) return false;
  const rest = new Set(days.filter((d) => d.isRestDay).map((d) => d.dayIndex));
  if (rest.size === 0) return false;
  for (let start = 0; start < cycleDays; start += 1) {
    let hasRest = false;
    for (let offset = 0; offset < 7; offset += 1) {
      const idx = (start + offset) % cycleDays;
      if (rest.has(idx)) { hasRest = true; break; }
    }
    if (!hasRest) return false;
  }
  return true;
}

export function buildCompliancePolicyReview(input: PolicyReviewInput) {
  const findings: PolicyReviewFinding[] = [];
  const activeEmployees = input.employees.filter((employee) => !isSeparated(employee.status));
  const profilesByEmployee = new Map(input.payProfiles.map((profile) => [profile.employeeId, profile]));

  const invalidRuns = input.releasedRuns.filter((run) => !isValidPayInterval(run.periodStart, run.periodEnd, 16));
  if (invalidRuns.length > 0) {
    const run = invalidRuns[0];
    findings.push({
      key: "PAY_FREQUENCY_INTERVAL", domain: "Pay frequency", severity: "high",
      title: "Released payroll periods exceed the 16-day wage interval control",
      detail: invalidRuns.length + " released payroll run(s) span more than 16 calendar days. First affected run: " + run.periodLabel + " (" + run.periodStart + " to " + run.periodEnd + ").",
      governingRule: "Wages should be paid at least once every two weeks or twice a month at intervals not exceeding 16 days.",
      sourceLabel: SOURCES.payFrequency.label, sourceUrl: SOURCES.payFrequency.url,
      remediation: "Correct the payroll calendar before the next release and review whether any affected employees were paid late.",
    });
  } else {
    findings.push({
      key: "PAY_FREQUENCY_INTERVAL", domain: "Pay frequency", severity: "pass",
      title: "Released payroll periods stay within the 16-day interval control",
      detail: input.releasedRuns.length ? input.releasedRuns.length + " released payroll run(s) in the review window passed the interval check." : "No released payroll runs were available in the review window.",
      governingRule: "Wages should be paid at least once every two weeks or twice a month at intervals not exceeding 16 days.",
      sourceLabel: SOURCES.payFrequency.label, sourceUrl: SOURCES.payFrequency.url,
      remediation: input.payrollCalendarMode === "ph_semi_monthly" ? "Keep the semi-monthly calendar control enabled." : "Flexible mode is allowed operationally, but keep each payroll interval within 16 days.",
    });
  }

  const missingProfiles = activeEmployees.filter((employee) => !profilesByEmployee.has(employee.id));
  if (missingProfiles.length > 0) {
    findings.push({
      key: "PAY_PROFILE_COVERAGE", domain: "Pay profiles", severity: "high",
      title: "Active employees are missing payroll treatment profiles",
      detail: missingProfiles.length + " active employee(s) have no pay basis, rate assumptions or standard hours configuration.",
      governingRule: "Payroll records must support the wage basis and hours used to calculate pay.",
      sourceLabel: SOURCES.laborCode.label, sourceUrl: SOURCES.laborCode.url, affectedEmployees: missingProfiles.length,
      remediation: "Create and verify a pay profile for every active employee before payroll calculation.",
    });
  } else {
    findings.push({
      key: "PAY_PROFILE_COVERAGE", domain: "Pay profiles", severity: "pass",
      title: "Every active employee has a pay profile",
      detail: activeEmployees.length + " active employee(s) have configured pay basis and standard work assumptions.",
      governingRule: "Payroll records must support the wage basis and hours used to calculate pay.",
      sourceLabel: SOURCES.laborCode.label, sourceUrl: SOURCES.laborCode.url,
      remediation: "Keep pay revisions effective-dated and auditable.",
    });
  }

  const longStandardDays = input.payProfiles.filter((profile) => profile.standardHoursPerDay > 8.0001);
  if (longStandardDays.length > 0) {
    findings.push({
      key: "STANDARD_HOURS_REVIEW", domain: "Working time", severity: "medium",
      title: "Some standard workday settings exceed eight hours",
      detail: longStandardDays.length + " pay profile(s) configure more than eight standard hours per day. This can be valid under a lawful compressed workweek or excluded employee category, so the basis should be documented.",
      governingRule: "The normal hours of work generally shall not exceed eight hours a day, subject to statutory exclusions and lawful alternative work arrangements.",
      sourceLabel: SOURCES.laborCode.label, sourceUrl: SOURCES.laborCode.url, affectedEmployees: longStandardDays.length,
      remediation: "Document the lawful basis for the alternative schedule or correct the standard-hours configuration.",
    });
  }

  const assignmentsByEmployee = new Map<number, typeof input.scheduleAssignments>();
  for (const row of input.scheduleAssignments) assignmentsByEmployee.set(row.employeeId, [...(assignmentsByEmployee.get(row.employeeId) ?? []), row]);
  const patternById = new Map(input.patterns.map((pattern) => [pattern.id, pattern]));
  const patternDaysById = new Map<number, typeof input.patternDays>();
  for (const row of input.patternDays) patternDaysById.set(row.patternId, [...(patternDaysById.get(row.patternId) ?? []), row]);

  const employeesWithoutRestControl = activeEmployees.filter((employee) => {
    if (employee.restDay?.trim()) return false;
    const currentAssignments = (assignmentsByEmployee.get(employee.id) ?? []).filter((assignment) => assignment.effectiveFrom <= input.today && (!assignment.effectiveUntil || assignment.effectiveUntil >= input.today));
    return !currentAssignments.some((assignment) => {
      const pattern = patternById.get(assignment.patternId);
      return Boolean(pattern?.active && patternProvidesWeeklyRest(pattern.cycleDays, patternDaysById.get(pattern.id) ?? []));
    });
  });
  const riskyPatterns = input.patterns.filter((pattern) => pattern.active).filter((pattern) => !patternProvidesWeeklyRest(pattern.cycleDays, patternDaysById.get(pattern.id) ?? [])).map((pattern) => pattern.code + " · " + pattern.name);

  if (employeesWithoutRestControl.length > 0 || riskyPatterns.length > 0) {
    const details = [];
    if (employeesWithoutRestControl.length) details.push(employeesWithoutRestControl.length + " active employee(s) have neither a fixed rest day nor a current schedule pattern that proves weekly rest.");
    if (riskyPatterns.length) details.push(riskyPatterns.length + " active rotating schedule pattern(s) can produce a seven-day window without a configured rest day.");
    findings.push({
      key: "WEEKLY_REST_CONTROL", domain: "Rest days", severity: "medium",
      title: "Weekly rest-day coverage needs review", detail: details.join(" "),
      governingRule: "Employers should schedule a weekly rest period of at least 24 consecutive hours, subject to Labor Code rules and exceptions.",
      sourceLabel: SOURCES.restDay.label, sourceUrl: SOURCES.restDay.url,
      affectedEmployees: employeesWithoutRestControl.length || undefined, affectedPatterns: riskyPatterns.length ? riskyPatterns : undefined,
      remediation: "Configure a fixed rest day or revise the rotating schedule so every seven-day window contains a rest day, unless a documented lawful exception applies.",
    });
  } else {
    findings.push({
      key: "WEEKLY_REST_CONTROL", domain: "Rest days", severity: "pass",
      title: "Active employees have a weekly rest-day control",
      detail: "Each active employee has either a fixed rest day or a current rotating schedule that provides at least one rest day in every rolling seven-day window.",
      governingRule: "Employers should schedule a weekly rest period of at least 24 consecutive hours, subject to Labor Code rules and exceptions.",
      sourceLabel: SOURCES.restDay.label, sourceUrl: SOURCES.restDay.url,
      remediation: "Keep schedule changes effective-dated and review rest-day coverage when patterns change.",
    });
  }

  const unconfiguredLeave = input.leavePolicies.filter((policy) => policy.active && !["paid", "unpaid", "partial"].includes(policy.payTreatment.toLowerCase()));
  if (unconfiguredLeave.length > 0) {
    findings.push({
      key: "LEAVE_PAYROLL_TREATMENT", domain: "Leave", severity: "high",
      title: "Active leave policies have no payroll treatment",
      detail: unconfiguredLeave.length + " active leave policy/policies are not configured as paid, unpaid or partially paid.",
      governingRule: "Approved leave must have deterministic payroll treatment so wages are not guessed at calculation time.",
      sourceLabel: SOURCES.laborCode.label, sourceUrl: SOURCES.laborCode.url,
      remediation: "Set payroll treatment and paid percentage for every active leave policy.",
    });
  }

  const oneYearAgo = dayNumber(input.today) - 365;
  const oneYearEmployees = activeEmployees.filter((employee) => dayNumber(employee.startDate) <= oneYearAgo);
  const paidFiveDayPolicy = input.leavePolicies.some((policy) => policy.active && policy.payTreatment.toLowerCase() === "paid" && policy.annualDays >= 5);
  if (oneYearEmployees.length > 0 && !paidFiveDayPolicy) {
    findings.push({
      key: "SIL_POLICY_COVERAGE", domain: "Leave", severity: "medium",
      title: "Configured paid leave does not visibly cover the five-day SIL floor",
      detail: oneYearEmployees.length + " active employee(s) have at least one year of service, but no active paid leave policy provides at least five days. Article 95 includes exemptions and equivalent-benefit cases, so this is a policy-basis review rather than an automatic violation.",
      governingRule: "Article 95 generally grants five days of paid service incentive leave after one year of service, subject to stated exemptions and equivalent paid-leave benefits.",
      sourceLabel: SOURCES.laborCode.label, sourceUrl: SOURCES.laborCode.url, affectedEmployees: oneYearEmployees.length,
      remediation: "Configure the qualifying paid leave benefit or document the employer/employee exemption or equivalent-benefit basis.",
    });
  } else if (oneYearEmployees.length > 0) {
    findings.push({
      key: "SIL_POLICY_COVERAGE", domain: "Leave", severity: "pass",
      title: "Configured paid leave visibly covers the five-day SIL floor",
      detail: "At least one active paid leave policy provides five or more days for employees with at least one year of service.",
      governingRule: "Article 95 generally grants five days of paid service incentive leave after one year of service, subject to stated exemptions and equivalent paid-leave benefits.",
      sourceLabel: SOURCES.laborCode.label, sourceUrl: SOURCES.laborCode.url,
      remediation: "Keep employee coverage and any exemptions documented.",
    });
  }

  const summary = {
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    pass: findings.filter((finding) => finding.severity === "pass").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };
  return { findings, summary };
}
