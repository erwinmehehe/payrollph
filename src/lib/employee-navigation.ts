export type EmployeeSelfTab = "home" | "pay" | "time" | "leave" | "documents" | "performance" | "profile" | "expenses";

export const EMPLOYEE_PAGE_LABELS: Record<EmployeeSelfTab, { label: string; mobileLabel?: string }> = {
  home: { label: "Home" }, pay: { label: "Pay", mobileLabel: "Payslips" },
  time: { label: "Time", mobileLabel: "Attendance" }, leave: { label: "Leave" },
  documents: { label: "Documents" }, performance: { label: "Performance" },
  profile: { label: "Profile", mobileLabel: "My info" }, expenses: { label: "Expenses" },
};
export const ESS_PRIMARY_TABS: EmployeeSelfTab[] = ["home", "pay", "time", "leave"];
const ESS_MORE_TABS: EmployeeSelfTab[] = ["documents", "performance", "profile"];
const ESS_ALL_TABS: EmployeeSelfTab[] = [...ESS_PRIMARY_TABS, ...ESS_MORE_TABS];

/** Desktop and phone use the same opt-in module contract; default pages stay intact. */
export function employeeNavigationTabs(spendEnabled = false) {
  return { primaryTabs: ESS_PRIMARY_TABS,
    moreTabs: spendEnabled === true ? [...ESS_MORE_TABS, "expenses" as const] : ESS_MORE_TABS,
    allTabs: spendEnabled === true ? [...ESS_ALL_TABS, "expenses" as const] : ESS_ALL_TABS };
}

export function employeeTabEnabled(tab: EmployeeSelfTab, spendEnabled = false) {
  return employeeNavigationTabs(spendEnabled).allTabs.includes(tab);
}
