# Workspace Invitations POST tenant isolation: provisional negative boundary

Manifest status: POST invitations = GAP. This is an independent invitation-family batch with no open invitation PR at selection.

Scope: three real fictional employers in disposable PostgreSQL 16, each with its own authenticated owner and a real persisted invitation row. Two independent owner attackers attempt to list and create invitations for a higher-ID victim employer. Both must receive 403, with no victim marker leaked, and unchanged invitation, membership, employee, payroll and audit state for all three employers. Each genuine own invitation GET must return the correct nonempty row, and a response from employer A must not satisfy employer B's positive assertion.

Limits: the successful POST invitation creation, delivery queue, token issuance, SaaS subscription gating, all invitation acceptance flows and complete method coverage are NOT PROVEN. The existing GET listing is used as a populated positive only. No coverage credit is added.

Safety: only fictional data in a fresh PostgreSQL 16 app_db on localhost. The guard runs before application imports. No live mail/provider credentials, payroll activity, deployment, source routes, schema, migrations, feature flags or coverage ledger edits. Workers, scheduler and payouts disabled.

Acceptance: dedicated exact-head real HTTP job and CI must pass; independent reviewer must inspect negative evidence and lack of collateral changes. A separate end-to-end authorized POST proof is required before whole-method credit. Keep draft and unmerged.
