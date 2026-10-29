/**
 * Default PH catalogue values for ONE employer. This is a tenant bootstrap,
 * not a permission to create global (organizationId = null) benefit plans.
 * Legacy globally configured templates remain visible through the GET path.
 */
export function defaultEmployerBenefitPlans(organizationId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
      organizationId > 2147483647) {
    throw new Error("BENEFIT_CATALOG_EMPLOYER_REQUIRED");
  }
  return [
    { name: "HMO, Maxicare Plan A", category: "hmo", employeeShare: "1500.00",
      employerShare: "2500.00", provider: "Maxicare", organizationId },
    { name: "Group life & accident", category: "insurance", employeeShare: "0.00",
      employerShare: "600.00", provider: "Sun Life", organizationId },
    { name: "Pag-IBIG MP2", category: "voluntary", employeeShare: "500.00",
      employerShare: "0.00", cap: "5000.00", provider: "Pag-IBIG", organizationId },
    { name: "SSS Flexi-Fund", category: "voluntary", employeeShare: "0.00",
      employerShare: "0.00", provider: "SSS", organizationId },
    { name: "Rice allowance", category: "allowance", employeeShare: "0.00",
      employerShare: "1000.00", organizationId },
  ];
}
