# Independent tenant-isolation batch: accepted government filing outcomes

**DRAFT / NOT ACCEPTED / ZERO NEW METHOD CREDITS**

This branch targets **one incomplete method**: PATCH /api/compliance/filing-validations/[id].
Prior PG16 acceptance on main covered the "rejected" outcome only. The
remaining "accepted" flow needs legitimate own-tenant positives, not only
denial-only assertions. This branch adds that independent proof without
editing the route, its storage, the shared tenant manifest, or an open PR.

## Independent scope

- POST /api/billing (PayMongo) belongs to separate PR #1874.
- The invitation accept method is scoped to #1872.
- Operator token-only methods belong to #1869.
- Work Queue and People page changes belong to #1875 and #1876.
- This branch changes none of their filenames, shared coverage files,
  endpoint code, or status ledger.
- This proof is separate from the earlier existing rejected-filing
  runner, which is left byte-for-byte unchanged.

## Exact evidence expectations

The workflow first builds Next.js in production mode against a **new,
empty localhost PostgreSQL 16 app_db**. A guard rejects production
connection URLs and anything other than explicit CI, GitHub Actions,
no real provider secrets, money workers disabled and a pre-defined
fictional app origin.

The runner seeds separate, genuine SQL identity fixtures: employer A,
employer B and a higher-ID victim, including employees, payroll runs,
payroll entries, distinct legal entities, active memberships and filing
records. It creates synthetic SSS R-3 source files from fictional
released payroll records using the actual application exporter. The
file hash is generated from those bytes (not hand-asserted or faked).

It must prove:

1. A independently receives HTTP **200** for an actual own accepted
   outcome recorded with the fictional *manual_entry* submission method.
   B independently receives HTTP **200** with fictional *file_upload*.
   Both persist employer-bound accepted filing rows, exact generated
   file SHA, and same-transaction actor-bound audit receipts.
2. Both receive correct denials for a real victim employer ID, a real
   foreign filing ID using their own employer ID, a missing filing ID,
   anonymous requests, cross-origin requests, missing reference,
   impossible filing date and invalid method. Foreign and nonexistent
   resources must not be distinguishable.
3. A real PostgreSQL audit insert veto must roll back an otherwise
   valid acceptance. Denied, rolled-back, own and replay attempts
   must leave the victim's nonempty filing, payroll, employee,
   organization, membership, audit and outbox snapshots byte-identical.
4. An already accepted record must be immutable on replay.
5. No external agency, payment, government portal, mail or banking
   traffic occurs. There is no production SQL, real employer,
   external payroll release, remittance or money movement.

**Crucial:** Strings such as CI-FICTIONAL-ACK-10 are *synthetic test
inputs only*. A successful HTTP "accepted" state in this test database
does **not** prove a real agency has acknowledged a filing or that the
worksheet meets an agency's upload specification.

## Review and credit gate

The new workflow is "Tenant compliance accepted filing (independent
fictional PG16)". Unit guards and the independent real HTTP proof run
against the exact PR SHA. Review both successful cases, denial matrix,
real SQL and audit rollback, and source hashes.

No method credit is promoted in this PR: the existing
scripts/qa/tenant-isolation-coverage-manifest.json status remains GAP,
and the frozen queue and counts are unchanged. Any future ledger
promotion needs a separate source-pinned receipt, exact final-head CI,
no open-PR overwrite, and independent security/privacy/payroll/tax
review. Even after that, it is not tenant-wide or production approval.

The PR must not merge or deploy simply to increase coverage counts.
