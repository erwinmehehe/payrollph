import type { FirstPayrollReadiness } from "@/lib/first-payroll-readiness";

/**
 * Shapes returned by `getDashboardData()` / `GET /api/dashboard`.
 *
 * These mirror the server payload deliberately loosely (dates arrive as strings
 * after a client-side refresh, as Date objects on the first server render), so
 * every consumer must normalise rather than assume.
 */

export type Organization = {
  id: number;
  name: string;
  legalName: string;
  accountType: string;
  plan: string;
  employeeCount: number;
  color: string;
  birTin?: string | null;
  birBranchCode?: string | null;
  sssEmployerNo?: string | null;
  philHealthEmployerNo?: string | null;
  pagIbigEmployerNo?: string | null;
};

export type Employee = {
  id: number;
  employeeNo: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  title: string;
  employmentType: string;
  status: string;
  avatarInitials: string;
  basicRate: string;
  payBasis?: "monthly" | "daily" | "hourly" | string;
  payRate?: string;
  standardWorkDaysPerMonth?: string;
  standardHoursPerDay?: string;
  mwe: boolean;
  region?: string | null;
  restDay?: string | null;
  orgUnitId?: number | null;
  legalEntityId?: number | null;
  email?: string | null;
  bankAccount?: string | null;
  bankCode?: string | null;
  mobile?: string | null;
  tin?: string | null;
  tinBranchCode?: string | null;
  sssNo?: string | null;
  philHealthNo?: string | null;
  pagIbigNo?: string | null;
  nationality?: string | null;
  startDate?: string | null;
};

export type PayrollReleaseReceipt = {
  runId: number;
  periodLabel: string;
  employeeCount: number;
  totalNetPay: string;
  releasedAt: string;
  bankExport: {
    status: "waiting" | "generated";
    label: string;
    filename?: string | null;
    generatedAt?: string | null;
  };
  payout?: {
    status: "awaiting-preflight" | "ready" | "submitted" | "completed";
    label: string;
    reference?: string | null;
    method?: string | null;
    completedAt?: string | null;
  };
  payslips: {
    status: "ready" | "attention";
    label: string;
    available: number;
    noticesQueued: number;
    noticesSent?: number;
    noticesFailed?: number;
    missingEmail: number;
    warningCount: number;
  };
};

export type PayrollRun = {
  id: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  scopeLabel: string;
  scopeOrgUnitId?: number | null;
  legalEntityId?: number | null;
  status: string;
  payDate: string;
  employeeCount: number;
  grossPay: string;
  netPay: string;
  exceptions: number;
  ruleVersion: string;
  processedChunks?: number | null;
  totalChunks?: number | null;
};

export type PayrollLineItem = { code: string; label: string; amount: string; notes?: string[] };

export type PayrollTrace = { ruleVersion?: string; inputs?: string[]; flags?: string[] } | null;

export type PayrollHandoffRunSummary = {
  id: number;
  periodLabel: string;
  periodStart?: string;
  periodEnd?: string;
  scopeLabel?: string;
  scopeOrgUnitId?: number | null;
  status: string;
  payDate: string;
};

export type PayrollEntry = {
  id: number;
  employeeId: number;
  grossPay: string;
  deductions: string;
  netPay: string;
  status: string;
  /** Stored as jsonb, so it arrives untyped. Read it through `readTrace`. */
  trace: unknown;
  /** Stored as jsonb. Read it through `readLineItems`. */
  lineItems?: unknown;
};

/** Narrows the engine's stored trace without trusting its shape. */
export function readTrace(entry: Pick<PayrollEntry, "trace">): {
  ruleVersion?: string;
  inputs: string[];
  flags: string[];
} {
  const raw = (entry.trace ?? {}) as Record<string, unknown>;
  return {
    ruleVersion: typeof raw.ruleVersion === "string" ? raw.ruleVersion : undefined,
    inputs: Array.isArray(raw.inputs) ? raw.inputs.filter((line): line is string => typeof line === "string") : [],
    flags: Array.isArray(raw.flags) ? raw.flags.filter((flag): flag is string => typeof flag === "string") : [],
  };
}

/** Narrows stored payslip line items; anything malformed is dropped, not guessed at. */
export function readLineItems(entry: Pick<PayrollEntry, "lineItems">): PayrollLineItem[] {
  if (!Array.isArray(entry.lineItems)) return [];
  return entry.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.label !== "string") return [];
    const amount = typeof row.amount === "number" ? String(row.amount) : typeof row.amount === "string" ? row.amount : null;
    if (amount === null) return [];
    return [{
      code: row.code,
      label: row.label,
      amount,
      notes: Array.isArray(row.notes) ? row.notes.filter((note): note is string => typeof note === "string") : undefined,
    }];
  });
}

export type Task = {
  id: number;
  title: string;
  detail: string;
  approver: string;
  dueLabel: string;
  priority: string;
  status: string;
};

export type ComplianceActionTask = {
  id: number;
  sourceKey: string;
  agency?: string | null;
  applicableMonth?: string | null;
  severity: "danger" | "warning" | "info" | string;
  title: string;
  detail: string;
  dueDate?: string | null;
  status: "open" | "in_progress" | "resolved" | string;
  assignedToUserId?: number | null;
  assignedToName?: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type AuditEvent = {
  id: number;
  actor: string;
  action: string;
  resource: string;
  metadata: unknown;
  createdAt: Date | string;
};

export type PricingPlan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: unknown;
  version: string;
};

export type Advisory = {
  id: number;
  advisoryNumber: string;
  policy: string;
  startDate: string;
  endDate: string;
  affectedUnit: string;
  active: boolean;
  premiumPercent?: string | number | null;
};

export type BankTemplate = { id: number; name: string; version: string; format: string };

export type Punch = {
  id: number;
  employeeId: number;
  workDate: string;
  status: string;
  timeIn: Date | string | null;
  timeOut: Date | string | null;
};

export type Delegation = {
  id: number;
  fromApprover: string;
  toApprover: string;
  reason: string;
  startsOn: string;
  endsOn: string;
  active: boolean;
};

export type LeaveRequest = {
  id: number;
  employeeId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  status: string;
  timeWindow?: {
    workDate: string;
    startTime: string;
    endTime: string;
    minutes: number;
    standardDayMinutes: number;
    exactDayEquivalent: string;
  } | null;
};

export type LeavePolicy = {
  id: number;
  leaveType: string;
  annualDays: string;
  carryOverMax?: string | null;
  maxBalance?: string | null;
  payTreatment: "paid" | "unpaid" | "partial" | "unconfigured" | string;
  paidPercentage: string;
  active: boolean;
};

export type ProvisioningTask = {
  id: number;
  employeeId: number;
  kind: string;
  title: string;
  owner: string;
  done: boolean;
};

export type SeparationRecord = {
  id: number;
  employeeId: number;
  separationType: string;
  noticeDate: string;
  lastDay: string;
  status: string;
};

export type PayRevision = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  previousPayBasis: string;
  previousRateAmount: string;
  newPayBasis: string;
  newRateAmount: string;
  reason: string;
  createdBy: string;
  createdAt: Date | string;
};

export type RestDayRevision = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  previousRestDay?: string | null;
  newRestDay?: string | null;
  reason: string;
  createdBy: string;
  createdAt: Date | string;
};

export type RetroAdjustment = {
  id: number;
  employeeId: number;
  revisionId: number;
  sourcePayrollRunId: number;
  sourcePeriodLabel: string;
  amount: string;
  status: string;
  settledPayrollRunId?: number | null;
  settledAt?: Date | string | null;
};

export type OrgUnit = { id: number; name: string; type: string };

export type SessionUser = { id: number; email: string; name: string; role: string; totpEnabled: boolean };

export type FreelancerProfile = {
  monthlyIncome: string;
  annualExpenses: string;
  filingMethod: string;
  nextDueDate: string;
} | null;

export type DashboardData = {
  firstPayrollReadiness?: FirstPayrollReadiness | null;
  user: SessionUser | null;
  organizations: Organization[];
  selectedOrganization: Organization;
  employees: Employee[];
  payrollRuns: PayrollRun[];
  payrollHandoffRun?: PayrollHandoffRunSummary | null;
  payrollEntries: PayrollEntry[];
  payrollJobs?: Array<{ id: number; status: string; chunkIndex: number }>;
  tasks: Task[];
  complianceActions?: ComplianceActionTask[];
  auditEvents: AuditEvent[];
  plans: PricingPlan[];
  templates: BankTemplate[];
  advisories: Advisory[];
  punches?: Punch[];
  delegations?: Delegation[];
  leaveRequests?: LeaveRequest[];
  leavePolicies?: LeavePolicy[];
  orgUnits?: OrgUnit[];
  access?: { companyWide: boolean; orgUnitName: string | null; role: string } | null;
  capabilities?: {
    orgStructure: boolean;
    payroll: boolean;
    approvals: boolean;
    multiBranch: boolean;
    developer: boolean;
  };
  provisioning?: ProvisioningTask[];
  separations?: SeparationRecord[];
  payRevisions?: PayRevision[];
  restDayRevisions?: RestDayRevision[];
  retroAdjustments?: RetroAdjustment[];
  freelancer: FreelancerProfile;
  security?: {
    passwordAuth: boolean;
    totp: string;
    totpMandatory: boolean;
    sessions: string;
    rateLimit: string;
    sso: string;
  };
};

export type ToastKind = "ok" | "err" | "info";
export type Toast = { id: number; kind: ToastKind; message: string };
export type Notify = (message: string, kind?: ToastKind) => void;
