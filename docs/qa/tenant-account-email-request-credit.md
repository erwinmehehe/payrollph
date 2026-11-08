# Account email request: one provisional method recovery

Method: POST /api/account/email. This is distinct from the previously credited POST /api/account/email/verify.

Exact passing PG16 / localhost production-mode HTTP / non-relaying SMTP workflow: https://github.com/erwinmehehe/payrollph/actions/runs/42480663360/job/128731667810
Passed proof head: 6af8197aee7efc90724fc49067d734c5bfa78f5a.

The existing proof exercises two independently authenticated fictional employer owners, a real higher-ID victim, a same-employer peer, positive own request and token supersession, foreign-address password-gate denials, forged victim selectors and unchanged victim account, token, session, membership, employee, mail and audit state.

Only the unchanged route, runner, contract, test and workflow from that passing run can justify this provisional single-method credit. The new verifier checks exact Git blob hashes and proof-line anchors and fails on source drift, invented receipts or double counting.

Limits: not proof of token consumption, live email delivery, provider APIs, production identity, concurrency/rate-limit completeness, or tenant-wide isolation. Independent security review is PENDING. No production authorization or automatic merge.

Proposed ledger impact: 441 COVERED / 46 GAP becomes 442 COVERED / 45 GAP; 11 PUBLIC-BY-DESIGN is unchanged (498 methods). The existing zero-credit proof runner retains coverageCredits: 0 to accurately describe what the runner itself does; the separate promotion uses its real passing receipt.
