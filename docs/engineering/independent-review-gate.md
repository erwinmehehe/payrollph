# Source review for a solo maintainer

The repository owner explicitly selected solo-maintainer source review on
October 13, 2026. A second collaborator is not a prerequisite for a source
merge. Current-head CI, maintainer diff review, dependency reconciliation,
rollback planning and the three-review-ready-PR queue still apply.

The read-only source-policy workflow checks trusted main only and verifies
the actual PR head and complete changed-file list. By default it reports
`solo-maintainer`, zero independent approvals and no production release
authority. It does not manufacture a GitHub approval or write API state.

Independent review remains available as an optional stricter policy:
set the repository variable `INDEPENDENT_SOURCE_REVIEW_REQUIRED=true`,
configure `PAYROLL_INDEPENDENT_REVIEWERS` with real authorized collaborators,
and arrange a different human's approval of the exact head. Only exact
lowercase true enables this mode. Its reviewer identity, current-head,
permission and optional HCM/WFM pilot checks remain tested.

**Exact development WFM-12 test-only exception:** Two **already existing** files
(`scripts/wfm-pilot-synthetic-evidence.mjs` and
`tests/wfm-roster-scale-postgres.test.ts`) may be modified together to prove
synthetic 1,000-worker regression coverage while no external pilot has
started. Both paths must appear, both must have GitHub status **modified**,
and there must be **no other changed file**. Solo-maintainer/strict reviewer
policy is unchanged; current-head CI and queue controls still apply.
This is a *source-test review* exception, **not** approval to publish a
roster, capture real time/photos, activate WFM, apply DDL, certify any
employer's time or payroll, or release money. Every other optional
HCM/WFM runtime, test, API, migration or workflow source change remains
frozen until its real pilot evidence is approved.

**Proposed exact-blob WFM-5 development acceptance exception (#960 only):**
A separate, fictional, no-money CI acceptance PR may add exactly these 3 files:
`.github/workflows/wfm-five-worker-dev-acceptance.yml`,
`docs/wfm-five-worker-development-acceptance.md`, and
`scripts/qa/wfm-five-worker-dev-acceptance.ts`.
The gate checks **each GitHub file status is added and each blob SHA equals
its independently reviewed, previously passing #960 content SHA**. A changed
byte, extra file, renamed/removed path or new WFM/runtime/SQL source file
restores `PILOT_HCM_WFM_FREEZE_ACTIVE`. This grants **only source
integration of exact synthetic test evidence**, not external-pilot activation,
human sign-off, real device acceptance, payroll calculation/release approval,
payout, government filing, DB migration or deployment. The existing
CI/security/queue gates remain mandatory. The owner must explicitly decide
whether to merge this policy proposal; it is not effective while draft.

The independent-review opt-out does **not** waive the separately enforced optional HCM/WFM pilot freeze. Source changes in frozen lanes remain blocked until the approved pilot flag and a valid evidence reference are present. Core Payroll/People/Time fixes that are outside those paths can proceed under the regular CI rules.

This policy governs source integration only. Employer maker-checker,
tenant isolation, production migration approval, restore evidence, payroll
reconciliation, feature activation and bank/payout authorization remain
separate. Source merges never authorize payroll release, production SQL,
deployment or money movement. New product flags remain default OFF.

The former mandatory-independent-review policy introduced by #884 is
superseded by the owner's explicit instruction. Production safeguards are
not waived. This change does not close first-paying-customer operational
acceptance or certify a live pilot.

## Proposed #691 immutable offline witness packet exception (owner decision required)

**Draft proposal only: no current source-freeze waiver until an authorized merge of
this policy change.** The exact already-reviewed #969 evidence tooling would be
eligible for source integration only if GitHub reports precisely three added files
with these Git blob identifiers:

- `docs/qa/wfm-691-independent-witness-handoff.md`: `4cbcc7bb09e21e0d836f4d52fb17750273bdd2bc`
- `scripts/qa/wfm-independent-witness.mjs`: `ed923d4bead1dab6f98583b59435fc494a773d1b`
- `tests/wfm-independent-witness.test.mjs`: `5dbfc80577b30365cf17573c1d19693cdb9ce3a0`

The policy rejects a changed byte, duplicate, changed status, renamed path,
omission, extra file, runtime/API/SQL/workflow addition or new money capability.
P0-3 must continue reading the policy from trusted main; no PR may make its own
head authoritative. This exception would allow only a **local offline evidence
recording tool**, never real operator UAT, independent signature verification,
WFM-14 hardware certification, production activation, migration, payment,
government filing or actual #579 employer reconciliation.

Follow the repository's solo-maintainer source policy and current-head CI,
CodeQL and queue gates when reviewing this exact proposal. The owner must
decide deliberately whether #969 merits source integration or should stay
deferred; do not set a false `PILOT_HCM_WFM_STARTED` value.

## Proposed immutable HCM import-regression source exception (#965)

**Draft only — not active until the owner deliberately approves and merges the
policy PR on trusted `main`.** The HCM Hire and CSV employee import regression
tests were updated to check the current split import implementation. An optional
source-only exception is limited to exactly three **modified** files with the
following Git blob SHAs from #965's inspected head:

- `tests/hcm-direct-route-policy-races.test.ts`: `c986dc63f7e490a4e8ec3360f56d2f0a49525539`
- `tests/hcm-governed-intake.test.ts`: `94f9523c257a3b603ab726f61b5b80b11ff6e212`
- `tests/hcm-legacy-write-integration.test.ts`: `ba929f96c369fc9db00e414ae360bf7ee2c4e4ea`

Every byte, file path, blob hash and status must match, with no extra files,
rename, or added test. A changed file or extra HCM API, UI, SQL, workflow or
runtime path remains blocked by `PILOT_HCM_WFM_FREEZE_ACTIVE`. The exception
never proves the tests' behavior with real employers, lifts the HCM/WFM runtime
freeze, changes feature flags, grants source-merge approval for other PRs,
authorizes production deployment or releases payroll.

This source policy may be approved independently of actual WFM-01..14 operator
testing. No pilot-start flag or evidence reference is set by this proposal.
