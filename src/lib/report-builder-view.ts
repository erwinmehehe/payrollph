/** Filter ONLY rows returned by an already authorized report endpoint. */
export type SavedRowFilter = { field: string; operator: "contains" | "equals"; value: string };
export function projectReportRows(input: {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  selectedFields: readonly string[];
  filters: readonly SavedRowFilter[];
}) {
  const indexes = input.selectedFields.length
    ? input.selectedFields.map(field => input.columns.indexOf(field)).filter(index => index >= 0)
    : input.columns.map((_, index) => index);
  const filtered = input.rows.filter(row => input.filters.every(filter => {
    const index = input.columns.indexOf(filter.field);
    if (index < 0) return false;
    const value = String(row[index] ?? "").toLocaleLowerCase();
    const match = filter.value.toLocaleLowerCase();
    return filter.operator === "equals" ? value === match : value.includes(match);
  }));
  return { columns: indexes.map(i => input.columns[i]), rows: filtered.map(row => indexes.map(i => String(row[i] ?? ""))) };
}
function quoteCsv(value: string) {
  // ES2017-compatible guard against leading invisible/control characters hiding a formula.
  const potentialFormula = /^[\s\x00-\x1f\x7f-\x9f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]*[=+@\-]/.test(value);
  return '"' + (potentialFormula ? "'" + value : value).replaceAll('"', '""') + '"';
}
export function exportProjectedReportCsv(columns: readonly string[], rows: readonly (readonly string[])[]) {
  return [columns, ...rows].map(row => row.map(quoteCsv).join(",")).join("\r\n") + "\r\n";
}
