import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { generateGovernmentDraft } from "../src/lib/exporters";

test("PhilHealth draft uses the real PIN and full monthly premium", async () => {
  const [org] = await db.insert(organizations).values({
    name: "PhilHealth Export Test",
    legalName: "PhilHealth Export Test Inc.",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "EMP-001",
      firstName: "Ana",
      middleName: "M",
      lastName: "Reyes",
      title: "Staff",
      avatarInitials: "AR",
      basicRate: "30000",
      philHealthNo: "12-345678901-2",
      startDate: "2026-01-01",
    }).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "15000",
      deductions: "375",
      netPay: "14625",
      lineItems: [{ code: "PHIC", amount: "-375.00" }],
    });

    const file = await generateGovernmentDraft(run.id, "philhealth-rf1");
    const line = file.body.split("\n").find((row) => row.includes("Reyes"));
    assert.ok(line);
    assert.ok(line!.includes("12-345678901-2"));
    assert.ok(!line!.includes('"EMP-001"'), "internal employee number must never substitute for a PhilHealth PIN");
    assert.ok(line!.includes('"750.00"'), "employee monthly share at PHP 30,000 should be PHP 750");
    assert.ok(line!.includes('"1500.00"'), "total monthly premium should be PHP 1,500");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("Pag-IBIG draft uses the real MID and full monthly contribution", async () => {
  const [org] = await db.insert(organizations).values({
    name: "PagIBIG Export Test",
    legalName: "PagIBIG Export Test Inc.",
    pagIbigEmployerNo: "123456789012",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "EMP-002",
      firstName: "Mika",
      middleName: "L",
      lastName: "Santos",
      title: "Staff",
      avatarInitials: "MS",
      basicRate: "30000",
      pagIbigNo: "1234-5678-9012",
      startDate: "2026-01-01",
    }).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "15000",
      deductions: "100",
      netPay: "14900",
      lineItems: [{ code: "HDMF", amount: "-100.00" }],
    });

    const file = await generateGovernmentDraft(run.id, "pagibig-mcrf");
    const line = file.body.split("\n").find((row) => row.includes("Santos"));
    assert.ok(line);
    assert.ok(line!.includes("123456789012"));
    assert.ok(!line!.includes('"EMP-002"'), "internal employee number must never substitute for a Pag-IBIG MID");
    const fields = [...line!.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    assert.equal(fields[2], "F1");
    assert.equal(fields[7], "202609");
    assert.equal(fields[8], "200.00", "employee monthly share should be PHP 200");
    assert.equal(fields[9], "200.00", "employer monthly share should be PHP 200");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("government drafts fail closed when agency member IDs are missing", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Missing IDs Test",
    legalName: "Missing IDs Test Inc.",
    pagIbigEmployerNo: "123456789012",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "EMP-003",
      firstName: "No",
      lastName: "Ids",
      title: "Staff",
      avatarInitials: "NI",
      basicRate: "30000",
      startDate: "2026-01-01",
    }).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "15000",
      deductions: "0",
      netPay: "15000",
    });

    await assert.rejects(() => generateGovernmentDraft(run.id, "sss-r3"), /missing an SSS number/);
    await assert.rejects(() => generateGovernmentDraft(run.id, "philhealth-rf1"), /missing a PhilHealth PIN/);
    await assert.rejects(() => generateGovernmentDraft(run.id, "pagibig-mcrf"), /missing a Pag-IBIG MID/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
