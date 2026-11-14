# Approved SAML metadata public classification

The owner explicitly approved the public contract in PR #1981 and required
anonymous OIDC `POST auth/sso/resolve` to remain held. The immutable approval
record is `tenant-saml-metadata-owner-approval.json`; it pins the reviewed field
packet and the unchanged metadata route. No other classification is approved.

Only `GET auth/saml/metadata/[providerId]` becomes **PUBLIC-BY-DESIGN**.
It deliberately exposes the canonical HTTPS origin, enabled SAML provider ID
in SP entity/ACS URLs, and static protocol attributes. It exposes no tenant,
worker, provider secret or session data. Disabled, OIDC and missing providers
retain identical no-store 404s. SAML authentication remains unimplemented/OFF.

## Renewed real proof

[PG16 job 132472217596](https://github.com/erwinmehehe/payrollph/actions/runs/43603213932/job/132472217596)
passed on `b951f2de1bb15f0694a8699ea531e7937db82661`, after syncing main and
fixing CodeQL's insecure temporary-file finding, before reapplying the label.
All **48 HTTP requests** passed against production Next and actual PostgreSQL 16:
two signed-in attackers, an anonymous caller, genuine higher-ID victim, three
enabled controls, three disabled controls, forged selectors, missing/OIDC/invalid
refusals and enabled-to-disabled concealment. Every HTTP read preserved eight
core/identity snapshots and all **260 organization-owned tables**. The only SQL
write was the explicitly isolated fictional one-bit provider-disable fixture.

The downloaded artifact (ID 14117271485) matches the committed receipt exactly.
ZIP SHA256: `39fb80f9541f8d24efba7590d24fd458ee00dc7e8a9c7a5a1f28d54c6fa3a20d`.
Receipt SHA256: `1cb32979074b7c71d1fd0cb4e1c49ffd8dc1a0bd564f34ec7671167a860914de`.
The full import graph, **210 execution inputs** and all **152 numbered SQL files**
remain source-matched. The original first-run receipt is retained byte-for-byte
as `tenant-saml-metadata-initial-executed-receipt.json`.
The previous approval-aware receipt is also retained byte-for-byte as
`tenant-saml-metadata-before-tempfix-executed-receipt.json`. Neither archived
receipt substitutes for the renewed source-current execution.

Receipt creation now uses a private randomly named directory, an exclusive
0600 file write and the exact generated path passed through the CI step output.
The label was withdrawn while this executed input changed and reapplied only
after the fresh HTTP proof passed. No security alert suppression was added.

## Guards and historical evidence

The original privacy hold remains a strict GAP-only verifier. Its original
three test sources and original GAP row are sealed in a historical archive.
Only two exact reviewed test adapters may read that archive. Mutation tests
still reject altered runtime source, missing privacy checks, arbitrary test
changes, expanded approval scope and fabricated execution results.

Historical page/payroll validation may reconstruct the former metadata GAP
only after verifying this exact owner-approved public policy. That view is never
written to the live ledger. Actual classification additionally requires the
source-current executed receipt; approval alone grants no label or credit.

## Accounting

461 COVERED / 2 GAP / 23 PUBLIC / 12 TOKEN becomes
**461 COVERED / 1 GAP / 24 PUBLIC / 12 TOKEN**, still 498 methods.
**Zero COVERED credits are added.** The remaining API GAP is anonymous OIDC
resolve, intentionally held by the owner. Page/action statuses are unchanged.

SOLO_VERIFIED_DEV_RECOVERY. No independent certification, provider/SAML login
activation, production SQL/Neon access, money flag change or deployment authority.
Final-head applicable CI and maintainer review remain required before merge.
