# HR setup guardrails for financial-rate conversions and treasury separation

The new-hire screen and legacy pay editor now provide OPTIONAL illustrative
monthly workday conversion values of 22 and 26. These are not legal defaults:
users must check contracts, work schedules, paid days, regular holidays
and any applicable wage rule. Critically, DOLE annual divisor references
such as 261/262 or 313/314 are NOT valid inputs for the separate
`standardWorkDaysPerMonth` field, which only accepts 1–31.

Treasury Controls now shows an explicit OFF warning as soon as policy data
is loaded. Leaving the optional treasury segregation OFF may let one
authorized operator release payroll and then submit/confirm funds.
Enabling requires an operator assignment and existing privileged gates.

These changes only improve visibility and user selection. They do not
silently rewrite employee salaries, payroll divisor policy, treasury
assignments or authorizations. Stage with real PH payroll operators before
claiming legally compliant wage conversions.