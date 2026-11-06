import type { employees } from "../../src/db/schema";

/** Fictional fixture checked against the real insert schema, without opening a DB. */
export function managedClientWorkerFixture(organizationId: number, employeeNo: string, label: string) {
  return {
    organizationId, employeeNo, firstName: "Fictional", lastName: label,
    title: "Test", avatarInitials: "FT", basicRate: "1000",
    startDate: "2025-12-01",
  } satisfies typeof employees.$inferInsert;
}
