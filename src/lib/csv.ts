function neutralizeSpreadsheetFormula(value: unknown) {
  const text = String(value ?? "");
  if (!text) return text;

  // Spreadsheet importers may evaluate formula prefixes hidden behind leading
  // whitespace or invisible format characters. Inspect without trimming data.
  const inspected = text.replace(/^[\s\u200B-\u200D\u2060]+/u, "");
  const first = inspected[0];
  const formulaPrefix = first === "=" || first === "+" || first === "@" ||
    text[0] === "\t" || text[0] === "\r" || text[0] === "\n";
  const negativeFormula = first === "-" && !/^-\d+(?:\.\d+)?$/.test(inspected);

  return formulaPrefix || negativeFormula ? `'${text}` : text;
}

export function escapeCsvCell(value: unknown) {
  return `"${neutralizeSpreadsheetFormula(value).replaceAll('"', '""')}"`;
}

export function toCsv(input: { columns: string[]; rows: string[][] }) {
  return [input.columns, ...input.rows].map((line) => line.map(escapeCsvCell).join(",")).join("\n");
}
