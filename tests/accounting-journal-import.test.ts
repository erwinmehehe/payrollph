import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildJournalImport, type JournalImportOptions, type JournalLine } from "../src/lib/accounting-journal-import";

// Two employees, each block balanced by hand.
//   E1: debit salaries 30,000.00; credits SSS 875.00 + PhilHealth 750.00 + Pag-IBIG 100.00 + withholding 3,259.10 + cash 25,015.90 = 30,000.00.
//   E2: debit salaries 20,000.00; credits withholding 2,000.00 + cash 18,000.00 = 20,000.00.  Total 50,000.00 each side.
const line = (groupKey: string, accountCode: string, accountName: string, debit: string, credit: string, description: string, costCenter?: string): JournalLine =>
  ({ groupKey, accountCode, accountName, debit, credit, description, ...(costCenter ? { costCenter } : {}) });
const journal: JournalLine[] = [
  line("E1", "6000", "Salaries and Wages Expense", "30000.00", "", "E1 salary"),
  line("E1", "2100", "SSS Payable", "", "875.00", "E1 SSS"), line("E1", "2110", "PhilHealth Payable", "", "750.00", "E1 PhilHealth"),
  line("E1", "2120", "Pag-IBIG Payable", "", "100.00", "E1 Pag-IBIG"), line("E1", "2200", "BIR Withholding Payable", "", "3259.10", "E1 withholding"),
  line("E1", "1000", "Cash/Bank", "", "25015.90", "E1 net pay"),
  line("E2", "6000", "Salaries and Wages Expense", "20000.00", "", "E2 salary"),
  line("E2", "2200", "BIR Withholding Payable", "", "2000.00", "E2 withholding"), line("E2", "1000", "Cash/Bank", "", "18000.00", "E2 net pay"),
];
// Headers as third-party documents describe them. The module never relies on these exact strings: a real template is supplied.
const qboLike = ["Journal No.", "Journal Date", "Account Name", "Description", "Debits", "Credits"];
const xeroLike = ["*Narration", "*Date", "Description", "*AccountCode", "TaxRate", "*Amount", "TrackingName1", "TrackingOption1"];
const base = (over: Partial<JournalImportOptions> = {}): JournalImportOptions =>
  ({ templateHeader: qboLike, date: "2026-12-15", dateFormat: "MM/DD/YYYY", journalNumberPrefix: "PAYROLL-12", narration: "Payroll 2026-12-15", accountBy: "name", ...over });
const rows = (csv: string) => csv.trimEnd().split("\r\n");

test("a template with separate Debits and Credits columns is filled in the template's own column order", () => {
  const result = buildJournalImport(journal, base());
  const out = rows(result.csv);
  assert.equal(out[0], "Journal No.,Journal Date,Account Name,Description,Debits,Credits");
  assert.equal(out.length, 10);
  assert.equal(out[1], "PAYROLL-12-1,12/15/2026,Salaries and Wages Expense,E1 salary,30000.00,");
  assert.equal(out[2], "PAYROLL-12-1,12/15/2026,SSS Payable,E1 SSS,,875.00");
  assert.equal(out[9], "PAYROLL-12-1,12/15/2026,Cash/Bank,E2 net pay,,18000.00");
  assert.deepEqual(result.journals, [{ number: "PAYROLL-12-1", lines: 9, debit: "50000.00", credit: "50000.00" }]);
});

test("a single signed Amount column needs an explicit sign convention, and follows it", () => {
  assert.throws(() => buildJournalImport(journal, base({ templateHeader: xeroLike, accountBy: "code" })), /SIGN_CONVENTION_REQUIRED/);
  const debitPositive = rows(buildJournalImport(journal, base({ templateHeader: xeroLike, accountBy: "code", signedAmount: "debit-positive", dateFormat: "DD/MM/YYYY" })).csv);
  assert.equal(debitPositive[1], "Payroll 2026-12-15 PAYROLL-12-1,15/12/2026,E1 salary,6000,,30000.00,,");
  assert.equal(debitPositive[2], "Payroll 2026-12-15 PAYROLL-12-1,15/12/2026,E1 SSS,2100,,-875.00,,");
  const creditPositive = rows(buildJournalImport(journal, base({ templateHeader: xeroLike, accountBy: "code", signedAmount: "credit-positive", dateFormat: "DD/MM/YYYY" })).csv);
  assert.equal(creditPositive[1].split(",")[5], "-30000.00");
  assert.equal(creditPositive[2].split(",")[5], "875.00");
  // The signed amounts of one journal add up to exactly zero.
  const total = debitPositive.slice(1).reduce((sum, row) => sum + Math.round(Number(row.split(",")[5]) * 100), 0);
  assert.equal(total, 0);
});

test("lines are split into journals only at employee boundaries, each journal balanced", () => {
  const two = buildJournalImport(journal, base({ maxLinesPerJournal: 6 }));
  assert.deepEqual(two.journals, [
    { number: "PAYROLL-12-1", lines: 6, debit: "30000.00", credit: "30000.00" },
    { number: "PAYROLL-12-2", lines: 3, debit: "20000.00", credit: "20000.00" },
  ]);
  assert.equal(rows(two.csv)[7].split(",")[0], "PAYROLL-12-2");
  // A limit that falls INSIDE the second employee's block: the block moves whole to the next journal instead of being cut in two.
  const seven = buildJournalImport(journal, base({ maxLinesPerJournal: 7 }));
  assert.deepEqual(seven.journals.map((item) => [item.lines, item.debit, item.credit]), [[6, "30000.00", "30000.00"], [3, "20000.00", "20000.00"]]);
  assert.equal(buildJournalImport(journal, base({ maxLinesPerJournal: 9 })).journals.length, 1);
  assert.throws(() => buildJournalImport(journal, base({ maxLinesPerJournal: 5 })), /GROUP_TOO_LARGE: E1 has 6 lines, more than the 5 allowed/);
  assert.throws(() => buildJournalImport(journal, base({ maxLinesPerJournal: 1 })), /INVALID_OPTIONS/);
});

test("a one-centavo imbalance is refused instead of tolerated", () => {
  const off = journal.map((entry) => entry.description === "E1 net pay" ? { ...entry, credit: "25015.89" } : entry);
  assert.throws(() => buildJournalImport(off, base()), /UNBALANCED_GROUP: E1 has debits 30000\.00 and credits 29999\.99/);
});

test("bad lines are refused with the line number", () => {
  const swap = (change: Partial<JournalLine>, index = 0) => journal.map((entry, i) => i === index ? { ...entry, ...change } : entry);
  assert.throws(() => buildJournalImport(swap({ debit: "30000.005" }), base()), /INVALID_AMOUNT: line 1/);
  assert.throws(() => buildJournalImport(swap({ debit: "1,000.00" }), base()), /INVALID_AMOUNT: line 1/);
  assert.throws(() => buildJournalImport(swap({ credit: "5.00" }), base()), /DEBIT_AND_CREDIT: line 1/);
  assert.throws(() => buildJournalImport(swap({ accountName: " " }), base()), /MISSING_ACCOUNT: line 1/);
  assert.throws(() => buildJournalImport(swap({ accountCode: "" }), base({ templateHeader: xeroLike, accountBy: "code", signedAmount: "debit-positive" })), /MISSING_ACCOUNT_CODE: line 1/);
  assert.throws(() => buildJournalImport([], base()), /EMPTY_JOURNAL/);
  const withZero = buildJournalImport([...journal, line("E1", "6000", "Salaries and Wages Expense", "0.00", "0", "ignored")], base());
  assert.equal(withZero.journals[0].lines, 9, "a zero line is dropped");
});

test("a template that cannot be mapped unambiguously is refused, naming the problem", () => {
  const refuse = (header: string[], over: Partial<JournalImportOptions>, expected: RegExp) => assert.throws(() => buildJournalImport(journal, base({ templateHeader: header, ...over })), expected);
  refuse([], {}, /EMPTY_TEMPLATE/);
  refuse(["Journal No.", "Account Name", "Debits", "Credits"], {}, /MISSING_TEMPLATE_COLUMN: no date column/);
  refuse(["Date", "Account Name", "Debits"], {}, /only one of the Debit and Credit/);
  refuse(["Date", "Account Name", "Memo"], {}, /neither Debit and Credit columns nor an Amount column/);
  refuse(["Date", "Account Name", "Debits", "Credits"], { accountBy: "code" }, /no account code column/);
  refuse(["Date", "Account", "Account Name", "Debits", "Credits"], {}, /AMBIGUOUS_TEMPLATE_COLUMN: accountName matches "Account" and "Account Name"/);
  refuse(["Date", "Account Name", "Description", "Memo", "Debits", "Credits"], {}, /AMBIGUOUS_TEMPLATE_COLUMN: lineDescription matches/);
});

test("the date format must be a real date and is written as chosen", () => {
  assert.throws(() => buildJournalImport(journal, base({ date: "2026-02-30" })), /INVALID_DATE: 2026-02-30 is not a real calendar date/);
  assert.throws(() => buildJournalImport(journal, base({ date: "15/12/2026" })), /INVALID_DATE/);
  assert.equal(rows(buildJournalImport(journal, base({ dateFormat: "YYYY-MM-DD" })).csv)[1].split(",")[1], "2026-12-15");
});

test("quotes, commas and the chosen delimiter are escaped, and a missing column is reported rather than guessed", () => {
  const tricky = journal.map((entry, i) => i === 0 ? { ...entry, description: 'Salary, "regular" pay' } : entry);
  assert.equal(rows(buildJournalImport(tricky, base()).csv)[1], 'PAYROLL-12-1,12/15/2026,Salaries and Wages Expense,"Salary, ""regular"" pay",30000.00,');
  assert.equal(rows(buildJournalImport(journal, base({ delimiter: ";" })).csv)[1], "PAYROLL-12-1;12/15/2026;Salaries and Wages Expense;E1 salary;30000.00;");
  const noNumber = buildJournalImport(journal, base({ templateHeader: ["Date", "Account Name", "Debits", "Credits"] }));
  assert.ok(noNumber.notes.some((note) => note.startsWith("NO_JOURNAL_NUMBER_COLUMN")));
  assert.ok(noNumber.notes.some((note) => note.startsWith("NO_NARRATION_COLUMN")));
  const withCenter = journal.map((entry, i) => i === 0 ? { ...entry, costCenter: "OPS" } : entry);
  assert.ok(buildJournalImport(withCenter, base()).notes.some((note) => note.startsWith("COST_CENTER_DROPPED")));
  const kept = rows(buildJournalImport(withCenter, base({ templateHeader: [...qboLike, "Class"] })).csv);
  assert.equal(kept[1].endsWith(",OPS"), true);
  assert.equal(kept[2].endsWith(","), true, "a line without a cost center leaves the column blank");
});

test("Xero-style narration repeats on every line so a changed narration starts the next journal", () => {
  const out = rows(buildJournalImport(journal, base({ templateHeader: xeroLike, accountBy: "code", signedAmount: "debit-positive", maxLinesPerJournal: 6 })).csv);
  const narrations = new Set(out.slice(1).map((row) => row.split(",")[0]));
  assert.deepEqual([...narrations], ["Payroll 2026-12-15 PAYROLL-12-1", "Payroll 2026-12-15 PAYROLL-12-2"]);
});

test("the module is pure and wired into no route or export", () => {
  const source = readFileSync("src/lib/accounting-journal-import.ts", "utf8");
  assert.ok(!/from "@\/db|from "\.\.\/db|writeFile|fetch\(|process\.env/.test(source));
  assert.match(source, /never hard-codes a package's headers/);
});
