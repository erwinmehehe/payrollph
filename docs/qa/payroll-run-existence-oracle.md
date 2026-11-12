# Full payroll-run existence boundary

Scope is current main `e2999240e`: fourteen addressed route files plus the root
`runId` read. A run lookup joins the caller's active employer membership before
returning a resource. Missing and foreign-employer runs follow the same existing
404 response; members still reach the unchanged role, unit, legal-employer, MFA,
treasury, segregation and provider guards. The process handler now authenticates
before attempting its first resource lookup, removing its anonymous oracle too.

This changes fifteen route file blobs, not fourteen. Nineteen previously covered
methods are held, including root POST whose body did not change but whose route
file did. Xendit POST was already GAP and is not a withdrawn credit.

`payroll-run-oracle-hold.mjs --write` is a restricted, idempotent withdrawal writer;
it derives counts from statuses and preserves each original proof as historical
metadata. It cannot grant credits. Initial proposal: **456 → 437 COVERED; 7 → 26
GAP**, with no change to 498 total methods or any page/action classification.

## Proof and renewal stages

1. Dedicated actual production Next/disposable PG16 comparison: nineteen
   addressed methods, two attackers, populated higher-ID victim, missing and
   forged selectors, active members with wrong roles, membership revocation,
   identical 404 bodies/observable headers and unchanged victim SQL. Three own
   register reads establish actual owner access and a genuine victim comparator.
   This regression earns **zero** coverage credits by itself.
2. Renew full own-positive contracts in the existing second-pass, high-risk,
   money-lifecycle, run-actions and run-path harnesses. Renew the additional
   read-sweep, explicit exports, reconciliation and connected-impact callers
   found on fresh main. Change only foreign/revoked run expectations to 404;
   same-employer role/unit/MFA/CSRF denials remain 403.
3. Seal successful current-source receipts separately from immutable historical
   receipts; restore only the exact methods with complete own positive, genuine
   victim denial, forged-selector and unchanged-victim proof. Do not repin old
   source receipts as if they ran on this source.

Current execution: **NOT_RUN**. Source checks/TypeScript are not PG16 proof.
Existing source-credit guards may remain red during withdrawal/renewal; no
check is bypassed, and this draft must not merge in that state.

All evidence is SOLO_VERIFIED_DEV_RECOVERY. No production database, Neon,
credentials, real provider, money movement, release flag activation or production
certification. The connected-impact read is enabled only in the disposable proof;
money/history/CSP gates remain OFF. Roll back source and associated classification
as a reviewed unit; never restore historical credits onto changed source alone.
