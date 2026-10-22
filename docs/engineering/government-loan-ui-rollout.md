# Government loan read UI rollout

The enhanced panel is opt-in through `NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED=true`.
The registry defaults off. Next.js inlines this public value at build time, so a deployment
is required to activate or roll back the UI. No production activation is included here.

The legacy component is an exact copy of the panel on main at
`47afbe88cda0806070d0a30bb811676e6398d7ec`. Keeping it separate preserves the existing
flag-off screen. The server's employer and legal-entity authorization remains unconditional
in both flag states. This flag never grants a role or permits self-approval.

Before activation, run the government-loan browser workflow and inspect its desktop and
390px screenshots. It renders the actual React components with synthetic transport and
covers loading, failed reads, verified empty reads, foreign-employer payloads, denied
access and retry recovery. It compares flag-off DOM with the legacy component. The
node behavior tests separately exercise member/totals reconciliation and fresh mutation
receipts; the security HTTP workflow checks actual route authorization against Postgres.
Component fixtures do not establish authenticated role or live agency/payment acceptance.

Rollback: remove the variable or set it to `false`, then rebuild/redeploy. No schema or
data rollback is necessary. Keep server scoping enabled. Do not remove the legacy
component until a separately reviewed change explicitly retires this flag.

## Multiple legal employers and authorization

The enhanced panel must first fetch `/api/legal-entities?mode=selector` using
authenticated no-store transport, validate the organization and active legal
employers, and select a single legal employer. With multiple authorized
employers, a user must explicitly choose one. Without verified scope there
are no batch/member reads, posting actions or payment controls.

The selected `legalEntityId` is sent in every GET and POST. Switching
employers remounts the scoped panel and clears the previous employer's
evidence and unsubmitted drafts. Employer switching is disabled while a
mutation is pending. Both server methods independently check legal employer
grants with `resolveMultiEntityContext` and `assertEntityResource`. The
selector may expose only active employers authorized by the user's grants.
These security controls do not turn the UI release flag on.
