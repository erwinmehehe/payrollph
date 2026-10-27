# Seed-bound path-ID tenant proof batch

Base: main `f9ea6c15a2e0f155a849016f23ab0e3c94489cb3`.
Baseline: 265 provisional COVERED / 220 GAP / 10 PUBLIC-BY-DESIGN, 495 methods.
The pasted estimates of 494 methods and 17 path gaps are stale: this base has 19.
No production, provider, tax determination or payroll release is exercised.

## Three executed methods

| Method | Real local HTTP/PostgreSQL evidence and bounded scope |
| --- | --- |
| GET employees/[id]/mwe-classifications | Exact own employee number/ID and seeded, nonempty rejected fictional classification history; real higher-ID victim worker denied. No tax approval. |
| POST employees/[id]/mwe-classifications | Exact own pending non-MWE request and atomic actor audit, retained worker/pay/payroll state; real victim worker denied, including a victim path with an own-employer body. No approval or application. |
| GET payroll-runs/[id]/connected-impact | Exact own draft run, worker and seeded employment-change finding under the flagged-read profile; real higher-ID victim run denied; advisory legacy company-wide mode only, not entity history or financial authorization. |

The default strict runs passed 1 GET + 1 POST, each with two independent
attackers and genuine higher-ID victim paths. The flagged strict read passed
the third method. Every proof rejected the other attacker's genuine response or
state; victim PostgreSQL/audit state stayed unchanged. Both forged POST attempts
were refused. The actual no-op GET mutation failed with
`proof accepts another employer's data`, then was removed.

`pathIds` is a literal placeholder-to-seed-field map. Catalog and runtime must
agree exactly, every placeholder must be present, and binding rejects absent,
noninteger, equal or lower victim IDs. Static URLs retain the existing binding.
Shared own/foreign/discrimination/unchanged assertion lines retain their text
and line numbers. No general exception for arbitrary dynamic routes exists.

`TENANT_TABLE_PATH_ONLY=1` explicitly selects path-bound rows in the chosen
profile and labels the receipt. Unset means the complete existing profile.
The credit script's `--only-path-ids --run-label <receipt>` restricts new credits
to these executed rows and retains unrelated proof provenance. Generate and
review credits before merge; no legacy/pending row is credited by this run.
The inventory guard requires source-pinned bindings for each path-method credit.

## Remaining 16 path methods: GAP / NOT_RUN

| Method | Hold reason |
| --- | --- |
| PATCH approvals/[id] | Governed approval/decision state machine and independent actors; not a generic row edit. |
| POST auth/saml/acs/[providerId] | Signed assertion/protocol/replay proof, not session employer binding. |
| GET auth/saml/metadata/[providerId] | Public metadata proposal needs owner classification; no status change. |
| GET auth/saml/start/[providerId] | Auth/provider/state protocol; owner sessions do not establish proof. |
| PATCH compliance/filing-validations/[id] | Accepted/rejected evidence lifecycle and source validation; no agency acceptance fabricated. |
| PATCH employees/[id]/mwe-classifications/[classificationId] | Independent checker and approval/rejection/effective-history branches; no partial-action credit. |
| GET hcm/employment-term-decisions/[id]/manager-attestation | Exact manager actor and governed employer decision; Owner context insufficient. |
| POST hcm/employment-term-decisions/[id]/manager-attestation | Same manager-bound decision/evidence lifecycle. |
| POST managed-payroll/runs/[id]/approve | Financial approval and service-provider segregation, deliberately held. |
| POST payroll-runs/[id]/exports | Governed export modes/readiness/provider paths; no invented successful export write. |
| POST payroll-runs/[id]/payout-reconciliation | Real provider reconciliation is excluded. |
| POST payroll-runs/[id]/pilot-signoff | No operator acceptance/sign-off invented. |
| POST payroll-runs/[id]/release | Money/release excluded. |
| POST payroll-runs/[id]/submit-review | Complete source/approval snapshot needed; no bypass of payroll readiness. |
| GET payroll-runs/[id]/xendit-payout | Provider/payout scope and configured state excluded. |
| POST payroll-runs/[id]/xendit-payout | External payout/send excluded. |

## Reconciliation of the other pasted batches

- Batch 1's seven method keys already have rows on main or ownership in open
  #1402. No duplicate rows or replacement batch-1 PR. A fresh guarded probe ran
  here: 163 GAP writes inventoried, 274 tables, 7 bounded candidates attempted;
  1 works, 3 needs fixture, 3 validation errors, 156 manual-review holds,
  0 unavailable and 0 coverage credits. All seven still have existing owners.
- Batch 2's bootstrap/profile and eight exact read rows already merged in
  #1424. The real victim is allowlisted for authorization negatives; a separate
  excluded employer tests allowlist 404s. Do not replace this with an unlisted
  victim and call its flag denial tenant authorization. No duplicate infra PR
  or unexecuted local allowlist credit is created here.
- Batch 4 audit selected **Performance**. Its 16 non-path GAP writes consist of
  11 methods already owned by existing main rows (and prior/open proof work):
  POST/PATCH action-items, POST/PATCH continuous, PATCH calibration,
  POST/PATCH competencies, POST development-plans, PATCH follow-through-governance,
  POST/PATCH performance as enumerated below.
  Existing rows are not duplicated or credited from this path run. The remaining
  five `self/performance` writes require real employee-session identity rather
  than the table's Owner sessions. They remain GAP/NOT_RUN. No empty family PR
  or unsupported 8–15-credit promise is made.

Exact owned GAP keys: `POST performance/action-items`, `PATCH performance/action-items`,
`PATCH performance/calibration`, `POST performance/competencies`, `PATCH performance/competencies`,
`POST performance/continuous`, `PATCH performance/continuous`, `POST performance/development-plans`,
`PATCH performance/follow-through-governance`, `POST performance`, `PATCH performance`.
Employee-session holds: `PATCH self/performance/action-items`,
`POST self/performance/development-plans`, `PATCH self/performance/development-plans`,
`POST self/performance`, `PATCH self/performance`.

The exact lists, not stale yield estimates, govern the audit; no status is
changed for a skipped, duplicate, partial or unexecuted method.
Batch 5 is a separate main-based document-only triage requiring owner sign-off.
