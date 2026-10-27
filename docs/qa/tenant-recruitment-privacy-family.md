# Recruitment applicant privacy: tenant-isolation request proof

**Scope:** one new provisional write-table row, `PATCH recruitment/privacy` with
`action: request_delete` only. The authoritative coverage manifest marks this method
`GAP`; this change does not edit the manifest, shared runners, live API or security
configuration and earns **zero coverage credits** until separate reviewed acceptance.

The shared `flagged-reads` synthetic profile enables
`APPLICANT_PRIVACY_CONTROLS_ENABLED=true` only in a disposable test server.
Its two independently authenticated owners have current fictional MFA state.
Each employer gets a persisted requisition, applicant and unpurged privacy evidence;
all victims use their **real, higher** database IDs, not guessed selectors.

| Probe | Required result |
| --- | --- |
| Own `PATCH` request with actual applicant ID | HTTP 200 `requested`; only the own privacy row gains requester ID, reason and timestamp; exactly one actor-bound audit event |
| Attacker session specifying real victim organization/applicant | HTTP 403; neither employer changes and no victim marker is disclosed |
| Attacker session specifying own organization with real victim applicant | HTTP 404; no own or victim row/audit change |
| Post-request source of truth | Existing requisition, candidate PII/stage, unrelated privacy rows, review/hold/erasure fields and prior audit events unchanged |

Use the normal table runner. Its shared two-attacker/higher-ID-victim checks also
compare the victim's organization, employees, org units, legal entities and audit
and require that a second employer's genuine own response **cannot** satisfy the
first employer's assertions. This row independently snapshots all employer-scoped
requisitions, candidates, privacy evidence and business audit. It deliberately
never uses `approve_delete` or `erase`, never changes resume storage and never
purges a record, even in the disposable database.

## Verification before acceptance

- Source-level negatives: `node --test tests/tenant-recruitment-privacy-family.test.mjs`.
- Real proof: full `Tenant table proof` GitHub workflow on the **exact PR head**,
  particularly the `flagged-reads` PostgreSQL 16 + production-mode localhost HTTP
  write profile, alongside unchanged default/multi-entity/allowlisted profiles.
- Independently review the actual method's own-positive, foreign, forged and
  unchanged-database assertions. CI on a superseded head or merely passing Node
  tests is not acceptable evidence.
- Keep this method **GAP** and global tenant-isolation/release gates **NO-GO**
  until an independent evidence/manifest reconciliation is approved. Other
  `PATCH recruitment/privacy` branches (`approve_delete`, `erase`) and
  `POST recruitment/hire` are **not** demonstrated by this request-only proof.

No production database, external service, applicant data, provider, payout,
government filing, release switch or money movement is used or authorized.
