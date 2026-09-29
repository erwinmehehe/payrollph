import assert from "node:assert/strict";
import test from "node:test";
import { MIGRATION_TEMPLATE_HEADERS, parseMigrationCsv } from "../src/lib/migration-import";
import { xlsxToCsv } from "../src/lib/xlsx-import";

test("Sprout employee export aliases map into the canonical employee shape", () => {
  const result = parseMigrationCsv({
    source: "sprout",
    kind: "employees",
    csv: [
      "Employee ID,First Name,Last Name,Employment Status,Basic Salary,Email Address,Hire Date,TIN,SSS Number,PhilHealth PIN,Pag-IBIG No",
      "SP-001,Ana,Reyes,Regular,35000,ana@example.com,01/15/2024,123-456-789,12-3456789-0,12-345678901-2,1234-5678-9012",
    ].join("\n"),
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0] as { employeeNo: string; monthlyBasic: number; status: string; tin: string | null; startDate: string | null };
  assert.equal(row.employeeNo, "SP-001");
  assert.equal(row.monthlyBasic, 35000);
  assert.equal(row.status, "Active");
  assert.equal(row.tin, "123456789");
  assert.equal(row.startDate, "2024-01-15");
});

test("inactive competitor statuses migrate into the non-active payroll cohort", () => {
  const result = parseMigrationCsv({
    source: "sprout",
    kind: "employees",
    csv: "Employee ID,First Name,Last Name,Employment Status,Basic Salary\nSP-2,Juan,Cruz,Resigned,25000\n",
  });

  const row = result.rows[0] as { status: string };
  assert.equal(row.status, "Separating");
});

test("GreatDay-style full name exports can be split when first/last columns are absent", () => {
  const result = parseMigrationCsv({
    source: "greatday",
    kind: "employees",
    csv: "Employee ID,Employee Name,Basic Salary\nGD-1,Maria Santos,42000\n",
  });

  assert.equal(result.errors.length, 0);
  const row = result.rows[0] as { firstName: string; lastName: string };
  assert.equal(row.firstName, "Maria");
  assert.equal(row.lastName, "Santos");
});

test("historical payroll imports preserve YTD components instead of recalculating them", () => {
  const result = parseMigrationCsv({
    source: "sprout",
    kind: "payroll_history",
    csv: [
      "Employee ID,Pay Date,Payroll Period,Gross Pay,Basic Salary Earned,Net Pay,Withholding Tax,SSS Contribution,PhilHealth Contribution,Pag-IBIG Contribution,13th Month Pay",
      "SP-001,2026-06-30,June 2,40000,30000,33500,2500,900,500,100,0",
    ].join("\n"),
  });

  assert.equal(result.errors.length, 0);
  const row = result.rows[0] as {
    employeeNo: string;
    payDate: string;
    grossPay: number;
    basicSalary: number;
    taxWithheld: number;
    sssEmployee: number;
    philHealthEmployee: number;
    pagIbigEmployee: number;
  };
  assert.equal(row.employeeNo, "SP-001");
  assert.equal(row.payDate, "2026-06-30");
  assert.equal(row.grossPay, 40000);
  assert.equal(row.basicSalary, 30000);
  assert.equal(row.taxWithheld, 2500);
  assert.equal(row.sssEmployee, 900);
  assert.equal(row.philHealthEmployee, 500);
  assert.equal(row.pagIbigEmployee, 100);
});

test("Salarium-style leave balances and generic loans parse into opening balances", () => {
  const leave = parseMigrationCsv({
    source: "salarium",
    kind: "leave_balances",
    csv: "Employee ID,Leave Type,Year,Opening Balance,Accrued,Used,Pending\nE-1,Vacation,2026,5,10,3,1\n",
  });
  assert.equal(leave.errors.length, 0);
  assert.equal((leave.rows[0] as { opening: number }).opening, 5);

  const loan = parseMigrationCsv({
    source: "generic",
    kind: "loans",
    csv: "Employee No,Loan Type,Loan Number,Original Amount,Outstanding Balance,Monthly Deduction\nE-1,SSS Salary Loan,SSS-123,20000,12000,2000\n",
  });
  assert.equal(loan.errors.length, 0);
  const row = loan.rows[0] as { referenceNo: string; remainingBalance: number; monthlyAmortization: number; cutoffDeduction: number };
  assert.equal(row.referenceNo, "SSS-123");
  assert.equal(row.remainingBalance, 12000);
  assert.equal(row.monthlyAmortization, 2000);
  assert.equal(row.cutoffDeduction, 1000);
});

test("unknown columns stay visible to the user instead of disappearing silently", () => {
  const result = parseMigrationCsv({
    source: "generic",
    kind: "employees",
    csv: "Employee ID,First Name,Last Name,Basic Salary,Custom Cost Center\nE-9,Pat,Lim,30000,North\n",
  });

  assert.ok(result.unmappedColumns.includes("Custom Cost Center"));
  assert.equal(result.mappings.employeeNo, "Employee ID");
  assert.equal(result.mappings.monthlyBasic, "Basic Salary");
});


function le16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function le32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function storedZip(entries: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const local = Buffer.concat([
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(data.length),
      le32(data.length),
      le16(nameBytes.length),
      le16(0),
      nameBytes,
      data,
    ]);
    locals.push(local);

    centrals.push(Buffer.concat([
      le32(0x02014b50),
      le16(20),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(data.length),
      le32(data.length),
      le16(nameBytes.length),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(localOffset),
      nameBytes,
    ]));
    localOffset += local.length;
  }

  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(centrals.length),
    le16(centrals.length),
    le32(central.length),
    le32(localOffset),
    le16(0),
  ]);

  return new Uint8Array(Buffer.concat([...locals, central, end]));
}

function excelDateSerial(year: number, month: number, day: number) {
  const days = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 31)) / 86_400_000);
  return days >= 60 ? days + 1 : days;
}

test("modern XLSX migration exports are converted from the first worksheet, including Excel date cells", () => {
  const serial = excelDateSerial(2024, 1, 15);
  const workbook = storedZip({
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Employees" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1">
        <c r="A1" t="inlineStr"><is><t>Employee ID</t></is></c>
        <c r="B1" t="inlineStr"><is><t>First Name</t></is></c>
        <c r="C1" t="inlineStr"><is><t>Last Name</t></is></c>
        <c r="D1" t="inlineStr"><is><t>Basic Salary</t></is></c>
        <c r="E1" t="inlineStr"><is><t>Hire Date</t></is></c>
      </row>
      <row r="2">
        <c r="A2" t="inlineStr"><is><t>XL-001</t></is></c>
        <c r="B2" t="inlineStr"><is><t>Ana</t></is></c>
        <c r="C2" t="inlineStr"><is><t>Reyes</t></is></c>
        <c r="D2"><v>35000</v></c>
        <c r="E2" s="1"><v>${serial}</v></c>
      </row>
    </sheetData></worksheet>`,
  });

  const csv = xlsxToCsv(workbook);
  const result = parseMigrationCsv({ source: "sprout", kind: "employees", csv });

  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0] as { employeeNo: string; monthlyBasic: number; startDate: string | null };
  assert.equal(row.employeeNo, "XL-001");
  assert.equal(row.monthlyBasic, 35000);
  assert.equal(row.startDate, "2024-01-15");
  assert.deepEqual(result.rowLines, [2]);
});

test("migration templates expose canonical headers for every supported dataset", () => {
  assert.ok(MIGRATION_TEMPLATE_HEADERS.employees.includes("Employee ID"));
  assert.ok(MIGRATION_TEMPLATE_HEADERS.payroll_history.includes("Withholding Tax"));
  assert.ok(MIGRATION_TEMPLATE_HEADERS.leave_balances.includes("Opening Balance"));
  assert.ok(MIGRATION_TEMPLATE_HEADERS.loans.includes("Outstanding Balance"));
});

test("valid migration rows retain their original source line numbers", () => {
  const result = parseMigrationCsv({
    source: "generic",
    kind: "employees",
    csv: [
      "Employee ID,First Name,Last Name,Basic Salary",
      "E-1,Ana,Reyes,30000",
      "E-2,Ben,Cruz,32000",
    ].join("\n"),
  });

  assert.deepEqual(result.rowLines, [2, 3]);
});
