import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { DE_MINIMIS_2026, PH_COMPLIANCE_RULE_VERSION, statutoryDueDate, thirteenthMonthDeadline } from "@/lib/ph-compliance";
import { WAGE_ORDERS } from "@/lib/wage-orders";

export const dynamic = "force-dynamic";

type LocalCheck = { rule: string; passed: boolean; message: string };

function statusOf(checks: LocalCheck[]): "LOCAL_PASS" | "LOCAL_WARNING" | "LOCAL_FAIL" {
  if (checks.every((check) => check.passed)) return "LOCAL_PASS";
  return checks.some((check) => check.passed) ? "LOCAL_WARNING" : "LOCAL_FAIL";
}

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

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
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can run government filing preflight.",
  );
  if (denied) return denied;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return Response.json({ error: "Organization not found." }, { status: 404 });

  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId));
  const mweCount = staff.filter((employee) => employee.mwe).length;
  const requiredRegions = [...new Set(staff.map((employee) => employee.region))];
  const mappedRegions = requiredRegions.filter((region) => WAGE_ORDERS.some((order) => order.region === region));

  const birTin = digits(org.birTin);
  const birBranchCode = digits(org.birBranchCode).padStart(4, "0").slice(-4);
  const missingEmployeeTin = staff.filter((employee) => digits(employee.tin).length !== 9);
  const missingEmployeeTinBranch = staff.filter((employee) => digits(employee.tinBranchCode).length !== 4);
  const missingMiddleName = staff.filter((employee) => !employee.middleName?.trim());
  const missingSss = staff.filter((employee) => !employee.sssNo?.trim());
  const missingPhilHealth = staff.filter((employee) => !employee.philHealthNo?.trim());
  const missingPagIbig = staff.filter((employee) => !employee.pagIbigNo?.trim());
  const employerSssReady = Boolean(org.sssEmployerNo?.trim());
  const employerPhilHealthReady = Boolean(org.philHealthEmployerNo?.trim());
  const employerPagIbigReady = Boolean(org.pagIbigEmployerNo?.trim());

  const bir2316Checks: LocalCheck[] = [
    {
      rule: "Employer BIR identity",
      passed: birTin.length === 9 && birBranchCode.length === 4,
      message: birTin.length === 9
        ? `Employer TIN/branch is structurally ready (${birTin}-${birBranchCode}).`
        : "BIR Alphalist needs a 9-digit employer TIN and 4-digit branch code before an ADES file can be generated.",
    },
    {
      rule: "Employee TIN completeness",
      passed: missingEmployeeTin.length === 0,
      message: missingEmployeeTin.length === 0
        ? `All ${staff.length} employee TINs are present as 9 digits.`
        : `${missingEmployeeTin.length} employee(s) are missing a valid 9-digit TIN: ${missingEmployeeTin.slice(0, 8).map((employee) => employee.employeeNo).join(", ")}.`,
    },
    {
      rule: "Employee BIR branch codes",
      passed: missingEmployeeTinBranch.length === 0,
      message: missingEmployeeTinBranch.length === 0
        ? "All employee BIR branch codes are stored separately as 4 digits."
        : `${missingEmployeeTinBranch.length} employee(s) are missing a 4-digit BIR branch code: ${missingEmployeeTinBranch.slice(0, 8).map((employee) => employee.employeeNo).join(", ")}.`,
    },
    {
      rule: "1604-C name fields",
      passed: missingMiddleName.length === 0,
      message: missingMiddleName.length === 0
        ? "First, middle, and last name fields are available for all employees."
        : `${missingMiddleName.length} employee(s) have no middle-name value. BIR 1604-C Annex A defines a separate middle-name field; confirm whether blank is valid for each person before filing.`,
    },
    {
      rule: "TRAIN annual brackets",
      passed: true,
      message: "Local engine applies annual TRAIN brackets and MWE zero-tax treatment.",
    },
    {
      rule: "13th month / other-benefits pool",
      passed: true,
      message: "PHP 90,000 shared exemption is modeled in year-end annualization.",
    },
    {
      rule: "De minimis ceilings",
      passed: true,
      message: `RR 29-2025 values are modeled, including rice PHP ${DE_MINIMIS_2026.riceSubsidy.ceiling}/month.`,
    },
    {
      rule: "Minimum wage earner treatment",
      passed: true,
      message: `${mweCount} MWE employee(s) use the exemption cascade in local calculations.`,
    },
  ];

  const birAlphalistChecks: LocalCheck[] = [
    ...bir2316Checks.slice(0, 3),
    {
      rule: "Exact 1604-C submission file",
      passed: false,
      message: "Not filing-ready. Linaw exposes an annual source extract and requires validation in the current BIR Alphalist workflow before any output can be called submission-ready.",
    },
    {
      rule: "Run reconciliation",
      passed: runs.length > 0,
      message: `${runs.length} payroll run(s) found for reconciliation.`,
    },
    {
      rule: "ADES portal acceptance",
      passed: false,
      message: "Not yet proven. A generated annual file must still pass the current BIR Alphalist Data Entry and Validation Module before this can be called filing-ready.",
    },
  ];

  const sssChecks: LocalCheck[] = [
    {
      rule: "Employer SSS number",
      passed: employerSssReady,
      message: employerSssReady ? "Employer SSS number is on file." : "Employer SSS number is missing from the organization profile.",
    },
    {
      rule: "Employee SSS numbers",
      passed: missingSss.length === 0,
      message: missingSss.length === 0
        ? `All ${staff.length} employees have an SSS number.`
        : `${missingSss.length} employee(s) are missing an SSS number: ${missingSss.slice(0, 8).map((employee) => employee.employeeNo).join(", ")}.`,
    },
    {
      rule: "Monthly contribution basis",
      passed: true,
      message: "R-3 draft recomputes the full monthly SSS contribution and EC from monthly basic salary instead of reusing one semi-monthly deduction.",
    },
    {
      rule: "2026 contribution engine",
      passed: true,
      message: "15% MSC total is modeled as 5% employee / 10% employer, plus employer-only EC.",
    },
    {
      rule: "My.SSS e-CL / R-3 acceptance",
      passed: false,
      message: "Not portal-proven. The SSS worksheet remains assisted output until a real employer workflow accepts the remittance data.",
    },
  ];

  const philHealthChecks: LocalCheck[] = [
    {
      rule: "Employer PhilHealth number",
      passed: employerPhilHealthReady,
      message: employerPhilHealthReady ? "Employer PhilHealth number is on file." : "Employer PhilHealth number is missing from the organization profile.",
    },
    {
      rule: "PhilHealth PIN completeness",
      passed: missingPhilHealth.length === 0,
      message: missingPhilHealth.length === 0
        ? `All ${staff.length} employees have a PhilHealth PIN.`
        : `${missingPhilHealth.length} employee(s) are missing a PhilHealth PIN: ${missingPhilHealth.slice(0, 8).map((employee) => employee.employeeNo).join(", ")}.`,
    },
    {
      rule: "Monthly premium basis",
      passed: true,
      message: "RF-1 draft recomputes full monthly employee and employer shares rather than exporting one cutoff amount.",
    },
    {
      rule: "5% premium engine",
      passed: true,
      message: "PHP 10,000 floor, PHP 100,000 ceiling; employee and employer split equally.",
    },
    {
      rule: "EPRS acceptance",
      passed: false,
      message: "Not portal-proven. The PhilHealth worksheet remains assisted output until the employer EPRS flow accepts the remittance data.",
    },
  ];

  const pagIbigChecks: LocalCheck[] = [
    {
      rule: "Employer Pag-IBIG number",
      passed: employerPagIbigReady,
      message: employerPagIbigReady ? "Employer Pag-IBIG number is on file." : "Employer Pag-IBIG employer ID is missing from the organization profile.",
    },
    {
      rule: "Pag-IBIG MID completeness",
      passed: missingPagIbig.length === 0,
      message: missingPagIbig.length === 0
        ? `All ${staff.length} employees have a Pag-IBIG MID.`
        : `${missingPagIbig.length} employee(s) are missing a Pag-IBIG MID: ${missingPagIbig.slice(0, 8).map((employee) => employee.employeeNo).join(", ")}.`,
    },
    {
      rule: "Monthly contribution basis",
      passed: true,
      message: "MCRF/eSRS draft recomputes the full monthly employee and employer contribution from monthly basic salary.",
    },
    {
      rule: "Mandatory contribution engine",
      passed: true,
      message: "Employee 1% at/below PHP 1,500 then 2%; employer 2%; PHP 10,000 fund-salary cap.",
    },
    {
      rule: "Regional wage matrix",
      passed: mappedRegions.length === requiredRegions.length,
      message: `${mappedRegions.length}/${requiredRegions.length} employee region(s) mapped to versioned wage orders.`,
    },
    {
      rule: "MCRF / eSRS exact electronic format",
      passed: false,
      message: "Assisted only. Linaw does not claim its CSV worksheet is upload-ready until the exact employer electronic workflow is proven.",
    },
  ];

  const validations = [
    {
      document: "BIR Form 2316 (Annual Tax Certificate)",
      agency: "BIR" as const,
      status: statusOf(bir2316Checks),
      portalValidated: false,
      checks: bir2316Checks,
      nextStep: "Complete any missing BIR identity fields, generate year-end data, then validate the resulting Alphalist/2316 data in the current BIR module.",
    },
    {
      document: "BIR Form 1601-C / 1604-C Alphalist",
      agency: "BIR" as const,
      status: statusOf(birAlphalistChecks),
      portalValidated: false,
      checks: birAlphalistChecks,
      nextStep: "Complete the annual schedule dataset, validate it in the current BIR Alphalist workflow, and retain the validation report before enabling filing-ready status.",
    },
    {
      document: "SSS R-3 (Contribution Collection List)",
      agency: "SSS" as const,
      status: statusOf(sssChecks),
      portalValidated: false,
      checks: sssChecks,
      nextStep: "Use a real My.SSS employer account to verify one applicable-month remittance and retain the acceptance result.",
    },
    {
      document: "PhilHealth RF-1 / EPRS remittance report",
      agency: "PhilHealth" as const,
      status: statusOf(philHealthChecks),
      portalValidated: false,
      checks: philHealthChecks,
      nextStep: "Use an employer EPRS account to verify one test remittance report and retain the acknowledgement before calling the worksheet upload-ready.",
    },
    {
      document: "Pag-IBIG MCRF / eSRS",
      agency: "Pag-IBIG" as const,
      status: statusOf(pagIbigChecks),
      portalValidated: false,
      checks: pagIbigChecks,
      nextStep: "Keep this assisted until one test remittance schedule is accepted in the employer electronic workflow and the acknowledgement is retained.",
    },
  ];

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Government filing local preflight executed",
    resource: org.name,
    metadata: {
      formsChecked: validations.length,
      localPasses: validations.filter((validation) => validation.status === "LOCAL_PASS").length,
      localWarnings: validations.filter((validation) => validation.status === "LOCAL_WARNING").length,
      localFailures: validations.filter((validation) => validation.status === "LOCAL_FAIL").length,
      portalValidated: false,
      ruleVersion: PH_COMPLIANCE_RULE_VERSION,
    },
  });

  return Response.json({
    ok: true,
    organizationName: org.name,
    checkedAt: new Date().toISOString(),
    engineRuleVersion: PH_COMPLIANCE_RULE_VERSION,
    overallStatus: "LOCAL_PREFLIGHT_COMPLETE_NOT_PORTAL_VALIDATED",
    portalValidated: false,
    statutoryDeadlines: {
      nextMonthlyRemittanceExample: statutoryDueDate(2026, 3),
      thirteenthMonth2026: thirteenthMonthDeadline(2026),
    },
    dataCompleteness: {
      employees: staff.length,
      missingEmployeeTin: missingEmployeeTin.length,
      missingEmployeeTinBranch: missingEmployeeTinBranch.length,
      missingMiddleName: missingMiddleName.length,
      missingSss: missingSss.length,
      missingPhilHealth: missingPhilHealth.length,
      missingPagIbig: missingPagIbig.length,
      employerSssReady,
      employerPhilHealthReady,
      employerPagIbigReady,
    },
    validations,
    disclaimer: "Local checks only. This result is not a government portal acknowledgement, filing receipt, or certification.",
  });
}
