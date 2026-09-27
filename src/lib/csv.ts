export function escapeCsvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function toCsv(input: { columns: string[]; rows: string[][] }) {
  return [input.columns, ...input.rows].map((line) => line.map(escapeCsvCell).join(",")).join("\n");
}
