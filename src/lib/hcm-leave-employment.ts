/**
 * Employment-period boundaries for NEW leave submissions and approvals.
 * Existing approved historical leave is not rewritten by these checks.
 * A separated employee's final-pay corrections need an independently
 * reviewed correction process, not a new active leave approval task.
 */
export const MAX_LEAVE_CALENDAR_DAYS = 366;
export const MAX_PRECISE_LEAVE_INTERVALS = 1500;

export type LeaveEligibilityFinding = {
  code: string;
  message: string;
};

function utcCalendarDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time;
}

export function validLeaveDate(value: string) {
  return utcCalendarDate(value) !== null;
}

export function leaveDateWindow(startDate: string, endDate: string):
  | { ok: true; calendarDays: number }
  | { ok: false; code: string; message: string } {
  const start = utcCalendarDate(startDate);
  const end = utcCalendarDate(endDate);
  if (start === null || end === null) {
    return {
      ok: false,
      code: "LEAVE_DATE_INVALID",
      message: "Leave dates must be genuine calendar dates in YYYY-MM-DD format.",
    };
  }
  if (end < start) {
    return { ok: false, code: "LEAVE_DATE_ORDER", message: "Leave end date cannot precede the start date." };
  }
  const calendarDays = Math.round((end - start) / 86_400_000) + 1;
  if (calendarDays > MAX_LEAVE_CALENDAR_DAYS) {
    return {
      ok: false,
      code: "LEAVE_DATE_RANGE_TOO_LONG",
      message: `One leave request cannot cover more than ${MAX_LEAVE_CALENDAR_DAYS} calendar days. Split the request or use a reviewed HR case.`,
    };
  }
  return { ok: true, calendarDays };
}

export function checkEmployeeLeaveEligibility(input: {
  employeeStatus: string;
  employmentStartDate: string;
  leaveStartDate: string;
  leaveEndDate: string;
  separationLastDay?: string | null;
  separationStatus?: string | null;
}): LeaveEligibilityFinding | null {
  const window = leaveDateWindow(input.leaveStartDate, input.leaveEndDate);
  if (!window.ok) return { code: window.code, message: window.message };

  if (!validLeaveDate(input.employmentStartDate)) {
    return {
      code: "LEAVE_EMPLOYMENT_START_UNVERIFIED",
      message: "The worker's actual hire date must be verified before new leave can be approved.",
    };
  }
  if (input.leaveStartDate < input.employmentStartDate) {
    return {
      code: "LEAVE_BEFORE_EMPLOYMENT",
      message: "New leave cannot begin before the employee's actual hire date.",
    };
  }

  const status = input.employeeStatus.trim().toLowerCase();
  if (status === "separated" || status === "terminated") {
    return {
      code: "LEAVE_SEPARATED_EMPLOYEE",
      message: "New leave requests for separated workers require HR/final-pay correction review, not an active leave approval.",
    };
  }
  if (!["active", "on leave", "separating"].includes(status)) {
    return {
      code: "LEAVE_EMPLOYMENT_STATUS_UNVERIFIED",
      message: "This employee is not currently eligible for an ordinary leave request. Review the HR lifecycle status.",
    };
  }
  // Use the same current separation record as the WFM employment gate.
  // Previously, an Active worker with an overlapping exit could still
  // receive ordinary leave approval despite an unresolved HR lifecycle.
  const separationStatus = (input.separationStatus ?? "").trim().toLowerCase();
  if ((status === "active" || status === "on leave")
      && ["draft", "approved", "released"].includes(separationStatus)) {
    return {
      code: "LEAVE_EMPLOYMENT_STATE_CONFLICT",
      message: "The employee has a current separation record inconsistent with Active/On leave status. Reconcile the HR record before ordinary leave approval.",
    };
  }
  if (status === "separating") {
    if (separationStatus === "released") {
      return {
        code: "LEAVE_FINAL_PAY_ALREADY_RELEASED",
        message: "The final-pay separation has been released. Use a separately reviewed HR/payroll correction instead of a new ordinary leave decision.",
      };
    }
    if (separationStatus && !["draft", "approved"].includes(separationStatus)) {
      return {
        code: "LEAVE_SEPARATION_END_UNVERIFIED",
        message: "The separating employee's lifecycle record needs HR verification before ordinary leave approval.",
      };
    }
    if (!input.separationLastDay || !validLeaveDate(input.separationLastDay)) {
      return {
        code: "LEAVE_SEPARATION_END_UNVERIFIED",
        message: "A separating employee needs a verified final employment day before requesting or approving leave.",
      };
    }
    if (input.leaveEndDate > input.separationLastDay) {
      return {
        code: "LEAVE_AFTER_SEPARATION",
        message: "Leave cannot extend beyond the employee's verified last day; use the separation/final-pay review process.",
      };
    }
  }

  return null;
}
