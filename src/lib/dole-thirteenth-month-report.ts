import { createHash } from "node:crypto";
import { storedMoneyCentavos } from "./stored-money-centavos";
import { computeThirteenthMonth } from "./thirteenth-month-entitlement";

export type DoleThirteenthWorker = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  basicSalaryEarned: number;
  payrollThirteenthPaid: number;
  historicalThirteenthPaid: number;
  finalPayThirteenthPaid: number;
  basicSalaryComplete: boolean;
};

export type DoleReportingProfile = {
  establishmentAddress: string;
  principalBusiness: string;
  contactName: string;
  contactPosition: string;
  contactPhone: string;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Screening entitlement = 1/12 of basic, exact integer-centavo half-up.
 * A finite basic that cannot be verified to centavos retains the legacy float
 * screening figure for diagnostic display only. It is NOT a verified screening
 * amount: the employee must appear in incompleteBasicRows and submission
 * readiness must be blocked. Non-finite or malformed basics have no display
 * entitlement at all. No real pay, granted amounts, or report hash are changed.
 */
function screeningEntitlementPesos(
  basicSalaryEarned: number,
): { amount: number | null; verified: boolean } {
  if (typeof basicSalaryEarned !== "number" || !Number.isFinite(basicSalaryEarned)) {
    return { amount: null, verified: false };
  }
  const basic = Math.max(0, basicSalaryEarned);
  const unverified = () => {
    const legacy = round2(basic / 12);
    return { amount: Number.isFinite(legacy) ? legacy : null, verified: false };
  };
  // A negative annual earned-basic total can signal reversed or misattributed
  // source pay. Flooring it for display must not certify the source as complete.
  const centavos = storedMoneyCentavos(basic);
  if (basicSalaryEarned < 0 || centavos === null) return unverified();
  const result = computeThirteenthMonth({ basicCentavos: centavos, payouts: {} });
  if (result.blockers.length > 0) return unverified();
  return { amount: result.entitlementCentavos / 100, verified: true };
}

export function buildDoleThirteenthMonthReport(input: {
  taxYear: number;
  establishmentName: string;
  profile: DoleReportingProfile | null;
  workers: DoleThirteenthWorker[];
}) {
  const workers = input.workers
    .map((worker) => {
      const amountGranted = round2(
        Math.max(0, worker.payrollThirteenthPaid)
        + Math.max(0, worker.historicalThirteenthPaid)
        + Math.max(0, worker.finalPayThirteenthPaid),
      );
      const screening = screeningEntitlementPesos(worker.basicSalaryEarned);
      const basicSalaryComplete = worker.basicSalaryComplete && screening.verified;
      // An unverified base cannot establish either a clean screen or a real shortfall.
      const screeningShortfall = screening.verified && screening.amount !== null
        ? round2(Math.max(0, screening.amount - amountGranted))
        : null;
      return {
        ...worker,
        basicSalaryComplete,
        screeningBasicVerified: screening.verified,
        amountGranted,
        screeningEntitlement: screening.amount,
        screeningShortfall,
      };
    })
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const beneficiaries = workers.filter((worker) => worker.amountGranted > 0);
  const totalBenefitsGranted = round2(
    beneficiaries.reduce((sum, worker) => sum + worker.amountGranted, 0),
  );
  const reviewRows = workers.filter((worker) =>
    worker.basicSalaryComplete && worker.screeningShortfall !== null && worker.screeningShortfall >= 0.01,
  );
  const incompleteBasicRows = workers.filter((worker) => !worker.basicSalaryComplete);
  const profileComplete = Boolean(
    input.profile?.establishmentAddress.trim()
    && input.profile.principalBusiness.trim()
    && input.profile.contactName.trim()
    && input.profile.contactPosition.trim()
    && input.profile.contactPhone.trim(),
  );

  const dueDate = `${input.taxYear + 1}-01-15`;
  const report = {
    reportType: "13th_month_pay",
    taxYear: input.taxYear,
    dueDate,
    establishmentName: input.establishmentName,
    establishmentAddress: input.profile?.establishmentAddress ?? "",
    principalBusiness: input.profile?.principalBusiness ?? "",
    totalEmployment: workers.length,
    workersBenefited: beneficiaries.length,
    totalBenefitsGranted,
    contactName: input.profile?.contactName ?? "",
    contactPosition: input.profile?.contactPosition ?? "",
    contactPhone: input.profile?.contactPhone ?? "",
    employees: workers.map((worker) => ({
      employeeNo: worker.employeeNo,
      employeeName: worker.employeeName,
      amountGranted: worker.amountGranted,
    })),
  };

  const reportHash = createHash("sha256")
    .update(JSON.stringify(report))
    .digest("hex");

  return {
    report,
    reportHash,
    profileComplete,
    reviewRows,
    incompleteBasicRows,
    // Existing incomplete imported history remains reportable as before.
    // Newly detected invalid/unverifiable numeric basic blocks recording
    // submission evidence until the basic source is reconciled.
    readyToSubmit: profileComplete && workers.length > 0
      && workers.every((worker) => worker.screeningBasicVerified),
    sourceNote:
      "Source worksheet for the DOLE Online Compliance Portal. PayrollPH does not submit this report to DOLE and does not treat generation as proof of submission.",
  };
}
