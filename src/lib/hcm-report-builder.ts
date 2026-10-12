import { toCsv } from "@/lib/csv";

export type ReportDataset = "people" | "time" | "payroll";
export type ReportRole = "owner" | "admin" | "hr" | "payroll" | "checker" | "manager" | "bookkeeper" | "employee";
type Field = { dataset: ReportDataset; key: string; label: string; salary: boolean; groupable: boolean };
export const REPORT_FIELDS: readonly Field[] = [
  { dataset: "people", key: "department", label: "Department", salary: false, groupable: true },
  { dataset: "people", key: "status", label: "Employee status", salary: false, groupable: true },
  { dataset: "people", key: "headcount", label: "Headcount", salary: false, groupable: false },
  { dataset: "people", key: "turnover", label: "Departures", salary: false, groupable: false },
  { dataset: "time", key: "department", label: "Department", salary: false, groupable: true },
  { dataset: "time", key: "absenceDays", label: "Approved absence days", salary: false, groupable: false },
  { dataset: "time", key: "overtimeHours", label: "Approved OT hours", salary: false, groupable: false },
  { dataset: "payroll", key: "department", label: "Department", salary: false, groupable: true },
  { dataset: "payroll", key: "grossPay", label: "Payroll cost", salary: true, groupable: false },
  { dataset: "payroll", key: "overtimeCost", label: "OT cost", salary: true, groupable: false },
] as const;

const SALARY_ROLES = new Set<ReportRole>(["admin", "hr", "payroll"]);
export type ReportSpecification = {
  dataset: ReportDataset;
  fields: string[];
  groupBy?: string | null;
  filters?: Record<string, string>;
};
export function validateReportSpecification(spec: ReportSpecification, role: ReportRole) {
  if (!["people", "time", "payroll"].includes(spec.dataset)) throw new Error("Unknown report dataset.");
  if (!Array.isArray(spec.fields) || spec.fields.length === 0 || spec.fields.length > 10) throw new Error("Select 1-10 approved fields.");
  if (new Set(spec.fields).size !== spec.fields.length) throw new Error("Duplicate report fields.");
  const allowed = REPORT_FIELDS.filter(field => field.dataset === spec.dataset);
  const columns = spec.fields.map(key => {
    const match = allowed.find(field => field.key === key);
    if (!match) throw new Error("Field is not available in this dataset.");
    if (match.salary && !SALARY_ROLES.has(role)) throw new Error("Salary fields require People or payroll administration.");
    return match;
  });
  if (spec.groupBy && !allowed.some(f => f.key === spec.groupBy && f.groupable)) throw new Error("Invalid grouping field.");
  const filters = spec.filters ?? {};
  if (Object.keys(filters).length > 8) throw new Error("Too many filters.");
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.some(f => f.key === key && f.groupable) || typeof value !== "string" || value.length > 120) {
      throw new Error("Invalid filter.");
    }
  }
  return columns;
}
export function buildWhitelistedReport(
  spec: ReportSpecification,
  role: ReportRole,
  authorizedRows: readonly Record<string, string | number | null>[],
) {
  const columns = validateReportSpecification(spec, role);
  const filtered = authorizedRows.filter(row => Object.entries(spec.filters ?? {}).every(([key, value]) => String(row[key] ?? "") === value));
  const groups = new Map<string, typeof filtered>();
  for (const row of filtered) {
    const key = spec.groupBy ? String(row[spec.groupBy] ?? "") : "All";
    const groupRows = groups.get(key);
    if (groupRows) groupRows.push(row);
    else groups.set(key, [row]);
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, records]) => {
    const output: Record<string, string | number> = {};
    if (spec.groupBy) output[spec.groupBy] = group;
    for (const column of columns) {
      if (column.groupable) {
        output[column.key] = spec.groupBy === column.key ? group : (spec.groupBy ? "Mixed" : "All");
      } else {
        // Sum in integer hundredths, not floating-point pesos. Refuse totals
        // that exceed JS safe-integer centavo bounds instead of losing money.
        let hundredths = 0;
        for (const record of records) {
          const value = Number(record[column.key] ?? 0);
          const cents = Math.round(value * 100);
          if (!Number.isFinite(value) || !Number.isSafeInteger(cents)
              || !Number.isSafeInteger(hundredths + cents)) {
            throw new Error("Invalid or centavo-unsafe stored report amount.");
          }
          hundredths += cents;
        }
        output[column.key] = hundredths / 100;
      }
    }
    return output;
  });
  const keys = [...new Set([...(spec.groupBy ? [spec.groupBy] : []), ...spec.fields])];
  return {
    columns: keys,
    rows,
    csv: toCsv({ columns: keys, rows: rows.map(row => keys.map(key => String(row[key] ?? ""))) }),
  };
}

export function validateReportDates(startDate: string, endDate: string): void {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  };
  if (!valid(startDate) || !valid(endDate)) throw new Error("Provide valid YYYY-MM-DD report dates.");
  const days = Math.floor((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
  if (days < 1 || days > 366) throw new Error("Report range must be 1-366 days.");
}
