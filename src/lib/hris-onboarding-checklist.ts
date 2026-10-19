import type { Employee, ProvisioningTask } from "@/components/workspace/types";

/**
 * View-only onboarding list built from the already-authorized dashboard.
 * UI filtering does not grant access; the provisioning PATCH route separately
 * enforces the real employer, employee scope, role and audit trail.
 */
export type OnboardingEmployee = Pick<
  Employee, "id" | "employeeNo" | "firstName" | "lastName" | "status"
>;
export type OnboardingTask = Pick<
  ProvisioningTask, "id" | "employeeId" | "kind" | "title" | "owner" | "done"
>;

export type OnboardingChecklistGroup = {
  employee: OnboardingEmployee;
  tasks: OnboardingTask[];
  recorded: number;
  markedDone: number;
  remaining: number;
};

export function buildOnboardingChecklistGroups(
  employees: readonly OnboardingEmployee[],
  provisioning: readonly OnboardingTask[],
): OnboardingChecklistGroup[] {
  // Never render a task that is not attached to a worker in the authorized
  // employer's *visible* employee snapshot.
  const visible = new Map<number, OnboardingEmployee>();
  for (const person of employees) {
    if (Number.isSafeInteger(person.id) && person.id > 0) visible.set(person.id, person);
  }

  const tasksByEmployee = new Map<number, OnboardingTask[]>();
  const seenTaskIds = new Set<number>();
  for (const task of provisioning) {
    if (task.kind !== "onboarding" ||
        !Number.isSafeInteger(task.id) || task.id <= 0 ||
        !Number.isSafeInteger(task.employeeId) || task.employeeId <= 0 ||
        !visible.has(task.employeeId) || seenTaskIds.has(task.id)) continue;
    seenTaskIds.add(task.id);
    const tasks = tasksByEmployee.get(task.employeeId) ?? [];
    tasks.push(task);
    tasksByEmployee.set(task.employeeId, tasks);
  }

  const result: OnboardingChecklistGroup[] = [];
  for (const [employeeId, tasks] of tasksByEmployee) {
    const employee = visible.get(employeeId)!;
    const ordered = [...tasks].sort(
      (a, b) => Number(a.done) - Number(b.done) || a.id - b.id,
    );
    const markedDone = ordered.filter((task) => task.done).length;
    result.push({
      employee,
      tasks: ordered,
      recorded: ordered.length,
      markedDone,
      remaining: ordered.length - markedDone,
    });
  }

  return result.sort((a, b) =>
    Number(b.remaining > 0) - Number(a.remaining > 0) ||
    b.remaining - a.remaining ||
    (a.employee.lastName + ", " + a.employee.firstName).localeCompare(
      b.employee.lastName + ", " + b.employee.firstName, "en",
    ) ||
    a.employee.id - b.employee.id,
  );
}

/** Read-only filtering of already authorized, recorded checklists. Missing tasks are never inferred complete. */
export function filterOnboardingChecklistGroups(
  groups: readonly OnboardingChecklistGroup[],
  query: string,
  show: "open" | "all",
): OnboardingChecklistGroup[] {
  // HR directories commonly use "Last, First"; normalize pasted whitespace
  // without searching beyond the already-authorized employee groups.
  const normalize = (value: string) =>
    value.trim().replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").toLocaleLowerCase("en");
  const needle = normalize(query);
  return groups.filter((group) => {
    if (show === "open" && group.remaining === 0) return false;
    if (!needle) return true;
    const employee = group.employee;
    const fullName = normalize(employee.firstName + " " + employee.lastName);
    const lastFirst = normalize(employee.lastName + " " + employee.firstName);
    const employeeNo = normalize(employee.employeeNo);
    return fullName.includes(needle) ||
      lastFirst.includes(needle) ||
      normalize(employee.lastName + ", " + employee.firstName).includes(needle) ||
      employeeNo.includes(needle) ||
      (fullName + " " + employeeNo).includes(needle);
  });
}
