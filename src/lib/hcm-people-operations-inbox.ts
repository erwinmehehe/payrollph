/**
 * Company-wide, read-only HCM operations triage.
 * No payroll amounts, performance scores, salaries, personal identifiers or
 * free-text decision failures are included in work items.
 *
 * Existing source modules remain authoritative; no item can auto-approve,
 * automatically change employment status or execute final pay.
 */
export type PeopleOpsCategory =
  | "employment"
  | "onboarding"
  | "position"
  | "performance"
  | "separation";

export type PeopleOpsPriority = "review" | "follow_up" | "source_check";
export type PeopleOpsPage = "People" | "Planning" | "Performance" | "Separation";

export type PeopleOpsItem = {
  id: string;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  category: PeopleOpsCategory;
  priority: PeopleOpsPriority;
  title: string;
  detail: string;
  responsibleTeam: string;
  page: PeopleOpsPage;
  dueDate: string | null;
  daysUntil: number | null;
};

export type PeopleOpsInput = {
  today: string;
  employees: Array<{
    id: number; employeeNo: string; employeeName: string;
    status: string; startDate: string;
  }>;
  lifecycle: Array<{
    employeeId: number; state: string; action: string;
    dueDate: string | null; daysUntil: number | null;
  }>;
  provisioning: Array<{ employeeId: number; kind: string; done: boolean }>;
  reviews: Array<{ id: number; employeeId: number; status: string }>;
  positions: Array<{
    id: number; employeeId: number; assignmentType: string;
    effectiveFrom: string; effectiveUntil: string | null;
  }>;
  separations: Array<{
    id: number; employeeId: number; status: string; lastDay: string;
    clearanceStatus: string; itCleared: boolean; adminCleared: boolean;
    financeCleared: boolean; hrCleared: boolean;
  }>;
  assets: Array<{ employeeId: number | null; status: string; returnedOn: string | null }>;
};

export type PeopleOpsSummary = {
  total: number;
  review: number;
  followUp: number;
  sourceCheck: number;
  employeesAffected: number;
};

export type PeopleOpsPayload = {
  today: string;
  summary: PeopleOpsSummary;
  filteredTotal: number;
  page: number;
  pageSize: number;
  pages: number;
  rows: PeopleOpsItem[];
  disclaimer: string;
};

export type PeopleOpsFilters = {
  page?: number;
  pageSize?: number;
  category?: PeopleOpsCategory | "all";
  priority?: PeopleOpsPriority | "all";
  search?: string;
};

const EXITED = new Set(["Separated", "Terminated", "Inactive"]);
const CLOSED_REVIEW = new Set(["completed", "cancelled", "canceled", "archived", "rejected"]);
const PRIORITY_ORDER: Record<PeopleOpsPriority, number> = { review: 0, follow_up: 1, source_check: 2 };
const DISCLAIMER =
  "Read-only HR follow-ups from linked source records. Missing historical links may be legitimate. No salary, payroll, termination, payment, or statutory compliance decision is made here.";

function daysBetween(today: string, other: string): number {
  const from = Date.parse(today + "T00:00:00Z");
  const to = Date.parse(other + "T00:00:00Z");
  return Number.isFinite(from) && Number.isFinite(to)
    ? Math.round((to - from) / 86_400_000)
    : Number.MAX_SAFE_INTEGER;
}

function latestByEmployee<T extends { employeeId: number; id: number }>(items: T[]) {
  const map = new Map<number, T>();
  for (const item of items) {
    const current = map.get(item.employeeId);
    if (!current || current.id < item.id) map.set(item.employeeId, item);
  }
  return map;
}

function groupByEmployee<T extends { employeeId: number }>(items: T[]) {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const list = map.get(item.employeeId) ?? [];
    list.push(item);
    map.set(item.employeeId, list);
  }
  return map;
}

const EMPLOYMENT_ACTION: Record<string, {
  title: string; detail: string; page: PeopleOpsPage;
}> = {
  configure_terms: {
    title: "Verify employment terms", page: "People",
    detail: "No active governed employment terms are linked. Review legitimate historical exceptions before recording terms.",
  },
  record_decision: {
    title: "Prepare employment-term decision", page: "People",
    detail: "Review the probation or contract milestone and initiate the governed decision workflow. Dates never determine employment status automatically.",
  },
  review_decision: {
    title: "Review pending employment decision", page: "People",
    detail: "An independently authorized reviewer must decide the proposed employment action.",
  },
  retry_decision: {
    title: "Investigate failed employment decision", page: "People",
    detail: "Resolve the source or evidence conflict through the governed workflow. Do not bypass maker-checker.",
  },
  await_effective_date: {
    title: "Monitor scheduled employment decision", page: "People",
    detail: "An approved employment change is scheduled; verify its actual effective date.",
  },
  start_separation: {
    title: "Start governed Separation handoff", page: "Separation",
    detail: "A non-renewal handoff is ready. Separation and final-pay approvals must occur independently.",
  },
  continue_separation: {
    title: "Continue Separation clearance", page: "Separation",
    detail: "Review the existing offboarding and final-pay approval workflow; do not execute payment from this inbox.",
  },
};

function actionItem(employee: PeopleOpsInput["employees"][number], input: {
  category: PeopleOpsCategory;
  priority: PeopleOpsPriority;
  title: string;
  detail: string;
  responsibleTeam: string;
  page: PeopleOpsPage;
  dueDate?: string | null;
  today: string;
}): PeopleOpsItem {
  return {
    id: input.category + ":" + employee.id,
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: employee.employeeName,
    category: input.category,
    priority: input.priority,
    title: input.title,
    detail: input.detail,
    responsibleTeam: input.responsibleTeam,
    page: input.page,
    dueDate: input.dueDate ?? null,
    daysUntil: input.dueDate ? daysBetween(input.today, input.dueDate) : null,
  };
}

export function buildPeopleOperationsItems(input: PeopleOpsInput): PeopleOpsItem[] {
  const employeeMap = new Map(input.employees.map((row) => [row.id, row]));
  const provisioning = groupByEmployee(input.provisioning);
  const reviews = latestByEmployee(input.reviews);
  const positions = groupByEmployee(input.positions);
  const separations = latestByEmployee(input.separations);
  const assets = groupByEmployee(input.assets.filter(
    (row): row is typeof row & { employeeId: number } => row.employeeId != null,
  ));
  const output: PeopleOpsItem[] = [];

  for (const row of input.lifecycle) {
    const employee = employeeMap.get(row.employeeId);
    const definition = EMPLOYMENT_ACTION[row.action];
    if (!employee || !definition || row.action === "none") continue;
    // One Separation follow-up per worker: the authoritative Separation row
    // handles an already-started handoff, rather than duplicate lifecycle work.
    if ((row.action === "continue_separation" || row.action === "start_separation")
      && separations.has(row.employeeId)) continue;
    const priority: PeopleOpsPriority =
      row.state === "action_required" ? "review"
        : row.state === "unconfigured" ? "source_check" : "follow_up";
    if (!["action_required", "unconfigured", "upcoming", "in_progress"].includes(row.state)) continue;
    output.push(actionItem(employee, {
      category: "employment", priority, ...definition,
      responsibleTeam: "People Ops / Employment Decisions",
      dueDate: row.dueDate,
      today: input.today,
    }));
  }

  for (const employee of input.employees) {
    const exited = EXITED.has(employee.status);
    const started = daysBetween(employee.startDate, input.today) >= 0;
    const tasks = provisioning.get(employee.id) ?? [];
    const onboarding = tasks.filter((task) => task.kind === "onboarding");
    const offboarding = tasks.filter((task) => task.kind === "offboarding");
    const onboardingOpen = onboarding.filter((task) => !task.done).length;

    if (!exited && started && onboardingOpen > 0) {
      output.push(actionItem(employee, {
        category: "onboarding", priority: "follow_up", page: "People",
        title: "Complete onboarding checklist",
        detail: onboardingOpen + " of " + onboarding.length
          + " onboarding tasks remain open; confirm completion with the assigned owners.",
        responsibleTeam: "People Ops / IT",
        today: input.today,
      }));
    } else if (!exited && started && onboarding.length === 0
      && daysBetween(employee.startDate, input.today) <= 30) {
      output.push(actionItem(employee, {
        category: "onboarding", priority: "source_check", page: "People",
        title: "Check onboarding record coverage",
        detail: "No linked checklist for a recent hire. Direct or migrated onboarding may legitimately be documented elsewhere.",
        responsibleTeam: "People Ops / IT",
        today: input.today,
      }));
    }

    if (!exited && started) {
      const assignments = (positions.get(employee.id) ?? [])
        .filter((assignment) => assignment.assignmentType === "primary");
      const current = assignments.some((row) =>
        row.effectiveFrom <= input.today
        && (row.effectiveUntil == null || row.effectiveUntil >= input.today));
      const future = assignments
        .filter((row) => row.effectiveFrom > input.today)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
      if (!current && future) {
        output.push(actionItem(employee, {
          category: "position", priority: "follow_up", page: "Planning",
          title: "Review upcoming position assignment",
          detail: "A future-dated primary assignment exists; verify the approved effective date in Planning.",
          responsibleTeam: "People Ops / Workforce Planning",
          dueDate: future.effectiveFrom,
          today: input.today,
        }));
      } else if (!current) {
        output.push(actionItem(employee, {
          category: "position", priority: "source_check", page: "Planning",
          title: "Verify primary position coverage",
          detail: "No effective primary assignment found. Check historical/direct-hire context before creating a new position.",
          responsibleTeam: "People Ops / Workforce Planning",
          today: input.today,
        }));
      }

      const review = reviews.get(employee.id);
      if (review && !CLOSED_REVIEW.has(review.status)) {
        output.push(actionItem(employee, {
          category: "performance", priority: "follow_up", page: "Performance",
          title: "Continue performance-review workflow",
          detail: "A linked review is not completed. Check manager input and approvals; no pay change is implied.",
          responsibleTeam: "People Ops / Manager",
          today: input.today,
        }));
      }
    }

    const separation = separations.get(employee.id);
    const assignedAssets = (assets.get(employee.id) ?? [])
      .filter((row) => row.status === "assigned" && !row.returnedOn).length;
    const openExitTasks = offboarding.filter((row) => !row.done).length;
    const incompleteClearance = separation
      ? separation.clearanceStatus !== "cleared"
        || !separation.itCleared || !separation.adminCleared
        || !separation.financeCleared || !separation.hrCleared
      : false;

    if (separation) {
      if (separation.status === "released"
        && (incompleteClearance || openExitTasks > 0 || assignedAssets > 0)) {
        output.push(actionItem(employee, {
          category: "separation", priority: "review", page: "Separation",
          title: "Reconcile released Separation clearance",
          detail: "Released package still has outstanding clearance, offboarding tasks, or assigned assets. Bank settlement is not verified.",
          responsibleTeam: "People Ops / IT / Finance",
          dueDate: separation.lastDay,
          today: input.today,
        }));
      } else if (separation.status !== "released") {
        output.push(actionItem(employee, {
          category: "separation",
          priority: daysBetween(input.today, separation.lastDay) <= 0 ? "review" : "follow_up",
          page: "Separation",
          title: "Continue governed Separation",
          detail: "Review clearance, open tasks and returned assets through the existing approval process. No final-pay release is authorized.",
          responsibleTeam: "People Ops / IT / Finance",
          dueDate: separation.lastDay,
          today: input.today,
        }));
      }
    } else if (exited || openExitTasks > 0) {
      output.push(actionItem(employee, {
        category: "separation", priority: openExitTasks ? "review" : "source_check",
        page: "Separation",
        title: openExitTasks ? "Reconcile unfinished exit tasks" : "Verify historical Separation record",
        detail: openExitTasks
          ? "Offboarding tasks are open without a linked Separation record. Reconcile the source before changing employee status."
          : "An exited worker has no linked Separation. Historic imports may legitimately use external evidence.",
        responsibleTeam: "People Ops / IT / Finance",
        today: input.today,
      }));
    }
  }

  return output.sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p) return p;
    const date = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    if (date) return date;
    const byName = a.employeeName.localeCompare(b.employeeName);
    if (byName) return byName;
    return a.id.localeCompare(b.id);
  });
}

export function paginatePeopleOperationsItems(
  today: string,
  allRows: PeopleOpsItem[],
  filters: PeopleOpsFilters = {},
): PeopleOpsPayload {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(filters.pageSize ?? 20)));
  const q = (filters.search ?? "").trim().toLocaleLowerCase();
  const filtered = allRows.filter((row) =>
    (!filters.category || filters.category === "all" || row.category === filters.category)
    && (!filters.priority || filters.priority === "all" || row.priority === filters.priority)
    && (!q || (row.employeeName + " " + row.employeeNo).toLocaleLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  return {
    today,
    summary: {
      total: allRows.length,
      review: allRows.filter((row) => row.priority === "review").length,
      followUp: allRows.filter((row) => row.priority === "follow_up").length,
      sourceCheck: allRows.filter((row) => row.priority === "source_check").length,
      employeesAffected: new Set(allRows.map((row) => row.employeeId)).size,
    },
    filteredTotal: filtered.length,
    page: safePage,
    pageSize,
    pages,
    rows: filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    disclaimer: DISCLAIMER,
  };
}
