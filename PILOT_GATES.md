# Controlled payroll pilot gates

The public software demo and payroll-outsourcing landing page can be exposed before real payroll GA. For customer payroll, keep the first organizations in controlled pilot mode until all gates below are signed off.

- [ ] Clean CI install, typecheck, tests, production build.
- [ ] Staging migration rehearsal + rollback/backup test.
- [ ] Independent payroll reconciliation for at least 10 representative employees/cases.
- [ ] Mid-period hire proration policy implemented or signed-off manually as an exception.
- [ ] Final-pay annualization/tax adjustment implemented and reconciled.
- [ ] BIR 2316/1601-C/Alphalist output validated with current BIR tooling.
- [ ] SSS, PhilHealth and Pag-IBIG working files checked against current agency templates/portals.
- [ ] Low-value bank/PayMongo disbursement pilot completed.
- [ ] Managed-payroll maker/checker/client-approval/release roles tested with separate accounts.
- [ ] Demo workspace confirmed unable to access any customer organization or execute live external side effects.
