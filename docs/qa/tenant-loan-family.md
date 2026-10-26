# Employee loan requests and precautionary pause

Independent main-based family: no method overlap with People/platform #1402,
Compensation #1418 or Workforce operations #1409.

| Method | Exact fictional scenario | Boundary |
| --- | --- | --- |
| POST loans | Submit an unapproved Company Emergency Loan request | Exact principal/amortization/authority, pending status and actor-bound audit; no activation |
| PATCH loans | Pause a seeded active historical loan | Only status changes; balances, authority, existing repayment and payroll evidence retained |

The default disposable PostgreSQL/localhost HTTP runner uses two separate attacker
employers and a real higher-ID victim, positive own-state readback, exact foreign
denial, discrimination and unchanged victim state/audit. POST also forges the victim
worker ID under the own employer and must return 409 without creating a request.
PATCH derives ownership from the real victim loan ID rather than a supplied employer.

The active historical loan and its prior payment are fictional database fixtures,
not an API activation or bank receipt. The request remains pending. No approval,
resume, external payment recording, provider call or money-flag change is performed.
Snapshots preserve employer-scoped loan payments and payroll entries through their
parent loans/runs, plus workers, existing pay profiles, revisions and audit business
history. Unit cases reject false/no-op/foreign evidence, changed money fields,
missing historical payment evidence and tampered audits.

Both methods remain **GAP**, with **zero new credits**. Actual exact-head HTTP/PG
default proof and the other profile jobs must succeed before recording execution.
PATCH approval/rejection/resumption/payment/closure branches remain untested by this
batch; a successful pause does not certify the complete method. POST acceptance is
bounded to the stated product and Owner role, not every product or principal.

No production SQL, Neon, real money movement, feature/money flags, runtime routes,
schema, tenant/MFA/audit guards, provider settings or release authorization change.
Do not automatically merge.
