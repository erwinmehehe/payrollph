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
permission and authorization checks remain tested.

## HCM/WFM source freeze retired - 14 October 2026

The repository owner explicitly authorized disabling the blanket HCM/WFM
source-merge freeze. Pilot-start variables and per-PR blob exceptions no
longer determine whether development source may merge. Source sensitivity,
complete GitHub diff/head verification, read-only policy execution, optional
strict independent review and required CI continue to apply.

This retires only the source prerequisite. It does not enable features,
authorize deployments or migrations, change business maker-checker approvals,
or grant payroll/payout release authority. MULTI_ENTITY flags remain default
OFF and ENTITY_HCM_DEFERRED proxy, route, scheduler and direct-worker holds
remain unchanged. Production activation still requires separate acceptance.

Historical exact-source exceptions (#888, #925, #963 and development evidence
lanes) are superseded by this policy; their production boundaries remain.
