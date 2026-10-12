/** Pure CSV preview and correction export. Do not put employee data in URLs or logs. */
export type EmployeeImportError = { line: number; problems: string[] };
export type PreviewRow = { line: number; cells: string[]; problems: string[] };
export type EmployeeImportPreview = { headers: string[]; rows: PreviewRow[]; total: number; truncated: boolean };

export function parseEmployeeImportPreview(
  input: string, errors: readonly EmployeeImportError[] = [], maxRows = 200,
): EmployeeImportPreview {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [], field = "", quoted = false, atRecordStart = 1, line = 1;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) quoted = false;
      else if (field.length === 0) quoted = true;
      else field += char;
    } else if (char === "," && !quoted) {
      fields.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      fields.push(field); field = "";
      if (fields.some(value => value.trim() !== "")) records.push({ line: atRecordStart, fields });
      fields = [];
      if (char === "\r" && input[i + 1] === "\n") i++;
      line++;
      atRecordStart = line;
    } else {
      field += char;
      if (char === "\n" || char === "\r") {
        if (char === "\r" && input[i + 1] === "\n") { field += "\n"; i++; }
        line++;
      }
    }
  }
  if (quoted) throw new Error("CSV includes an unclosed quoted value. Correct the file and validate again.");
  fields.push(field);
  if (fields.some(value => value.trim() !== "")) records.push({ line: atRecordStart, fields });
  const [header, ...body] = records;
  if (!header) return { headers: [], rows: [], total: 0, truncated: false };
  const errorsByLine = new Map(errors.map(entry => [entry.line, entry.problems]));
  return {
    headers: header.fields.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim()),
    rows: body.slice(0, maxRows).map(entry => ({
      line: entry.line, cells: entry.fields, problems: errorsByLine.get(entry.line) ?? [],
    })),
    total: body.length, truncated: body.length > maxRows,
  };
}

function safeCsvCell(value: string): string {
  const spreadsheetSafe = /^[\s]*[=+@\-]/.test(value) ? "'" + value : value;
  return '"' + spreadsheetSafe.replaceAll('"', '""') + '"';
}

export function makeEmployeeImportErrorCsv(
  input: string, errors: readonly EmployeeImportError[],
): string {
  const report = parseEmployeeImportPreview(input, errors, Number.MAX_SAFE_INTEGER);
  const byLine = new Map(errors.map(row => [row.line, row.problems]));
  const output: string[][] = [["Source line", ...report.headers, "Validation errors"]];
  for (const row of report.rows) {
    const problems = byLine.get(row.line);
    if (problems?.length) output.push([String(row.line), ...report.headers.map((_, i) => row.cells[i] ?? ""), problems.join("; ")]);
  }
  // Include server errors whose source row could not be parsed.
  const included = new Set(report.rows.map(row => row.line));
  for (const error of errors) {
    if (!included.has(error.line)) output.push([String(error.line), ...report.headers.map(() => ""), error.problems.join("; ")]);
  }
  return output.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
}
