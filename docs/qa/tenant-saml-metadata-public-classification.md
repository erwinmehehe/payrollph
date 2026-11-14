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

[PG16 job 132463076678](https://github.com/erwinmehehe/payrollph/actions/runs/43600190245/job/132463076678)
passed on `c85f7022dada3af9f8fe50e5bf2ee120256725da`, before applying the label.
All **48 HTTP requests** passed against production Next and actual PostgreSQL 16:
two signed-in attackers, an anonymous caller, genuine higher-ID victim, three
enabled controls, three disabled controls, forged selectors, missing/OIDC/invalid
refusals and enabled-to-disabled concealment. Every HTTP read preserved eight
core/identity snapshots and all **260 organization-owned tables**. The only SQL
write was the explicitly isolated fictional one-bit provider-disable fixture.

The downloaded artifact (ID 14115863849) matches the committed receipt exactly.
ZIP SHA256: `0a40cde497a6734a9c5a6fb468e7ec4fe8486beb4690559c2c6272b42466392c`.
Receipt SHA256: `f1eaed5965db7ef722f33f4b0d692071159fa5494a41e1f047f794eaf4f48aec`.
The full import graph, **208 execution inputs** and all **152 numbered SQL files**
remain source-matched. The original first-run receipt is retained byte-for-byte
as `tenant-saml-metadata-initial-executed-receipt.json`.

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
