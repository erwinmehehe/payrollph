import type { Employee } from "@/components/workspace/types";

/** Employee identifiers already present in the authorized selected-employer roster. */
export type HrisQuickFindEmployee = Pick<
  Employee, "id" | "employeeNo" | "firstName" | "lastName" | "title" | "status"
>;

const MAX_RESULTS = 6;

function normalized(value: string): string {
  // Fold diacritics for search only; never rewrite authoritative worker names.
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/**
 * Search a previously authorized, employer-scoped snapshot only.
 * This does not fetch records, elevate roles, or change worker access.
 * Names/employee numbers are already provided to the HR directory;
 * exclude pay, government IDs, email and other sensitive fields.
 */
export function findAuthorizedHrisEmployees(
  authorizedEmployees: readonly HrisQuickFindEmployee[],
  searchTerm: string,
): HrisQuickFindEmployee[] {
  const query = normalized(searchTerm).slice(0, 80);
  if (query.length < 2) return [];

  return authorizedEmployees
    .map((employee) => {
      const number = normalized(employee.employeeNo);
      const name = normalized(employee.firstName + " " + employee.lastName);
      const reverse = normalized(employee.lastName + " " + employee.firstName);
      const title = normalized(employee.title);
      const rank = number === query ? 0
        : number.startsWith(query) ? 1
        : name.startsWith(query) || reverse.startsWith(query) ? 2
        : number.includes(query) || name.includes(query) || reverse.includes(query) ? 3
        : title.includes(query) ? 4
        : -1;
      return { employee, rank };
    })
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.employee.lastName.localeCompare(b.employee.lastName))
    .slice(0, MAX_RESULTS)
    .map(({ employee }) => employee);
}
