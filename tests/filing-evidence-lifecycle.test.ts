import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, legalEntities, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { findFilingForm, parseFilingOutcome } from "../src/lib/filing-evidence";
import {
  filingEvidenceSummaries,
  getFilingValidation,
  recordFilingOutcome,
  recordGeneratedFiling,
  regenerateRecordedFile,
} from "../src/lib/filing-evidence-store";

const SSS = findFilingForm("SSS", "R-3")!;

async function seedRun(name: string, basicRate = "30000") {
  const [org] = await db.insert(organizations).values({ name, legalName: `${name} Inc.`, plan: "Core" }).returning();
  const [legalEntity] = await db.insert(legalEntities).values({
    organizationId: org.id,
    code: "PRIMARY",
    legalName: `${name} Inc.`,
    displayName: name,
    primaryEntity: true,
    active: true,
  }).returning();
  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    legalEntityId: legalEntity.id,
    employeeNo: "F-001",
    firstName: "Rico",
    middleName: "M",
    lastName: "Bautista",
    title: "Staff",
    avatarInitials: "RB",
    sssNo: "34-1234567-8",
    basicRate,
    startDate: "2026-01-01",
  }).returning();
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    legalEntityId: legalEntity.id,
    periodLabel: "Sep 2026",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    payDate: "2026-09-30",
    status: "Released",
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: run.id,
    employeeId: employee.id,
    grossPay: basicRate,
    deductions: "0",
    netPay: basicRate,
  });
  return { org, legalEntity, employee, run };
}

function acceptance(method: "file_upload" | "manual_entry" = "file_upload") {
  const parsed = parseFilingOutcome({
    outcome: "accepted",
    submissionMethod: method,
    agencyReference: "PRN-7654321",
    submittedAt: new Date().toISOString(),
  });
  assert.ok(parsed.ok);
  return parsed.ok ? parsed.value : (undefined as never);
}

test("a filing is recorded by hash, can be accepted once, and then counts as proof", async () => {
  const { org, run } = await seedRun("Filing Evidence Co");
  try {
    const first = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester" });
    assert.equal(first.created, true);
    assert.equal(first.record.status, "generated");
    assert.match(first.record.fileSha256, /^[0-9a-f]{64}$/);

    // Same unchanged data: same record, not a duplicate.
    const again = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester" });
    assert.equal(again.created, false);
    assert.equal(again.record.id, first.record.id);

    // The download is byte-identical to what was hashed.
    const file = await regenerateRecordedFile(first.record);
    assert.equal(file.body, first.file.body);

    const before = (await filingEvidenceSummaries()).find((item) => item.definition.form === "R-3")!;
    const beforeCount = before.provingCount;

    const recorded = await recordFilingOutcome({ organizationId: org.id, id: first.record.id, actor: "Tester", outcome: acceptance() });
    assert.equal(recorded?.status, "accepted");
    assert.equal(recorded?.agencyReference, "PRN-7654321");

    const after = (await filingEvidenceSummaries()).find((item) => item.definition.form === "R-3")!;
    assert.equal(after.proven, true);
    assert.equal(after.provingCount, beforeCount + 1);

    // An accepted record can never be edited or flipped.
    const second = await recordFilingOutcome({ organizationId: org.id, id: first.record.id, actor: "Someone", outcome: acceptance() });
    assert.equal(second, null);
    const rejected = parseFilingOutcome({ outcome: "rejected", submissionMethod: "file_upload", note: "changed my mind" });
    assert.ok(rejected.ok);
    assert.equal(await recordFilingOutcome({ organizationId: org.id, id: first.record.id, actor: "Someone", outcome: rejected.ok ? rejected.value : (undefined as never) }), null);
    assert.equal((await getFilingValidation(org.id, first.record.id))?.recordedBy, "Tester");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a manual entry is recorded but does not count as proof of the file format", async () => {
  const { org, run } = await seedRun("Filing Manual Co");
  try {
    const { record } = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester" });
    const before = (await filingEvidenceSummaries()).find((item) => item.definition.form === "R-3")!;
    await recordFilingOutcome({ organizationId: org.id, id: record.id, actor: "Tester", outcome: acceptance("manual_entry") });
    const after = (await filingEvidenceSummaries()).find((item) => item.definition.form === "R-3")!;
    assert.equal(after.provingCount, before.provingCount, "retyped figures must not count");
    assert.equal(after.acceptedByManualEntry, before.acceptedByManualEntry + 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a record cannot be resolved or downloaded from another workspace", async () => {
  const a = await seedRun("Filing Tenant A");
  const b = await seedRun("Filing Tenant B");
  try {
    const { record } = await recordGeneratedFiling({ organizationId: a.org.id, runId: a.run.id, definition: SSS, actor: "Tester" });

    assert.equal(await getFilingValidation(b.org.id, record.id), null);
    assert.equal(await recordFilingOutcome({ organizationId: b.org.id, id: record.id, actor: "Intruder", outcome: acceptance() }), null);
    assert.equal((await getFilingValidation(a.org.id, record.id))?.status, "generated", "the other workspace must not have changed it");

    // And a run from another workspace cannot be filed under this one.
    await assert.rejects(
      recordGeneratedFiling({ organizationId: a.org.id, runId: b.run.id, definition: SSS, actor: "Tester" }),
      /not found in this workspace/,
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, a.org.id));
    await db.delete(organizations).where(eq(organizations.id, b.org.id));
  }
});

test("if payroll data changes after a record is made, its file is refused instead of re-hashed", async () => {
  const { org, employee, run } = await seedRun("Filing Drift Co");
  try {
    const { record } = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester" });
    await db.update(employees).set({ basicRate: "12000" }).where(eq(employees.id, employee.id));
    await assert.rejects(regenerateRecordedFile(record), /no longer matches/);

    // A new record is created for the new bytes, leaving the old one untouched.
    const fresh = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester" });
    assert.equal(fresh.created, true);
    assert.notEqual(fresh.record.fileSha256, record.fileSha256);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("retired BIR 1604-C per-run evidence cannot be minted as official filing proof", async () => {
  const { org, run } = await seedRun("Filing BIR Legacy Guard Co");
  const bir = findFilingForm("BIR", "1604-C")!;
  try {
    await assert.rejects(
      () => recordGeneratedFiling({
        organizationId: org.id,
        runId: run.id,
        definition: bir,
        actor: "Tester",
      }),
      /per-run filing evidence is retired/,
    );
    const summary = (await filingEvidenceSummaries())
      .find((item) => item.definition.agency === "BIR" && item.definition.form === "1604-C")!;
    assert.equal(summary.provingCount, 0, "BIR source-only evidence does not prove DAT acceptance");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a PhilHealth RF-1 record fails closed without a PIN, then counts only for PhilHealth", async () => {
  const { org, employee, run } = await seedRun("Filing PhilHealth Co");
  const PH = findFilingForm("PhilHealth", "RF-1")!;
  try {
    await assert.rejects(
      recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: PH, actor: "Tester" }),
      /missing a PhilHealth PIN/,
    );
    await db.update(employees).set({ philHealthNo: "12-345678901-2" }).where(eq(employees.id, employee.id));

    const before = await filingEvidenceSummaries();
    const phBefore = before.find((item) => item.definition.agency === "PhilHealth")!;
    const sssBefore = before.find((item) => item.definition.agency === "SSS")!;

    const { record, file } = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: PH, actor: "Tester" });
    assert.equal(record.agency, "PhilHealth");
    assert.equal(record.form, "RF-1");
    assert.match(file.filename, /^philhealth-eprs-rf1-worksheet-/);

    // A typed-in filing is kept but does not count.
    const manual = await recordFilingOutcome({ organizationId: org.id, id: record.id, actor: "Tester", outcome: acceptance("manual_entry") });
    assert.equal(manual?.status, "accepted");
    const mid = (await filingEvidenceSummaries()).find((item) => item.definition.agency === "PhilHealth")!;
    assert.equal(mid.provingCount, phBefore.provingCount);
    assert.equal(mid.acceptedByManualEntry, phBefore.acceptedByManualEntry + 1);

    // Changing a figure creates a new record; accepting that one as an upload counts for PhilHealth only.
    await db.update(employees).set({ basicRate: "18000" }).where(eq(employees.id, employee.id));
    const second = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: PH, actor: "Tester" });
    assert.equal(second.created, true);
    await recordFilingOutcome({ organizationId: org.id, id: second.record.id, actor: "Tester", outcome: acceptance("file_upload") });

    const after = await filingEvidenceSummaries();
    assert.equal(after.find((item) => item.definition.agency === "PhilHealth")!.provingCount, phBefore.provingCount + 1);
    assert.equal(after.find((item) => item.definition.agency === "SSS")!.provingCount, sssBefore.provingCount);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a Pag-IBIG MCRF record fails closed without a MID, then counts only for Pag-IBIG", async () => {
  const { org, employee, run } = await seedRun("Filing PagIBIG Co");
  const PI = findFilingForm("Pag-IBIG", "MCRF")!;
  try {
    await assert.rejects(
      recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: PI, actor: "Tester" }),
      /missing a Pag-IBIG MID/,
    );
    await db.update(employees).set({ pagIbigNo: "1234-5678-9012" }).where(eq(employees.id, employee.id));

    const before = await filingEvidenceSummaries();
    const piBefore = before.find((item) => item.definition.agency === "Pag-IBIG")!;
    const othersBefore = before.filter((item) => item.definition.agency !== "Pag-IBIG").map((item) => item.provingCount);

    const { record, file } = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: PI, actor: "Tester" });
    assert.equal(record.agency, "Pag-IBIG");
    assert.equal(record.form, "MCRF");
    assert.match(file.filename, /^pagibig-mcrf-esrs-worksheet-/);

    // A rejection needs a reason and is kept; it never counts.
    const rejected = parseFilingOutcome({ outcome: "rejected", submissionMethod: "file_upload", note: "Header row not recognised" });
    assert.ok(rejected.ok);
    const resolved = await recordFilingOutcome({ organizationId: org.id, id: record.id, actor: "Tester", outcome: rejected.ok ? rejected.value : (undefined as never) });
    assert.equal(resolved?.status, "rejected");
    assert.equal((await filingEvidenceSummaries()).find((item) => item.definition.agency === "Pag-IBIG")!.rejected, piBefore.rejected + 1);

    // Correct the member ID so the regenerated MCRF bytes actually change; accepting that upload counts for Pag-IBIG only.
    await db.update(employees).set({ pagIbigNo: "9876-5432-1098" }).where(eq(employees.id, employee.id));
    const second = await recordGeneratedFiling({ organizationId: org.id, runId: run.id, definition: PI, actor: "Tester" });
    assert.equal(second.created, true);
    await recordFilingOutcome({ organizationId: org.id, id: second.record.id, actor: "Tester", outcome: acceptance("file_upload") });

    const after = await filingEvidenceSummaries();
    assert.equal(after.find((item) => item.definition.agency === "Pag-IBIG")!.provingCount, piBefore.provingCount + 1);
    assert.deepEqual(after.filter((item) => item.definition.agency !== "Pag-IBIG").map((item) => item.provingCount), othersBefore);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
