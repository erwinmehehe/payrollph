export const employer = 71;
export const emptyDashboard = {
  selectedOrganization: { id: employer, name: "Fictional Employer", legalName: "Fictional Employer" },
  organizations: [{id: employer}], employees: [], tasks: [], payrollRuns: [], payrollEntries: [],
  auditEvents: [], plans: [], templates: [], advisories: [], punches: [], leaveRequests: [],
  provisioning: [], retroAdjustments: [],
};
export const recordedRun = {
  id: 101, organizationId: employer, periodLabel: "Fictional cutoff", status: "Processed",
  employeeCount: 0, exceptions: 0, grossPay: "0.00", netPay: "0.00",
};
