function neutralizeSpreadsheetFormula(value: unknown) {
  const text = String(value ?? "");
  if (!text) return text;

  const first = text[0];
  const formulaPrefix = first === "=" || first === "+" || first === "@" || first === "\t" || first === "\r" || first === "\n";
  const negativeFormula = first === "-" && !/^-\d+(?:\.\d+)?$/.test(text);

  return formulaPrefix || negativeFormula ? `'${text}` : text;
}

export function escapeCsvCell(value: unknown) {
  return `"${neutralizeSpreadsheetFormula(value).replaceAll('"', '""')}"`;
}

export function toCsv(input: { columns: string[]; rows: string[][] }) {
  return [input.columns, ...input.rows].map((line) => line.map(escapeCsvCell).join(",")).join("\n");
}
