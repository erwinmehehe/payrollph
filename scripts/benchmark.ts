import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employees, organizations, orgUnits, payrollEntries, payrollJobs, payrollRuns, payslips, timePunches } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

const SIZES = (process.env.BENCH_SIZES ?? "50,500,3000").split(",").map((value) => Number(value.trim())).filter(Boolean);
const CHUNK = Number(process.env.BENCH_CHUNK ?? 250);

async function seedOrg(size: number) {
  const [org] = await db.insert(organizations).values({
    name: `Benchmark ${size}`,
    legalName: `Benchmark Corp ${size}`,
    accountType: "enterprise",
    plan: "Enterprise",
    employeeCount: size,
    color: "#123c35",
  }).returning();

  const [unit] = await db.insert(orgUnits).values({
    organizationId: org.id,
    type: "Branch",
    name: "Benchmark Branch",
    code: "BEN",
  }).returning();

  const batch = 1000;
  for (let start = 0; start < size; start += batch) {
    const slice = Math.min(batch, size - start);
    await db.insert(employees).values(Array.from({ length: slice }, (_, i) => {
      const n = start + i;
      return {
        organizationId: org.id,
        orgUnitId: unit.id,
        employeeNo: `BM-${String(n).padStart(6, "0")}`,
        firstName: `Employee${n}`,
        lastName: "Benchmark",
        title: "Associate",
        avatarInitials: "EB",
        status: "Active",
        employmentType: "Regular",
        basicRate: (20000 + (n % 20) * 1000).toFixed(2),
        mwe: false,
        startDate: "2024-01-15",
      };
    }));
  }

  return org;
}

async function cleanup(orgIds: number[]) {
  if (!orgIds.length) return;
  const runs = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(inArray(payrollRuns.organizationId, orgIds));
  const runIds = runs.map((run) => run.id);
  if (runIds.length) {
    await db.delete(payslips).where(inArray(payslips.organizationId, orgIds));
    await db.delete(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds));
    await db.delete(payrollJobs).where(inArray(payrollJobs.payrollRunId, runIds));
    await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
  }
  await db.delete(timePunches).where(inArray(timePunches.organizationId, orgIds));
  await db.delete(employees).where(inArray(employees.organizationId, orgIds));
  await db.delete(orgUnits).where(inArray(orgUnits.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}

async function main() {
  const created: number[] = [];
  const results: Array<{ size: number; seedMs: number; processMs: number; perEmployeeMs: number; chunks: number; employeesPerSecond: number }> = [];

  try {
    for (const size of SIZES) {
      const seedStart = Date.now();
      const org = await seedOrg(size);
      created.push(org.id);
      const seedMs = Date.now() - seedStart;

      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id,
        periodLabel: `Benchmark ${size}`,
        periodStart: "2026-03-16",
        periodEnd: "2026-03-31",
        scopeLabel: "All locations",
        status: "Draft",
        payDate: "2026-03-31",
      }).returning();

      await enqueuePayrollRun(run.id, CHUNK);
      const processStart = Date.now();
      const drained = await drainPayrollQueue(10_000);
      const processMs = Date.now() - processStart;

      const [final] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));

      results.push({
        size,
        seedMs,
        processMs,
        perEmployeeMs: Number((processMs / size).toFixed(2)),
        chunks: final.totalChunks,
        employeesPerSecond: Number((size / (processMs / 1000)).toFixed(1)),
      });

      console.log(`size=${size} status=${final.status} employees=${final.employeeCount} chunks=${final.totalChunks} processMs=${processMs} gross=${final.grossPay} drainCalls=${drained.length}`);
    }

    console.log("\n=== BENCHMARK RESULTS ===");
    console.table(results);
  } finally {
    await cleanup(created);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
