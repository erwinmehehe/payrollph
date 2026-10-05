import { createHash } from "node:crypto";

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
      const screeningEntitlement = round2(Math.max(0, worker.basicSalaryEarned) / 12);
      const screeningShortfall = round2(Math.max(0, screeningEntitlement - amountGranted));
      return {
        ...worker,
        amountGranted,
        screeningEntitlement,
        screeningShortfall,
      };
    })
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const beneficiaries = workers.filter((worker) => worker.amountGranted > 0);
  const totalBenefitsGranted = round2(
    beneficiaries.reduce((sum, worker) => sum + worker.amountGranted, 0),
  );
  const reviewRows = workers.filter((worker) => worker.basicSalaryComplete && worker.screeningShortfall >= 0.01);
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
    readyToSubmit: profileComplete && workers.length > 0,
    sourceNote:
      "Source worksheet for the DOLE Online Compliance Portal. PayrollPH does not submit this report to DOLE and does not treat generation as proof of submission.",
  };
}
