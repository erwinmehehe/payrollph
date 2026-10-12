import type { FirstPayrollJourneyStep } from "@/lib/first-payroll-journey";

/** One fixed step/role map for both API permissions and the inline journey. */
export const FIRST_PAYROLL_OWNER = {
  company: { id: 1, role: "owner", team: "Company administration" },
  people: { id: 2, role: "hr", team: "People operations" },
  time: { id: 3, role: "hr", team: "Attendance review" },
  reviewers: { id: 4, role: "owner", team: "Access administration" },
  payroll: { id: 5, role: "payroll", team: "Payroll preparation" },
  approval: { id: 6, role: "checker", team: "Independent payroll checker" },
  exports: { id: 7, role: "bookkeeper", team: "Payroll records and filing" },
} as const satisfies Record<FirstPayrollJourneyStep["key"], {
  id: number; role: string; team: string;
}>;
export type FirstPayrollKey = keyof typeof FIRST_PAYROLL_OWNER;
export function isFirstPayrollKey(value: unknown): value is FirstPayrollKey {
  return typeof value === "string" && Object.hasOwn(FIRST_PAYROLL_OWNER, value);
}
