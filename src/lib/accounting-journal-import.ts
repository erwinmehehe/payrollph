/**
 * Journal import files for accounting packages (Xero manual journals, QuickBooks Online journal entries), built from a payroll
 * journal and fitted to the TEMPLATE HEADER ROW the customer downloads from the package's own import screen.
 *
 * Why the template is an input and not a constant: neither package's public documentation states the exact column headers, the
 * accepted date format or the sign convention of a single Amount column in a form this repository can verify, and this repository
 * does not guess an external file format (see generateGovernmentDraft and the bank template rules in exporters.ts). So this module
 * never hard-codes a package's headers. It recognises each column by a small set of well-known names, fits the output to the
 * header row it is given, and REFUSES, naming the problem, whenever the template cannot be mapped unambiguously.
 *
 * Guarantees it does enforce itself:
 *   - every journal balances to the centavo (the older exporter tolerates a 0.02 difference, which an accounting import rejects);
 *   - lines are split into journals only at group boundaries (one employee's lines), each group balanced on its own, so a line
 *     limit never produces an unbalanced journal;
 *   - amounts are exact centavo strings with two decimals and no thousands separator; a line is a debit or a credit, never both;
 *   - the date format, the delimiter and, for a single signed Amount column, the sign convention must be chosen explicitly.
 *
 * It is pure: no database, file, network or environment access, and it is wired into no route or export.
 */

export type JournalLine = {
  /** Lines with the same key are one balanced block (for payroll, one employee). A block is never split across journals. */
  groupKey: string;
  accountCode?: string | null;
  accountName: string;
  /** Exact centavo strings, e.g. "1250.50". Exactly one of the two is above zero. */
  debit: string;
  credit: string;
  description: string;
  /** Cost center or class; written only when the template has a matching column. */
  costCenter?: string | null;
};

export type JournalImportOptions = {
  /** The first row of the file downloaded from the package's journal import screen. */
  templateHeader: readonly string[];
  /** YYYY-MM-DD. */
  date: string;
  /** Chosen explicitly: it is not stated in a verifiable source. */
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  /** Journal numbers are prefix-1, prefix-2, ... */
  journalNumberPrefix: string;
  narration: string;
  /** Which account identifier the template wants. */
  accountBy: "code" | "name";
  /** Required when the template has an Amount column and no separate Debit and Credit columns. */
  signedAmount?: "debit-positive" | "credit-positive";
  maxLinesPerJournal?: number;
  delimiter?: "," | ";";
};

export type JournalImportResult = {
  csv: string;
  journals: Array<{ number: string; lines: number; debit: string; credit: string }>;
  /** Non-fatal observations, for example a template column that was left blank. */
  notes: string[];
};

const cents = (value: unknown) => {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
const money = (value: number) => (value / 100).toFixed(2);
const normalise = (header: string) => header.replace(/^\*+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Well-known names for each column, compared after removing a leading asterisk, case and punctuation.
const NAMES = {
  journalNumber: ["journalno", "journalnumber"],
  date: ["date", "journaldate"],
  narration: ["narration", "journaldescription"],
  lineDescription: ["description", "linedescription", "memo"],
  accountCode: ["accountcode", "accountnumber"],
  accountName: ["accountname", "account"],
  debit: ["debit", "debits"],
  credit: ["credit", "credits"],
  amount: ["amount"],
  costCenter: ["class", "costcenter", "trackingoption1"],
} as const;
type Column = keyof typeof NAMES;

function resolveColumns(templateHeader: readonly string[]) {
  const found = new Map<Column, number>();
  const problems: string[] = [];
  const normalised = templateHeader.map(normalise);
  for (const column of Object.keys(NAMES) as Column[]) {
    const hits = normalised.flatMap((name, index) => (NAMES[column] as readonly string[]).includes(name) ? [index] : []);
    if (hits.length > 1) problems.push("AMBIGUOUS_TEMPLATE_COLUMN: " + column + " matches " + hits.map((i) => '"' + templateHeader[i] + '"').join(" and ") + ".");
    else if (hits.length === 1) found.set(column, hits[0]);
  }
  // A header that two different columns would claim cannot be filled twice.
  const claimed = new Map<number, Column>();
  for (const [column, index] of found) {
    const other = claimed.get(index);
    if (other) problems.push("AMBIGUOUS_TEMPLATE_COLUMN: \"" + templateHeader[index] + "\" could be " + other + " or " + column + ".");
    claimed.set(index, column);
  }
  return { found, problems };
}

function formatDate(isoDate: string, format: JournalImportOptions["dateFormat"]) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("INVALID_DATE: use YYYY-MM-DD.");
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) throw new Error("INVALID_DATE: " + isoDate + " is not a real calendar date.");
  return format === "YYYY-MM-DD" ? isoDate : format === "DD/MM/YYYY" ? day + "/" + month + "/" + year : month + "/" + day + "/" + year;
}

function quote(value: string, delimiter: string) {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}

export function buildJournalImport(lines: readonly JournalLine[], options: JournalImportOptions): JournalImportResult {
  const delimiter = options.delimiter ?? ",";
  const notes: string[] = [];
  const { found, problems } = resolveColumns(options.templateHeader);
  if (options.templateHeader.length === 0) problems.push("EMPTY_TEMPLATE: the template header row is required.");

  const accountColumn = options.accountBy === "code" ? "accountCode" : "accountName";
  if (!found.has("date")) problems.push("MISSING_TEMPLATE_COLUMN: no date column in the template.");
  if (!found.has(accountColumn)) problems.push("MISSING_TEMPLATE_COLUMN: the template has no " + (options.accountBy === "code" ? "account code" : "account name") + " column.");
  const separate = found.has("debit") && found.has("credit");
  if (found.has("debit") !== found.has("credit")) problems.push("MISSING_TEMPLATE_COLUMN: the template has only one of the Debit and Credit columns.");
  if (!separate && !found.has("amount")) problems.push("MISSING_TEMPLATE_COLUMN: the template has neither Debit and Credit columns nor an Amount column.");
  if (!separate && found.has("amount") && !options.signedAmount) problems.push("SIGN_CONVENTION_REQUIRED: the template has one signed Amount column; state signedAmount after confirming it with the package.");
  if (problems.length) throw new Error(problems.join(" "));

  const date = formatDate(options.date, options.dateFormat);
  if (!options.journalNumberPrefix.trim() || !options.narration.trim()) throw new Error("INVALID_OPTIONS: a journal number prefix and a narration are required.");
  const maxLines = options.maxLinesPerJournal ?? Number.POSITIVE_INFINITY;
  if (maxLines !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxLines) || maxLines < 2)) throw new Error("INVALID_OPTIONS: maxLinesPerJournal must be an integer of at least 2.");

  // Validate every line and group them. A line is a debit or a credit; zero lines are dropped.
  type Entry = { line: JournalLine; debit: number; credit: number };
  const groups = new Map<string, Entry[]>();
  for (const [position, line] of lines.entries()) {
    // An empty amount is the natural way to say "no debit" or "no credit"; every other value must be an exact centavo string.
    const debit = cents(line.debit === "" ? "0" : line.debit);
    const credit = cents(line.credit === "" ? "0" : line.credit);
    if (debit === null || credit === null) throw new Error("INVALID_AMOUNT: line " + (position + 1) + " has an amount that is not an exact centavo string.");
    if (debit > 0 && credit > 0) throw new Error("DEBIT_AND_CREDIT: line " + (position + 1) + " has both a debit and a credit.");
    if (debit === 0 && credit === 0) continue;
    if (!line.accountName.trim()) throw new Error("MISSING_ACCOUNT: line " + (position + 1) + " has no account name.");
    if (options.accountBy === "code" && !String(line.accountCode ?? "").trim()) throw new Error("MISSING_ACCOUNT_CODE: line " + (position + 1) + " (" + line.accountName + ") has no account code but the template needs one.");
    (groups.get(line.groupKey) ?? groups.set(line.groupKey, []).get(line.groupKey)!).push({ line, debit, credit });
  }
  if (groups.size === 0) throw new Error("EMPTY_JOURNAL: there is nothing to import.");
  for (const [key, entries] of groups) {
    const debit = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credit = entries.reduce((sum, entry) => sum + entry.credit, 0);
    if (debit !== credit) throw new Error("UNBALANCED_GROUP: " + key + " has debits " + money(debit) + " and credits " + money(credit) + ".");
    if (entries.length > maxLines) throw new Error("GROUP_TOO_LARGE: " + key + " has " + entries.length + " lines, more than the " + maxLines + " allowed in one journal.");
  }

  // Pack whole groups into journals of at most maxLines lines.
  const journals: Entry[][] = [];
  let current: Entry[] = [];
  for (const entries of groups.values()) {
    if (current.length && current.length + entries.length > maxLines) { journals.push(current); current = []; }
    current = current.concat(entries);
  }
  if (current.length) journals.push(current);

  const width = options.templateHeader.length;
  const out: string[] = [options.templateHeader.map((header) => quote(header, delimiter)).join(delimiter)];
  const summary: JournalImportResult["journals"] = [];
  const columnNotes = new Set<string>();
  journals.forEach((entries, index) => {
    const number = options.journalNumberPrefix + "-" + (index + 1);
    let debitTotal = 0, creditTotal = 0;
    for (const { line, debit, credit } of entries) {
      const cells: string[] = Array.from({ length: width }, () => "");
      const set = (column: Column, value: string) => { const at = found.get(column); if (at !== undefined) cells[at] = value; };
      set("journalNumber", number);
      set("date", date);
      set("narration", options.narration + " " + number);
      set("lineDescription", line.description);
      set(accountColumn, accountColumn === "accountCode" ? String(line.accountCode).trim() : line.accountName);
      if (options.accountBy === "code") set("accountName", line.accountName);
      if (separate) { set("debit", debit ? money(debit) : ""); set("credit", credit ? money(credit) : ""); }
      else {
        const positive = options.signedAmount === "debit-positive" ? debit - credit : credit - debit;
        set("amount", (positive < 0 ? "-" : "") + money(Math.abs(positive)));
      }
      if (line.costCenter) { if (found.has("costCenter")) set("costCenter", line.costCenter); else columnNotes.add("COST_CENTER_DROPPED: the template has no class or cost center column, so it was not written."); }
      out.push(cells.map((cell) => quote(cell, delimiter)).join(delimiter));
      debitTotal += debit; creditTotal += credit;
    }
    summary.push({ number, lines: entries.length, debit: money(debitTotal), credit: money(creditTotal) });
  });
  if (!found.has("journalNumber")) notes.push("NO_JOURNAL_NUMBER_COLUMN: the template has no journal number column; journals are told apart by date and narration, which carries the journal number.");
  if (!found.has("narration")) notes.push("NO_NARRATION_COLUMN: the template has no narration column; the narration was not written.");
  notes.push(...columnNotes);
  return { csv: out.join("\r\n") + "\r\n", journals: summary, notes };
}
