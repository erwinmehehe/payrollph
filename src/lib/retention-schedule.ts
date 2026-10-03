export const REQUIRED_RETENTION_CLASSES = [
  "payroll_registers",
  "payslips",
  "bir_tax_records",
  "statutory_remittances",
  "employee_master",
  "final_pay_separation",
  "loan_ledgers",
  "audit_trails",
  "payout_bank_evidence",
  "dsr_evidence",
] as const;

export type RetentionRecordClass = (typeof REQUIRED_RETENTION_CLASSES)[number];

export const RETENTION_CLASS_LABELS: Record<RetentionRecordClass, string> = {
  payroll_registers: "Payroll registers and calculation traces",
  payslips: "Payslips",
  bir_tax_records: "BIR tax and annualization records",
  statutory_remittances: "SSS, PhilHealth and Pag-IBIG remittance evidence",
  employee_master: "Employee master and employment records",
  final_pay_separation: "Final-pay and separation records",
  loan_ledgers: "Government and company loan ledgers",
  audit_trails: "Payroll/security audit trails",
  payout_bank_evidence: "Bank files, payout receipts and reconciliation evidence",
  dsr_evidence: "Data-subject request evidence",
};

export const RETENTION_DISPOSAL_ACTIONS = [
  "review_then_delete",
  "anonymize",
  "archive",
] as const;

export function isRetentionRecordClass(value: string): value is RetentionRecordClass {
  return (REQUIRED_RETENTION_CLASSES as readonly string[]).includes(value);
}

export function missingRetentionClasses(rows: Array<{ recordClass: string }>) {
  const configured = new Set(rows.map((row) => row.recordClass));
  return REQUIRED_RETENTION_CLASSES.filter((recordClass) => !configured.has(recordClass));
}
