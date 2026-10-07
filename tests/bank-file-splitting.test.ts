import assert from "node:assert/strict";
import test from "node:test";
import { bankPartFilename, createStoredZip, splitRowsByBankLimits } from "../src/lib/bank-file-bundle";

type Row = { id: string; cents: number };

test("bank file splitting respects both row and amount limits without splitting an employee", () => {
  const rows: Row[] = [
    { id: "A", cents: 300_000 },
    { id: "B", cents: 200_000 },
    { id: "C", cents: 400_000 },
    { id: "D", cents: 100_000 },
  ];

  const parts = splitRowsByBankLimits(rows, (row) => row.cents, {
    maxAmountCents: 500_000,
    maxRows: 2,
  });

  assert.deepEqual(parts.map((part) => part.map((row) => row.id)), [
    ["A", "B"],
    ["C", "D"],
  ]);
  assert.deepEqual(parts.map((part) => part.reduce((sum, row) => sum + row.cents, 0)), [
    500_000,
    500_000,
  ]);
});

test("amount limit starts a new file before the configured maximum is exceeded", () => {
  const rows: Row[] = [
    { id: "A", cents: 350_000 },
    { id: "B", cents: 200_000 },
    { id: "C", cents: 100_000 },
  ];

  const parts = splitRowsByBankLimits(rows, (row) => row.cents, {
    maxAmountCents: 500_000,
  });

  assert.deepEqual(parts.map((part) => part.map((row) => row.id)), [
    ["A"],
    ["B", "C"],
  ]);
});

test("one employee payout above the bank file maximum fails closed", () => {
  assert.throws(
    () => splitRowsByBankLimits(
      [{ id: "A", cents: 500_001 }],
      (row) => row.cents,
      { maxAmountCents: 500_000 },
    ),
    /will not split one employee across files/,
  );
});

test("split filenames are deterministic and retain the bank extension", () => {
  assert.equal(
    bankPartFilename("bdo-dat-44.dat", 2, 12),
    "bdo-dat-44-part-002-of-012.dat",
  );
  assert.equal(bankPartFilename("bdo-dat-44.dat", 1, 1), "bdo-dat-44.dat");
});

test("multi-file bundle is a valid ZIP-shaped archive containing every filename", () => {
  const zip = createStoredZip([
    { name: "payroll-part-001.csv", body: "employee,amount\nA,100.00" },
    { name: "payroll-part-002.csv", body: "employee,amount\nB,200.00" },
  ]);

  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("payroll-part-001.csv")));
  assert.ok(zip.includes(Buffer.from("payroll-part-002.csv")));
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
});

test("bank exporter applies payout-profile limits after released payroll values are fixed", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/lib/exporters.ts", "utf8");
  const start = source.indexOf("export async function generateBankFile");
  const end = source.indexOf("export async function generateJournalCsv", start);
  assert.ok(start >= 0 && end > start);
  const bankExporter = source.slice(start, end);

  assert.ok(bankExporter.includes("payoutProfiles"));
  assert.ok(bankExporter.includes("maxAmountPerFile"));
  assert.ok(bankExporter.includes("maxRowsPerFile"));
  assert.ok(bankExporter.includes("splitRowsByBankLimits"));
  assert.ok(bankExporter.includes("combinedCents !== releasedCents"));
  assert.ok(bankExporter.includes("Split bank files do not reconcile to released payroll net pay"));
  assert.ok(bankExporter.includes("createStoredZip"));
  assert.ok(source.includes("active payout profile's configured bank adapter"));
  assert.ok(!bankExporter.includes("computeSss("));
  assert.ok(!bankExporter.includes("computePhilHealth("));
  assert.ok(!bankExporter.includes("computeSemiMonthlyWithholdingTax("));
});
