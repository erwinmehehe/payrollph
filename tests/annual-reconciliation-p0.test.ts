import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  yearEndAdjustments,
} from "../src/db/schema";
import { generateGovernmentDraft } from "../src/lib/exporters";
import { renderForm2316, type AnnualizationResult } from "../src/lib/annualization";
import { runYearEndAnnualization } from "../src/lib/year-end";

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

test("24-cutoff year reconciles immutable payroll, annualization, 1604-C source and 2316 draft for refund and collection cases", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Annual Reconciliation P0 QA",
    legalName: "Annual Reconciliation P0 QA Inc.",
    plan: "Core",
    birTin: "123456789",
    birBranchCode: "0001",
  }).returning();

  try {
    const [refundEmployee, collectEmployee] = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "ANNUAL-REFUND",
        firstName: "Annual",
        lastName: "Refund",
        title: "Associate",
        avatarInitials: "AR",
        basicRate: "50000.00",
        startDate: "2025-01-01",
        tin: "111111111",
        tinBranchCode: "0001",
      },
      {
        organizationId: org.id,
        employeeNo: "ANNUAL-COLLECT",
        firstName: "Annual",
        lastName: "Collect",
        title: "Associate",
        avatarInitials: "AC",
        basicRate: "50000.00",
        startDate: "2025-01-01",
        tin: "222222222",
        tinBranchCode: "0001",
      },
    ]).returning();

    let finalRunId = 0;

    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, "0");
      const last = lastDayOfMonth(2026, month);
      const cutoffs = [
        { suffix: "1-15", start: `2026-${mm}-01`, end: `2026-${mm}-15`, payDate: `2026-${mm}-15` },
        { suffix: "16-end", start: `2026-${mm}-16`, end: last, payDate: last },
      ];

      for (const cutoff of cutoffs) {
        const isFinalDecember = month === 12 && cutoff.suffix === "16-end";
        const thirteenth = isFinalDecember ? 50_000 : 0;
        const gross = 25_000 + thirteenth;

        const [run] = await db.insert(payrollRuns).values({
          organizationId: org.id,
          periodLabel: `2026-${mm} ${cutoff.suffix}`,
          periodStart: cutoff.start,
          periodEnd: cutoff.end,
          scopeLabel: "All locations",
          status: "Released",
          payDate: cutoff.payDate,
          employeeCount: 2,
          grossPay: (gross * 2).toFixed(2),
          netPay: "0.00",
          ruleVersion: "PH-2026.05",
        }).returning();
        finalRunId = run.id;

        for (const [employee, wht] of [
          [refundEmployee, 3_000],
          [collectEmployee, 1_000],
        ] as const) {
          const lineItems: Array<Record<string, unknown>> = [
            { code: "BASIC", label: "Basic / worked pay", amount: "25000.00" },
            { code: "SSS", label: "SSS contribution", amount: "-500.00" },
            { code: "PHIC", label: "PhilHealth contribution", amount: "-400.00" },
            { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: "-100.00" },
            { code: "WHT", label: "Withholding tax", amount: (-wht).toFixed(2) },
          ];
          if (thirteenth > 0) {
            lineItems.push({
              code: "EARN-13TH",
              label: "13th month pay",
              amount: thirteenth.toFixed(2),
              notes: ["Type: thirteenth_month"],
              benefitPool90k: true,
              benefitPoolKind: "thirteenth_month",
            });
          }

          const deductions = 1_000 + wht;
          await db.insert(payrollEntries).values({
            payrollRunId: run.id,
            employeeId: employee.id,
            grossPay: gross.toFixed(2),
            deductions: deductions.toFixed(2),
            netPay: (gross - deductions).toFixed(2),
            status: "Ready",
            lineItems,
            trace: { inputs: ["mweTaxableSupplementaryCompensation=0.00"] },
          });
        }
      }
    }

    assert.ok(finalRunId > 0);

    const summary = await runYearEndAnnualization(org.id, 2026, "P0 QA");
    assert.equal(summary.runsIncluded, 24);
    assert.equal(summary.employees, 2);
    assert.equal(summary.refunds, 1);
    assert.equal(summary.collections, 1);

    const adjustments = await db.select().from(yearEndAdjustments).where(and(
      eq(yearEndAdjustments.organizationId, org.id),
      eq(yearEndAdjustments.taxYear, 2026),
    ));
    assert.equal(adjustments.length, 2);

    const byEmployee = new Map(adjustments.map((row) => [row.employeeId, row]));
    const refund = byEmployee.get(refundEmployee.id);
    const collect = byEmployee.get(collectEmployee.id);
    assert.ok(refund);
    assert.ok(collect);

    for (const row of [refund!, collect!]) {
      assert.equal(Number(row.grossCompensation), 650_000);
      assert.equal(Number(row.thirteenthMonth), 50_000);
      assert.equal(Number(row.statutoryContributions), 24_000);
      assert.equal(Number(row.taxableIncome), 576_000);
      assert.equal(Number(row.taxDue), 57_700);
    }
    assert.equal(Number(refund!.taxWithheld), 72_000);
    assert.equal(Number(refund!.adjustment), -14_300);
    assert.equal(refund!.outcome, "refund");
    assert.equal(Number(collect!.taxWithheld), 24_000);
    assert.equal(Number(collect!.adjustment), 33_700);
    assert.equal(collect!.outcome, "collect");

    const annualSource = await generateGovernmentDraft(finalRunId, "bir-1604c-source");
    assert.match(annualSource.body, /"Refund","Annual"/);
    assert.match(annualSource.body, /"650000\.00","72000\.00"/);
    assert.match(annualSource.body, /"Collect","Annual"/);
    assert.match(annualSource.body, /"650000\.00","24000\.00"/);

    const refundResult = refund!.breakdown as AnnualizationResult;
    const collectResult = collect!.breakdown as AnnualizationResult;
    const refund2316 = renderForm2316({
      taxYear: 2026,
      employerName: org.legalName,
      employerTin: org.birTin ?? undefined,
      employeeName: `${refundEmployee.firstName} ${refundEmployee.lastName}`,
      employeeNo: refundEmployee.employeeNo,
      employeeTin: refundEmployee.tin ?? undefined,
      result: refundResult,
    });
    const collect2316 = renderForm2316({
      taxYear: 2026,
      employerName: org.legalName,
      employerTin: org.birTin ?? undefined,
      employeeName: `${collectEmployee.firstName} ${collectEmployee.lastName}`,
      employeeNo: collectEmployee.employeeNo,
      employeeTin: collectEmployee.tin ?? undefined,
      result: collectResult,
    });

    assert.match(refund2316, /Gross compensation income.*650,000\.00/);
    assert.match(refund2316, /Tax withheld January to December.*72,000\.00/);
    assert.match(refund2316, /REFUND TO EMPLOYEE.*14,300\.00/);
    assert.match(collect2316, /Tax withheld January to December.*24,000\.00/);
    assert.match(collect2316, /COLLECT FROM EMPLOYEE.*33,700\.00/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
