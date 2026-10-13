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
