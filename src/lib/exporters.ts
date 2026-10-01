import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankTemplates, employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { decryptBankAccount } from "@/lib/bank-account-crypto";
import { computePagIbig, computePhilHealth, computeSss } from "@/lib/payroll-rules";
import { escapeCsvCell } from "@/lib/csv";

const csv = escapeCsvCell;
const round2 = (value: number) => Math.round(value * 100) / 100;

type PaymentSnapshot = {
  employeeName: string;
  employeeNo: string;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
};

function readPaymentSnapshot(value: unknown): PaymentSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payment = (value as Record<string, unknown>).payment;
  if (!payment || typeof payment !== "object") return null;
  const row = payment as Record<string, unknown>;
  const employeeName = typeof row.employeeName === "string" ? row.employeeName.trim() : "";
  const employeeNo = typeof row.employeeNo === "string" ? row.employeeNo.trim() : "";
  if (!employeeName || !employeeNo) return null;
  const nullable = (field: unknown) => typeof field === "string" && field.trim() ? field.trim() : null;
  return {
    employeeName,
    employeeNo,
    bankAccount: nullable(row.bankAccount),
    bankCode: nullable(row.bankCode),
    mobile: nullable(row.mobile),
  };
}

export async function generateBankFile(runId: number, templateName: string, dryRun = true) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");
  const [template] = await db.select().from(bankTemplates).where(eq(bankTemplates.name, templateName));
  if (!template) throw new Error("Bank template not found");

  const entries = await db.select({
    entry: payrollEntries,
    employee: employees,
  })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, runId))
    .orderBy(asc(employees.id));

  const rows = entries.map(({ entry, employee }) => {
    const snapshot = readPaymentSnapshot(entry.trace);
    const payment = snapshot ?? {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      bankAccount: employee.bankAccount,
      bankCode: employee.bankCode,
      mobile: employee.mobile,
    };

    return {
      employee_name: payment.employeeName,
      employee_no: payment.employeeNo,
      account_number: decryptBankAccount(payment.bankAccount) ?? "0000000000",
      bank_code: payment.bankCode ?? "",
      mobile: payment.mobile ?? "09000000000",
      net_pay: entry.netPay,
      amount: entry.netPay,
      paymentSnapshotPresent: Boolean(snapshot),
    };
  });

  const tName = template.name.toLowerCase();
  const usesMobileDestination = tName.includes("gcash") || tName.includes("maya") || tName.includes("paymaya");
  const validation = {
    dryRun,
    template: template.name,
    version: template.version,
    rowCount: rows.length,
    totalNet: rows.reduce((sum, row) => sum + Number(row.net_pay), 0).toFixed(2),
    missingAccounts: rows.filter((row) => row.account_number === "0000000000").length,
    missingMobiles: rows.filter((row) => row.mobile === "09000000000").length,
    missingPaymentSnapshots: rows.filter((row) => !row.paymentSnapshotPresent).length,
  };

  if (!dryRun) {
    if (run.status !== "Released") {
      throw new Error(`Final bank files require a Released payroll run (currently ${run.status}).`);
    }
    if (validation.missingPaymentSnapshots > 0) {
      throw new Error(
        `Final bank file cannot be generated: ${validation.missingPaymentSnapshots} payroll entr${validation.missingPaymentSnapshots === 1 ? "y lacks" : "ies lack"} an immutable payment snapshot. Recalculate before release.`,
      );
    }
    if (rows.length !== run.employeeCount) {
      throw new Error(
        `Final bank file cannot be generated: register has ${rows.length} rows but the released run records ${run.employeeCount} employees.`,
      );
    }
    if (Math.abs(Number(validation.totalNet) - Number(run.netPay)) > 0.01) {
      throw new Error("Final bank file total does not match the released payroll net pay.");
    }
    if (usesMobileDestination && validation.missingMobiles > 0) {
      throw new Error(
        `Final mobile-wallet file cannot be generated: ${validation.missingMobiles} employee(s) are missing a captured mobile number.`,
      );
    }
    if (!usesMobileDestination && validation.missingAccounts > 0) {
      throw new Error(
        `Final bank file cannot be generated: ${validation.missingAccounts} employee(s) are missing a captured bank account.`,
      );
    }
  }

  let body = "";

  if (tName.includes("bdo") && template.format === "DAT") {
    body = rows.map((row, index) => [
      "D",
      String(index + 1).padStart(6, "0"),
      row.account_number.padEnd(16, " "),
      Number(row.amount).toFixed(2).padStart(13, "0"),
      row.employee_name.slice(0, 40).padEnd(40, " "),
      run.payDate.replaceAll("-", ""),
    ].join("")).join("\n");
  } else if (tName.includes("bpi") || tName.includes("bizlink")) {
    // BPI Bizlink standard format: Account No, Amount, Employee Name, Employee No, Reference, Remarks
    const header = ["Account_Number", "Amount", "Beneficiary_Name", "Employee_ID", "Reference_Number", "Payment_Date"];
    body = [header.join(","), ...rows.map((row) => [
      row.account_number,
      Number(row.amount).toFixed(2),
      row.employee_name,
      row.employee_no,
      `PAY-${run.id}-${row.employee_no}`,
      run.payDate,
    ].map(csv).join(","))].join("\n");
  } else if (tName.includes("unionbank") || tName.includes("onehub")) {
    // UnionBank OneHub Payroll CSV format: Beneficiary Account, Beneficiary Name, Amount, Reference, Remarks, Notification Email
    const header = ["Beneficiary_Account", "Beneficiary_Name", "Amount", "Reference_No", "Particulars"];
    body = [header.join(","), ...rows.map((row) => [
      row.account_number,
      row.employee_name,
      Number(row.amount).toFixed(2),
      `UB-${run.id}-${row.employee_no}`,
      `Payroll ${run.periodLabel}`,
    ].map(csv).join(","))].join("\n");
  } else if (tName.includes("metrobank") || tName.includes("mbtc")) {
    // Metrobank eGov / MBTC Payroll CSV format
    const header = ["Account_No", "Beneficiary_Name", "Amount", "Payment_Date", "Ref_Code"];
    body = [header.join(","), ...rows.map((row) => [
      row.account_number,
      row.employee_name,
      Number(row.amount).toFixed(2),
      run.payDate.replaceAll("-", "/"),
      `${run.id}-${row.employee_no}`,
    ].map(csv).join(","))].join("\n");
  } else if (tName.includes("security bank")) {
    // Security Bank eGov / DigiBanker CSV
    const header = ["Bene_Account", "Bene_Name", "Credit_Amount", "Particulars", "Emp_Ref"];
    body = [header.join(","), ...rows.map((row) => [
      row.account_number,
      row.employee_name,
      Number(row.amount).toFixed(2),
      `Salaries ${run.periodLabel}`,
      row.employee_no,
    ].map(csv).join(","))].join("\n");
  } else if (tName.includes("chinabank") || tName.includes("cbc")) {
    // ChinaBank eGov CSV
    const header = ["Crediting_Account", "Account_Name", "Disbursement_Amount", "Employee_Number"];
    body = [header.join(","), ...rows.map((row) => [
      row.account_number,
      row.employee_name,
      Number(row.amount).toFixed(2),
      row.employee_no,
    ].map(csv).join(","))].join("\n");
  } else if (tName.includes("eastwest")) {
    // EastWest Bank eGov CSV
    const header = ["Destination_Account", "Recipient_Name", "Net_Amount", "Invoice_Ref"];
    body = [header.join(","), ...rows.map((row) => [
      row.account_number,
      row.employee_name,
      Number(row.amount).toFixed(2),
      `EW-${run.id}-${row.employee_no}`,
    ].map(csv).join(","))].join("\n");
  } else if (tName.includes("gcash")) {
    const header = ["mobile", "employee_name", "amount", "reference"];
    body = [header.join(","), ...rows.map((row) => [row.mobile, row.employee_name, row.amount, `${run.id}-${row.employee_no}`].map(csv).join(","))].join("\n");
  } else if (tName.includes("maya") || tName.includes("paymaya")) {
    // Maya Business Payroll CSV
    const header = ["Recipient_Mobile", "Recipient_Name", "Disbursement_Amount", "Batch_Reference"];
    body = [header.join(","), ...rows.map((row) => [row.mobile, row.employee_name, row.amount, `MAYA-${run.id}-${row.employee_no}`].map(csv).join(","))].join("\n");
  } else if (tName.includes("america") || tName.includes("cashpro")) {
    // Bank of America CashPro (ACH / PBR)
    const header = ["Receiving_Account", "Account_Holder", "Amount", "Currency", "PBR_Reference"];
    body = [header.join(","), ...rows.map((row) => [row.account_number, row.employee_name, row.amount, "PHP", `BOA-${run.id}-${row.employee_no}`].map(csv).join(","))].join("\n");
  } else {
    // Standard Universal Bank CSV
    const header = ["account_number", "employee_name", "net_pay", "employee_no"];
    body = [header.join(","), ...rows.map((row) => [row.account_number, row.employee_name, row.net_pay, row.employee_no].map(csv).join(","))].join("\n");
  }

  return {
    filename: `${template.name.replaceAll(" ", "-").toLowerCase()}-${run.id}.${template.format.toLowerCase()}`,
    contentType: template.format === "CSV" ? "text/csv" : "text/plain",
    body: dryRun
      ? `# DRY-RUN VALIDATION\n# template=${template.name} version=${template.version}\n# rows=${validation.rowCount} totalNet=${validation.totalNet}\n# missingAccounts=${validation.missingAccounts} missingMobiles=${validation.missingMobiles} missingPaymentSnapshots=${validation.missingPaymentSnapshots}\n# This is a preview. Final files require a released run and immutable payment snapshots.\n${body}`
      : body,
    validation,
  };
}

export async function generateJournalCsv(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");
  const gross = Number(run.grossPay);
  const net = Number(run.netPay);
  const deductions = gross - net;
  const header = ["Date", "Journal", "Account", "Debit", "Credit", "Description"];
  const rows = [
    [run.payDate, "PAYROLL", "Salaries Expense", gross.toFixed(2), "", run.periodLabel],
    [run.payDate, "PAYROLL", "SSS/PhilHealth/Pag-IBIG/Tax Payable", "", deductions.toFixed(2), "Statutory & tax deductions"],
    [run.payDate, "PAYROLL", "Cash/Bank", "", net.toFixed(2), "Net pay disbursement"],
  ];
  return {
    filename: `xero-qbo-journal-${run.id}.csv`,
    contentType: "text/csv",
    body: [header, ...rows].map((line) => line.map(csv).join(",")).join("\n"),
  };
}

export async function generateGovernmentDraft(runId: number, kind: string) {
  const supportedKinds = new Set([
    "sss-r3",
    "philhealth-rf1",
    "pagibig-mcrf",
    "bir-1601c",
    "bir-1604c-source",
  ]);
  if (!supportedKinds.has(kind)) {
    throw new Error(`Unsupported government export "${kind}". Exact filing formats are never guessed.`);
  }
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");
  const entries = await db.select({
    entry: payrollEntries,
    employee: employees,
  })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, runId))
    .orderBy(asc(employees.id));

  const headerNote = [
    "# DRAFT ONLY, not a certified government submission file",
    `# kind=${kind}`,
    `# payrollRun=${run.id}`,
    `# period=${run.periodLabel}`,
    "# Validate against the live government portal before filing.",
  ].join("\n");

  if (kind === "sss-r3") {
    // SSS R-3 is a monthly filing. A single payroll run's stored line item is
    // only half the employee's monthly SSS share, by design, the payroll
    // engine splits it evenly across the two semi-monthly cutoffs
    // (payroll-engine.ts: `sss = sssRule.employee / 2`). This draft recomputes
    // the real monthly figures from computeSss() (single source of truth,
    // shared with the actual payroll calculation) instead of doubling a
    // stored half-month amount, which would silently drift if that split ever
    // changes. This also fixes a previous bug where EC was hardcoded to
    // ₱10.00 for every employee regardless of their actual MSC (correct EC is
    // ₱30 at MSC ≥ ₱15,000, most employees above roughly ₱15,000/month basic
    // pay were being under-reported).
    const REGULAR_SS_CAP = 20_000;
    const missingSss = entries.filter(({ employee }) => !employee.sssNo);
    if (missingSss.length > 0) {
      throw new Error(
        `SSS R-3 cannot be generated: ${missingSss.length} employee(s) are missing an SSS number: ${missingSss.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "SSSNo,LastName,FirstName,MiddleName,MSC,SS_Regular,SS_MPF,SS_Employee,SS_Employer,EC_Employer,Total_Contribution",
      ...entries.map(({ employee, entry }) => {
        const monthlyBasic = Number(employee.basicRate ?? entry.grossPay ?? 0);
        const sss = computeSss(monthlyBasic);
        const regularMsc = Math.min(sss.monthlySalaryCredit, REGULAR_SS_CAP);
        const mpfMsc = Math.max(0, sss.monthlySalaryCredit - REGULAR_SS_CAP);
        const employeeRegular = round2(sss.employee * (regularMsc / sss.monthlySalaryCredit));
        const employeeMpf = round2(sss.employee - employeeRegular);
        return [
          employee.sssNo,
          employee.lastName,
          employee.firstName,
          employee.middleName ?? "",
          sss.monthlySalaryCredit.toFixed(2),
          employeeRegular.toFixed(2),
          employeeMpf.toFixed(2),
          sss.employee.toFixed(2),
          sss.employer.toFixed(2),
          sss.employerEC.toFixed(2),
          sss.total.toFixed(2),
        ].map(csv).join(",");
      }),
    ].join("\n");
    return {
      filename: `sss-ecl-r3-worksheet-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# SSS employer workflow uses My.SSS e-CL and a PRN. This worksheet is not an SSS acknowledgement or a certified R3 File Generator output.\n# Figures below are full monthly amounts (recomputed from basic pay), not this single cutoff's half-month deduction.\n${body}`,
    };
  }

  if (kind === "philhealth-rf1") {
    const missingPins = entries.filter(({ employee }) => !employee.philHealthNo);
    if (missingPins.length > 0) {
      throw new Error(
        `PhilHealth RF-1 cannot be generated: ${missingPins.length} employee(s) are missing a PhilHealth PIN: ${missingPins.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "PIN,LastName,FirstName,MiddleName,MonthlySalaryBase,EmployeeShare,EmployerShare,TotalPremium",
      ...entries.map(({ employee, entry }) => {
        const monthlyBasic = Number(employee.basicRate ?? entry.grossPay ?? 0);
        const ph = computePhilHealth(monthlyBasic);
        return [
          employee.philHealthNo,
          employee.lastName,
          employee.firstName,
          employee.middleName ?? "",
          ph.base.toFixed(2),
          ph.employee.toFixed(2),
          ph.employer.toFixed(2),
          (ph.employee + ph.employer).toFixed(2),
        ].map(csv).join(",");
      }),
    ].join("\n");
    return {
      filename: `philhealth-eprs-rf1-worksheet-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# PhilHealth requires employers to use EPRS for premium reporting and payment. This worksheet is a portal-entry aid, not an EPRS acknowledgement.\n# Full monthly premium amounts are recomputed from monthly basic salary.\n${body}`,
    };
  }

  if (kind === "pagibig-mcrf") {
    const missingMids = entries.filter(({ employee }) => !employee.pagIbigNo);
    if (missingMids.length > 0) {
      throw new Error(
        `Pag-IBIG MCRF cannot be generated: ${missingMids.length} employee(s) are missing a Pag-IBIG MID: ${missingMids.map(({ employee }) => employee.employeeNo).join(", ")}.`,
      );
    }

    const body = [
      "PagIBIGMID,LastName,FirstName,MiddleName,FundSalary,EmployeeShare,EmployerShare,TotalContribution",
      ...entries.map(({ employee, entry }) => {
        const monthlyBasic = Number(employee.basicRate ?? entry.grossPay ?? 0);
        const hd = computePagIbig(monthlyBasic);
        return [
          employee.pagIbigNo,
          employee.lastName,
          employee.firstName,
          employee.middleName ?? "",
          hd.fundSalary.toFixed(2),
          hd.employee.toFixed(2),
          hd.employer.toFixed(2),
          hd.total.toFixed(2),
        ].map(csv).join(",");
      }),
    ].join("\n");
    return {
      filename: `pagibig-mcrf-esrs-worksheet-${run.id}.csv`,
      contentType: "text/csv",
      body: `${headerNote}\n# Pag-IBIG's published MCRF instructions use its prescribed spreadsheet layout and YYYYMM period. This CSV is an assisted worksheet only, not an upload-ready MCRF.\n# Full monthly mandatory contributions are recomputed from monthly basic salary.\n${body}`,
    };
  }

  if (kind === "bir-1601c") {
    const totalWht = entries.reduce((sum, { entry }) => {
      const wht = Math.abs(Number((entry.lineItems as Array<{ code: string; amount: string }> | undefined)?.find?.((item) => item.code === "WHT")?.amount ?? 0));
      return sum + wht;
    }, 0);
    const body = [
      "Form,Period,WithholdingTax,Employees,Status",
      ["1601-C", run.periodLabel, totalWht.toFixed(2), String(entries.length), "DRAFT"].map(csv).join(","),
    ].join("\n");
    return { filename: `bir-1601c-draft-${run.id}.csv`, contentType: "text/csv", body: `${headerNote}\n${body}` };
  }

  if (kind !== "bir-1604c-source") {
    throw new Error(`Government export "${kind}" is not implemented.`);
  }

  // BIR annual summary input. This remains a source extract, not a claimed
  // filing-ready DAT. A single cutoff cannot prove the complete annual filing
  // contract, so the exporter fails closed instead of guessing portal bytes.
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, run.organizationId))
    .limit(1);
  const employerTin = (organization?.birTin ?? "").replace(/\D/g, "");
  const employerBranchCode = (organization?.birBranchCode ?? "").replace(/\D/g, "").padStart(4, "0");

  if (employerTin.length !== 9 || employerBranchCode.length !== 4) {
    throw new Error("BIR annual draft cannot be generated: employer BIR TIN and 4-digit branch code are required.");
  }

  const missingTin = entries.filter(({ employee }) => (employee.tin ?? "").replace(/\D/g, "").length !== 9);
  const missingBranch = entries.filter(({ employee }) => (employee.tinBranchCode ?? "").replace(/\D/g, "").length !== 4);
  if (missingTin.length > 0) {
    throw new Error(
      `BIR annual draft cannot be generated: ${missingTin.length} employee(s) are missing a valid 9-digit TIN: ${missingTin.map(({ employee }) => employee.employeeNo).join(", ")}.`,
    );
  }
  if (missingBranch.length > 0) {
    throw new Error(
      `BIR annual draft cannot be generated: ${missingBranch.length} employee(s) are missing a 4-digit BIR branch code: ${missingBranch.map(({ employee }) => employee.employeeNo).join(", ")}.`,
    );
  }

  const body = [
    "EmployerTIN,EmployerBranchCode,EmployeeTIN,EmployeeBranchCode,LastName,FirstName,MiddleName,Nationality,GrossCompensation,TaxWithheld,MWE,Status",
    ...entries.map(({ employee, entry }) => [
      employerTin,
      employerBranchCode,
      (employee.tin ?? "").replace(/\D/g, ""),
      (employee.tinBranchCode ?? "").replace(/\D/g, ""),
      employee.lastName,
      employee.firstName,
      employee.middleName ?? "",
      employee.nationality ?? "Filipino",
      entry.grossPay,
      Math.abs(Number((entry.lineItems as Array<{ code: string; amount: string }> | undefined)?.find?.((item) => item.code === "WHT")?.amount ?? 0)).toFixed(2),
      employee.mwe ? "Y" : "N",
      "DRAFT",
    ].map(csv).join(",")),
  ].join("\n");

  return {
    filename: `bir-1604c-annual-source-${run.id}.csv`,
    contentType: "text/csv",
    body: `${headerNote}\n# Source extract only. Validate and transform this annual dataset through the current BIR validation workflow before filing.\n${body}`,
  };
}
