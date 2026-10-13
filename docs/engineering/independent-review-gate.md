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
