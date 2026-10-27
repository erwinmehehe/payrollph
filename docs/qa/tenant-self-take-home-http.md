# Employee take-home estimate tenant isolation: one uncredited GET

## Identity and collision boundary

- Exact candidate: **GET \`/api/self/take-home-estimate\`** (\`GET self/take-home-estimate\`).
- Independent **Employee Self-Service take-home estimate** read family.
- At initial selection, no active PR owned this family. Other active PRs addressed ESS documents/identifiers/development, Attendance offline claims, HMO, Careers, Performance governance, Invitations, and other unrelated areas.
- The authoritative tenant-isolation manifest remains **GAP** for this GET. This PR modifies no manifest, credit script, application handler, runtime release flag, schema, migrations, provider integration, payroll computation or payout mechanism.
- The result is **not** production, regulatory or whole-API tenant-isolation certification.

## Genuine but disposable proof design

A dedicated GitHub Actions workflow provisions fresh **PostgreSQL 16**, creates fictional identities, builds Next in production mode against the isolated database and calls the actual route over \`http://127.0.0.1:3000\`. A fail-closed preflight runs before importing the application, and rejects all hosted database or web targets, active workers, live provider credentials, payment/billing flags, or a non-CI environment.

Two separately authenticated fictional employee attackers, A and B, and a third **higher-ID victim** are inserted in order, with independently persisted organization, legal entity, org unit, employee, pay profile, user membership and session rows. A same-employer peer has another unique profile and session. A and B additionally have *separate* genuine user accounts whose \`employeeId\` points at the real victim worker while their active memberships belong only to the attacker's organization. No real employees or passwords are involved.

The distinct real SQL profiles deliberately exercise three pay bases:

| Actor | Pay basis | Stored rate | Expected monthly basic |
| --- | --- | --- | ---: |
| Attacker A | Daily | Fictional 720.00 × 22 workdays | 15,840.00 |
| Attacker B | Hourly | Fictional 375.00 × 8 hours × 22 workdays | 66,000.00 |
| Higher-ID victim | Monthly | Fictional 88,500.00 | 88,500.00 |
| A's separately signed-in peer | Monthly | Fictional 97,300.00 | 97,300.00 |

The source's fallback \`employee.basicRate\` remains 20,000.00, so a vacuous test that ignores the actual profile cannot pass. A also has a fictional \`mwe\` flag set, and the estimator is cross-checked against the exact source \`asOf\` date.

## Acceptance assertions

1. The real victim and both attackers each receive HTTP 200 with **their own** nonempty baseline, exact 12-field take-home estimate, explicit estimate-only caveat, and private \`no-store\` headers. A's successful HTTP body must **fail** B's expected salary assertion, and vice versa.
2. Both attackers submit the victim's actual organization/employee ID and pay fields as forged GET query parameters. The endpoint must still derive identity exclusively from the signed-in session and return the attacker's own baseline. The same-employer peer's real login must see the peer's distinct pay, which A cannot select by query.
3. Both genuinely signed-in forged cross-employer worker links must be denied HTTP 403; anonymous access must return 401; two owner sessions and the unlinked employee account must return 403. Denied bodies must contain no baseline, estimated pay or victim marker.
4. After a real employee membership is revoked in the **disposable fixture only**, its formerly valid session must receive 403. No other employer may change.
5. PostgreSQL snapshots are compared before/after real positive and negative HTTP reads: organizations, employees, populated pay profiles, payroll runs, their scoped payroll entries, memberships and audit business fields. The one deliberate fixture-side membership revocation is separately snapshotted and must not trigger any other write.
6. The pure adversarial contracts are mutation-tested so empty, swapped, malformed, extra private fields, wrong salary, wrong pay basis, public cache directives, or missing denials are rejected. Existing route's identity and membership guards are source-checked.

All session cookies are generated for fake accounts and written **only** to a \`0700\` randomized CI-only directory with a \`0600\` no-symlink fixture; logs/environment exports contain its path, not cookie values. No real PayMongo, Xendit, bank, salary transfer, email, worker, scheduler, company deployment or external provider is used.

## Verification and limitations

- [ ] Exact-PR-head \`node --check\` and adversarial \`node --test\` finish successfully.
- [ ] Dedicated \`ESS take-home tenant isolation (fictional PG16 HTTP)\` job passes the actual authenticated localhost HTTP/SQL evidence, including independent actor positives and denied forged links.
- [ ] Full exact-head CI, security HTTP smoke, CodeQL and relevant repo-required checks pass; investigate real failures.
- [ ] Independent security, HR/pay privacy and financial review accepts the evidence.
- [ ] A **separate** method-level reconciliation is reviewed before any \`GAP → COVERED\` promotion; **zero coverage credits** in this PR.

This test cannot certify statutory tax parameters, actual released payroll, live integrations, other ESS routes, other tenant methods, a production migration or a payout. Treat all skipped and pending checks as *not proven*. Never merge merely because the branch has no file conflicts.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / NO PRODUCTION FLAGS OR PAYOUT / ZERO COVERAGE CREDITS.**
