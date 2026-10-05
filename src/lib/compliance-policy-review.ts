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

const LABOR_CODE_URL = "https://dole.gov.ph/book-3-conditions-of-employment/";
const SOURCES = {
  payFrequency: { label: "DOLE Labor Code Book III, Article 103", url: LABOR_CODE_URL },
  restDay: { label: "DOLE Labor Code Book III, weekly rest period rules", url: LABOR_CODE_URL },
  laborCode: { label: "DOLE Labor Code Book III", url: LABOR_CODE_URL },
} as const;

function dayNumber(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function daysBetween(a: string, b: string) {
  return dayNumber(b) - dayNumber(a);
}

function isSeparated(status: string) {
  const value = status.toLowerCase();
  return value.includes("separat") || value.includes("resign") || value.includes("terminat");
}

function currentAssignmentsFor(
  employeeId: number,
  assignments: PolicyReviewInput["scheduleAssignments"],
  today: string,
) {
  return assignments.filter((assignment) =>
    assignment.employeeId === employeeId
    && assignment.effectiveFrom <= today
    && (!assignment.effectiveUntil || assignment.effectiveUntil >= today)
  );
}

export function patternProvidesWeeklyRest(
  cycleDays: number,
  days: Array<{ dayIndex: number; isRestDay: boolean }>,
) {
  if (!Number.isInteger(cycleDays) || cycleDays <= 0) return false;
  const rest = new Set(days.filter((day) => day.isRestDay).map((day) => day.dayIndex));
  if (rest.size === 0) return false;

  for (let start = 0; start < cycleDays; start += 1) {
    let hasRest = false;
    for (let offset = 0; offset < 7; offset += 1) {
      if (rest.has((start + offset) % cycleDays)) {
        hasRest = true;
        break;
      }
    }
    if (!hasRest) return false;
  }
  return true;
}

export function buildCompliancePolicyReview(input: PolicyReviewInput) {
  const findings: PolicyReviewFinding[] = [];
  const activeEmployees = input.employees.filter((employee) => !isSeparated(employee.status));
  const profilesByEmployee = new Map(input.payProfiles.map((profile) => [profile.employeeId, profile]));

  const orderedRuns = [...input.releasedRuns].sort(
    (a, b) => a.payDate.localeCompare(b.payDate) || a.id - b.id,
  );
  const invalidCoverageRuns = orderedRuns.filter(
    (run) => !isValidPayInterval(run.periodStart, run.periodEnd, 16),
  );
  const excessivePayDateGaps = orderedRuns.slice(1).map((run, index) => ({
    previous: orderedRuns[index],
    current: run,
    days: daysBetween(orderedRuns[index].payDate, run.payDate),
  })).filter((gap) => gap.days > 16);

  if (invalidCoverageRuns.length > 0 || excessivePayDateGaps.length > 0) {
    const details: string[] = [];
    if (invalidCoverageRuns.length > 0) {
      const run = invalidCoverageRuns[0];
      details.push(
        `${invalidCoverageRuns.length} released payroll run(s) cover more than 16 calendar days. First: ${run.periodLabel} (${run.periodStart} to ${run.periodEnd}).`,
      );
    }
    if (excessivePayDateGaps.length > 0) {
      const gap = excessivePayDateGaps[0];
      details.push(
        `${excessivePayDateGaps.length} gap(s) between actual released pay dates exceed 16 days. First: ${gap.previous.payDate} to ${gap.current.payDate} (${gap.days} days).`,
      );
    }
    findings.push({
      key: "PAY_FREQUENCY_INTERVAL",
      domain: "Pay frequency",
      severity: "high",
      title: "Released payroll timing exceeds the 16-day wage-payment control",
      detail: details.join(" "),
      governingRule: "Article 103 requires wages to be paid at least once every two weeks or twice a month at intervals not exceeding 16 days, subject to stated exceptional circumstances.",
      sourceLabel: SOURCES.payFrequency.label,
      sourceUrl: SOURCES.payFrequency.url,
      remediation: "Correct the payroll calendar and investigate any actual pay-date gap above 16 days before the next release.",
    });
  } else {
    findings.push({
      key: "PAY_FREQUENCY_INTERVAL",
      domain: "Pay frequency",
      severity: "pass",
      title: "Released payroll timing stays within the 16-day control",
      detail: orderedRuns.length
        ? `${orderedRuns.length} released payroll run(s) in the review window passed both payroll-period and actual pay-date interval checks.`
        : "No released payroll runs were available in the review window.",
      governingRule: "Article 103 requires wages to be paid at least once every two weeks or twice a month at intervals not exceeding 16 days, subject to stated exceptional circumstances.",
      sourceLabel: SOURCES.payFrequency.label,
      sourceUrl: SOURCES.payFrequency.url,
      remediation: input.payrollCalendarMode === "ph_semi_monthly"
        ? "Keep the semi-monthly calendar control enabled and review exceptions before release."
        : "Flexible mode remains operationally available, but every actual wage-payment interval must stay within the legal control unless a documented exception applies.",
    });
  }

  const missingProfiles = activeEmployees.filter((employee) => !profilesByEmployee.has(employee.id));
  if (missingProfiles.length > 0) {
    findings.push({
      key: "PAY_PROFILE_COVERAGE",
      domain: "Pay profiles",
      severity: "high",
      title: "Active employees are missing payroll treatment profiles",
      detail: `${missingProfiles.length} active employee(s) have no pay basis, rate assumptions or standard hours configuration.`,
      governingRule: "Payroll records must support the wage basis and hours used to calculate pay.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      affectedEmployees: missingProfiles.length,
      remediation: "Create and verify a pay profile for every active employee before payroll calculation.",
    });
  } else {
    findings.push({
      key: "PAY_PROFILE_COVERAGE",
      domain: "Pay profiles",
      severity: "pass",
      title: "Every active employee has a pay profile",
      detail: `${activeEmployees.length} active employee(s) have configured pay basis and standard work assumptions.`,
      governingRule: "Payroll records must support the wage basis and hours used to calculate pay.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      remediation: "Keep pay revisions effective-dated and auditable.",
    });
  }

  const longStandardDays = input.payProfiles.filter((profile) => profile.standardHoursPerDay > 8.0001);
  if (longStandardDays.length > 0) {
    findings.push({
      key: "STANDARD_HOURS_REVIEW",
      domain: "Working time",
      severity: "medium",
      title: "Some standard workday settings exceed eight hours",
      detail: `${longStandardDays.length} pay profile(s) configure more than eight standard hours per day. This can be valid under a lawful compressed workweek or excluded employee category, so the basis should be documented.`,
      governingRule: "Normal hours of work generally shall not exceed eight hours a day, subject to statutory exclusions and lawful alternative work arrangements.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      affectedEmployees: longStandardDays.length,
      remediation: "Document the lawful basis for the alternative schedule or correct the standard-hours configuration.",
    });
  } else {
    findings.push({
      key: "STANDARD_HOURS_REVIEW",
      domain: "Working time",
      severity: "pass",
      title: "Configured standard workdays stay at or below eight hours",
      detail: "No pay profile in the review population configures more than eight standard hours per day.",
      governingRule: "Normal hours of work generally shall not exceed eight hours a day, subject to statutory exclusions and lawful alternative work arrangements.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      remediation: "Keep any future compressed-workweek configuration documented and reviewable.",
    });
  }

  const patternById = new Map(input.patterns.map((pattern) => [pattern.id, pattern]));
  const patternDaysById = new Map<number, PolicyReviewInput["patternDays"]>();
  for (const row of input.patternDays) {
    patternDaysById.set(row.patternId, [...(patternDaysById.get(row.patternId) ?? []), row]);
  }

  const restFailures: Array<{ employeeId: number; pattern?: string; reason: string }> = [];
  const assignedPatternLabels = new Set<string>();

  for (const employee of activeEmployees) {
    const assignments = currentAssignmentsFor(employee.id, input.scheduleAssignments, input.today);
    if (assignments.length > 0) {
      const validAssignedPattern = assignments.some((assignment) => {
        const pattern = patternById.get(assignment.patternId);
        if (!pattern?.active) {
          restFailures.push({
            employeeId: employee.id,
            pattern: pattern ? `${pattern.code} · ${pattern.name}` : `Pattern #${assignment.patternId}`,
            reason: "current assignment points to a missing or inactive schedule pattern",
          });
          return false;
        }
        const label = `${pattern.code} · ${pattern.name}`;
        assignedPatternLabels.add(label);
        const valid = patternProvidesWeeklyRest(pattern.cycleDays, patternDaysById.get(pattern.id) ?? []);
        if (!valid) {
          restFailures.push({
            employeeId: employee.id,
            pattern: label,
            reason: "assigned rotating schedule can produce a rolling seven-day window without a rest day",
          });
        }
        return valid;
      });
      if (!validAssignedPattern && assignments.length > 1) {
        // Every active assignment was already captured above.
      }
      continue;
    }

    if (!employee.restDay?.trim()) {
      restFailures.push({
        employeeId: employee.id,
        reason: "no fixed rest day and no current advanced schedule assignment",
      });
    }
  }

  if (restFailures.length > 0) {
    const affectedEmployees = new Set(restFailures.map((failure) => failure.employeeId));
    const affectedPatterns = [...new Set(restFailures.flatMap((failure) => failure.pattern ? [failure.pattern] : []))];
    findings.push({
      key: "WEEKLY_REST_CONTROL",
      domain: "Rest days",
      severity: "medium",
      title: "Weekly rest-day coverage needs review",
      detail: `${affectedEmployees.size} active employee(s) do not have a current scheduling configuration that proves at least one rest day in every rolling seven-day window. Advanced schedule assignments take precedence over the legacy fixed rest-day field.`,
      governingRule: "Employers generally should provide a weekly rest period of at least 24 consecutive hours after six consecutive normal workdays, subject to Labor Code rules and exceptions.",
      sourceLabel: SOURCES.restDay.label,
      sourceUrl: SOURCES.restDay.url,
      affectedEmployees: affectedEmployees.size,
      affectedPatterns: affectedPatterns.length ? affectedPatterns : undefined,
      remediation: "Fix the active schedule assignment or document the lawful exception. Unused schedule templates are not treated as employee compliance failures.",
    });
  } else {
    findings.push({
      key: "WEEKLY_REST_CONTROL",
      domain: "Rest days",
      severity: "pass",
      title: "Active employees have a weekly rest-day control",
      detail: assignedPatternLabels.size
        ? `Current employee assignments and fixed rest-day settings provide weekly rest coverage. ${assignedPatternLabels.size} assigned rotating pattern(s) passed the rolling seven-day check.`
        : "Each active employee has a fixed rest day and no conflicting current advanced schedule assignment.",
      governingRule: "Employers generally should provide a weekly rest period of at least 24 consecutive hours after six consecutive normal workdays, subject to Labor Code rules and exceptions.",
      sourceLabel: SOURCES.restDay.label,
      sourceUrl: SOURCES.restDay.url,
      remediation: "Keep schedule changes effective-dated and rerun policy review when assignments change.",
    });
  }

  const unconfiguredLeave = input.leavePolicies.filter(
    (policy) => policy.active && !["paid", "unpaid", "partial"].includes(policy.payTreatment.toLowerCase()),
  );
  if (unconfiguredLeave.length > 0) {
    findings.push({
      key: "LEAVE_PAYROLL_TREATMENT",
      domain: "Leave",
      severity: "high",
      title: "Active leave policies have no payroll treatment",
      detail: `${unconfiguredLeave.length} active leave policy/policies are not configured as paid, unpaid or partially paid.`,
      governingRule: "Approved leave must have deterministic payroll treatment so wages are not guessed at calculation time.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      remediation: "Set payroll treatment and paid percentage for every active leave policy.",
    });
  } else {
    findings.push({
      key: "LEAVE_PAYROLL_TREATMENT",
      domain: "Leave",
      severity: "pass",
      title: "Active leave policies have deterministic payroll treatment",
      detail: "Every active leave policy is configured as paid, unpaid or partially paid.",
      governingRule: "Approved leave must have deterministic payroll treatment so wages are not guessed at calculation time.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      remediation: "Keep leave-policy changes effective and review their payroll impact before use.",
    });
  }

  const oneYearAgo = dayNumber(input.today) - 365;
  const oneYearEmployees = activeEmployees.filter(
    (employee) => dayNumber(employee.startDate) <= oneYearAgo,
  );
  const paidFiveDayPolicy = input.leavePolicies.some(
    (policy) => policy.active
      && policy.payTreatment.toLowerCase() === "paid"
      && policy.annualDays >= 5
      && policy.paidPercentage >= 100,
  );

  if (oneYearEmployees.length > 0 && !paidFiveDayPolicy) {
    findings.push({
      key: "SIL_POLICY_COVERAGE",
      domain: "Leave",
      severity: "medium",
      title: "Configured paid leave does not visibly cover the five-day SIL floor",
      detail: `${oneYearEmployees.length} active employee(s) have at least one year of service, but no active fully-paid leave policy provides at least five days. Article 95 includes exemptions and equivalent-benefit cases, so this is a policy-basis review rather than an automatic violation.`,
      governingRule: "Article 95 generally grants five days of paid service incentive leave after one year of service, subject to stated exemptions and equivalent paid-leave benefits.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
      affectedEmployees: oneYearEmployees.length,
      remediation: "Configure the qualifying fully-paid leave benefit or document the employer/employee exemption or equivalent-benefit basis.",
    });
  } else if (oneYearEmployees.length > 0) {
    findings.push({
      key: "SIL_POLICY_COVERAGE",
      domain: "Leave",
      severity: "pass",
      title: "Configured paid leave visibly covers the five-day SIL floor",
      detail: "At least one active fully-paid leave policy provides five or more days for employees with at least one year of service.",
      governingRule: "Article 95 generally grants five days of paid service incentive leave after one year of service, subject to stated exemptions and equivalent paid-leave benefits.",
      sourceLabel: SOURCES.laborCode.label,
      sourceUrl: SOURCES.laborCode.url,
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
