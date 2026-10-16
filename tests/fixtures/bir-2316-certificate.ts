import { CERTIFICATE_ITEMS, type CertificateSource } from "../../src/lib/bir-2316-certificate";
export const certificateSource: CertificateSource = {
  scope: { organizationId: 1, employeeId: 1, taxYear: 2025 }, employerName: "Synthetic Employer Co.", employerTin: "123456789-0000",
  employeeName: "Santos, Maria", employeeTin: "333222111-0000", birthDate: "1990-02-03", periodFrom: "2025-01-01", periodTo: "2025-12-31", mwe: false,
  summary: { grossCompensation: "600000.00", nonTaxable: "100000.00", taxableIncome: "500000.00", taxDue: "42500.00", withheldBeforeYearEnd: "42500.00", yearEndAdjustment: "0.00" },
  withholding: { actualPresentWithheld: "42500.00", appliedAdjustment: "0.00", issues: [], entryIds: [1] },
};
export const certificateReview = () => ({
  text: { rdo: "039", address: "123 Fictional Street, Quezon City", zip: "1100", homeAddress: "123 Fictional Street, Quezon City", homeZip: "1100", foreignAddress: "", contact: "09171234567", minimumDaily: "0.00", minimumMonthly: "0.00", employerAddress: "456 Sample Avenue, Makati City", employerZip: "1200", categoryReference: "Fictional category review 2025", peraReference: "Fictional zero PERA confirmation", "44A": "", "44B": "", "51A": "", "51B": "" },
  detailItems: { ...Object.fromEntries(CERTIFICATE_ITEMS.map(k => [k, "0.00"])), "34": "90000.00", "35": "10000.00", "39": "500000.00" },
  previousEmployer: { status: "none-confirmed" }, peraCredit: "0.00", employerType: "main", acknowledged: true,
});
