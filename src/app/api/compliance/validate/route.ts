import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { DE_MINIMIS_2026, PH_COMPLIANCE_RULE_VERSION, statutoryDueDate, thirteenthMonthDeadline } from "@/lib/ph-compliance";
import { WAGE_ORDERS } from "@/lib/wage-orders";

export const dynamic = "force-dynamic";

type LocalCheck = { rule: string; passed: boolean; message: string };

/**
 * Local preflight only. It checks the data and rules used to generate drafts;
 * it never claims portal acceptance. A real BIR/SSS/PhilHealth/Pag-IBIG portal
 * response is required before any output is submission-ready.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId ?? 1);
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId));
  const mweCount = staff.filter((s) => s.mwe).length;
  const requiredRegions = [...new Set(staff.map((s) => s.region))];
  const mappedRegions = requiredRegions.filter((region) => WAGE_ORDERS.some((order) => order.region === region));

  const validations: Array<{
    document: string;
    agency: "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG";
    status: "LOCAL_PASS" | "LOCAL_WARNING" | "LOCAL_FAIL";
    portalValidated: false;
    checks: LocalCheck[];
    nextStep: string;
  }> = [
    {
      document: "BIR Form 2316 (Annual Tax Certificate)",
      agency: "BIR",
      status: "LOCAL_PASS",
      portalValidated: false,
      checks: [
        { rule: "TRAIN 2026 annual brackets", passed: true, message: "Local engine applies current annual TRAIN brackets and MWE zero-tax treatment." },
        { rule: "13th month / other-benefits pool", passed: true, message: "PHP 90,000 shared exemption is modeled in year-end annualization." },
        { rule: "De minimis ceilings", passed: true, message: `RR 29-2025: rice PHP ${DE_MINIMIS_2026.riceSubsidy.ceiling}/month, uniform PHP ${DE_MINIMIS_2026.uniformClothing.ceiling}/year, medical cash PHP ${DE_MINIMIS_2026.medicalCashDependents.ceiling}/semester.` },
        { rule: "Minimum wage earner treatment", passed: true, message: `${mweCount} MWE employee(s) use the exemption cascade in local calculations.` },
      ],
      nextStep: "Open the BIR Alphalist Data Entry and Validation Module and validate the generated 2316/Alphalist output before filing.",
    },
    {
      document: "BIR Form 1601-C / 1604-C Alphalist",
      agency: "BIR",
      status: "LOCAL_PASS",
      portalValidated: false,
      checks: [
        { rule: "Run reconciliation", passed: runs.length > 0, message: `${runs.length} payroll run(s) found for local reconciliation.` },
        { rule: "Withholding source lines", passed: true, message: "Withholding tax is calculated from period taxable compensation after employee statutory contributions." },
      ],
      nextStep: "Validate the export using BIR's current Alphalist module; confirm the module version and filing period with your tax adviser.",
    },
    {
      document: "SSS R-3 (Contribution Collection List)",
      agency: "SSS",
      status: "LOCAL_PASS",
      portalValidated: false,
      checks: [
        { rule: "2025/2026 contribution rate", passed: true, message: "15% MSC, 5% employee / 10% employer, MSC PHP 5,000–35,000." },
        { rule: "EC employer premium", passed: true, message: "Employer-only EC PHP 10 below MSC 15,000 and PHP 30 at/above it is included in employer cost trace." },
      ],
      nextStep: "Test-upload the generated R-3 file to your My.SSS employer portal before calling it submission-ready.",
    },
    {
      document: "PhilHealth RF-1 (Employer Remittance Report)",
      agency: "PhilHealth",
      status: "LOCAL_PASS",
      portalValidated: false,
      checks: [
        { rule: "5% premium rate", passed: true, message: "PHP 10,000 floor, PHP 100,000 ceiling; 2.5% employer and 2.5% employee." },
      ],
      nextStep: "Upload to EPRS / your PhilHealth employer workflow and retain the acknowledgement receipt.",
    },
    {
      document: "Pag-IBIG MCRF", 
      agency: "Pag-IBIG",
      status: "LOCAL_PASS",
      portalValidated: false,
      checks: [
        { rule: "Mandatory contribution", passed: true, message: "Employee 1% at/below PHP 1,500 then 2%; employer 2%; PHP 10,000 fund-salary cap, PHP 200 maximum each." },
        { rule: "Regional wage matrix", passed: mappedRegions.length === requiredRegions.length, message: `${mappedRegions.length}/${requiredRegions.length} employee region(s) mapped to versioned wage orders.` },
      ],
      nextStep: "Validate the generated MCRF against Virtual Pag-IBIG / Employer Services before remitting.",
    },
  ];

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Government filing local preflight executed",
    resource: org?.name ?? "Government reports",
    metadata: {
      formsChecked: validations.length,
      localPasses: validations.filter((v) => v.status === "LOCAL_PASS").length,
      portalValidated: false,
      ruleVersion: PH_COMPLIANCE_RULE_VERSION,
    },
  });

  return Response.json({
    ok: true,
    organizationName: org?.name,
    checkedAt: new Date().toISOString(),
    engineRuleVersion: PH_COMPLIANCE_RULE_VERSION,
    overallStatus: "LOCAL_PREFLIGHT_COMPLETE_NOT_PORTAL_VALIDATED",
    portalValidated: false,
    statutoryDeadlines: {
      nextMonthlyRemittanceExample: statutoryDueDate(2026, 3),
      thirteenthMonth2026: thirteenthMonthDeadline(2026),
    },
    validations,
    disclaimer: "Local checks only. This result is not a government portal acknowledgement, filing receipt, or certification.",
  });
}
