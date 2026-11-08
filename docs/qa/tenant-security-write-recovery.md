# Three complete security-write methods

Label: **SOLO_VERIFIED_DEV_RECOVERY**. This is fictional local development
evidence, not independent review or production acceptance.

| POST method | Executed boundary |
| --- | --- |
| `documents` | Both legacy and private-vault profiles. Two attacker owners upload four documents, two employee actors upload only to themselves despite forged worker selectors. Ten denial controls, six discriminators and two reached initial-audit rollbacks per profile. Vault additionally proves two reached final-audit failures leave only unreadable pending intents. Actual route storage and scanner calls use bounded reserved-host transports; bytes and read-back hashes are checked. |
| `biometrics/sync` | Each attacker succeeds with both a device credential and a session. Own IN creation and OUT update are checked against persisted worker, employer and exact timestamp. Nine denials, four discriminators, replay suppression, real higher-ID victim and unchanged payroll/pay-profile snapshots. |
| `developer` | Both attackers exercise create-key, revoke-key, create-webhook and test-webhook. Real victim resources follow owned comparators. Actual key-auth employee reads and revocation are checked. Webhook delivery SQL is matched to signed wire-body and signature hashes at the blocked-network transport. Six reached audit failures roll back mutations. |

Baseline: **441 COVERED / 46 GAP / 11 PUBLIC-BY-DESIGN** of 498.
This batch proposes exactly **444 COVERED / 43 GAP / 11 PUBLIC-BY-DESIGN**.
Email POST is excluded because concurrent #1862 owns its promotion. Transfers,
Careers, invitations, enterprise and filing-outcome work are also excluded.

The sealed receipt records the executed commit and transitive source/proof/config
pins. `tenant-security-write-credit.mjs --check` validates all four executed
cases, exact counters, flags, distinct methods and complete manifest evidence.
Changing any pinned input requires a fresh run and reviewed receipt, not a repin.
The generic table credit preview may find other candidates; this batch does not
apply those unrelated credits.

## Execution

Use a separate worktree, real `npm ci`, and an owned disposable PG16 cluster at
`outputs/security-write-pg16`. The local wrapper refuses other clusters, any
remote DB target, inherited external credentials or enabled money/provider flags.
The UTF8 initializer preserves earlier fixture databases by rename; it does not
drop an existing database. It runs the reviewed isolated schema/baseline only.

Build once with `node scripts/qa/tenant-security-write-local.mjs build`. For each
case below, stop the owned server, run `db <profile>`, start `start <profile>`,
then execute the family. Every case begins with zero users and employers.

| Family | Profile |
| --- | --- |
| `documents` | `legacy` |
| `documents` | `vault` |
| `biometrics` | `legacy` |
| `developer` | `legacy` |

The dedicated PR workflow repeats these cases with a PG16 service, one build,
fresh fixture database per case and sanitized result artifacts only. No live
scanner, object store, provider, email or webhook network access is permitted.
This validates tenant boundaries, not a real external service integration.

An actual temporary no-op `assertStoredDocument` was rejected by the real HTTP
runner with `document validator accepts another employer's data`. The mutation
was restored before clean-source execution. No mutated proof earns a credit.

All payout/provider, final-pay, exact-thirteenth, history, CSP, worker and
scheduler flags remain OFF. No application route is changed. Reverting this PR
removes only proof infrastructure and three development credits; it activates
no product behavior.

## Local validation receipt

Executed proof source: `da1a6458e89f41d7a968dca6928ef7af99225928`.
All four production-mode HTTP/PG16 cases passed on that committed source;
the final metadata-only commits preserve every sealed runtime/proof pin.

- Production build and `tsc --noEmit`: PASS.
- Lint: zero errors, ten existing warnings, zero warning-debt violations.
- Full selected tenant guard suite: 1,481 passed, 8 skipped, 8 failed. The
  failures are the seven DL-02 POSIX file/symlink/hard-link permission cases
  and the private-0600 allowlist-preseed case on Windows. Their guards were
  not removed or relaxed; Linux PR CI is still required.
- Dedicated environment/egress and queue guards: 11 passed.
- Sealed credit verifier tests: 4 passed, including mutation and source drift.
- Repin: 2,303 unchanged, 15 new citations, zero moved, zero needing review.
- Shared reconciliation check: no new credits; check-only table preview finds
  three unrelated candidate rows, which this batch deliberately does not apply.
- Workflow YAML parsed. CI and independent review: **not yet run / PENDING**.
