# Vulnerability disclosure — reporter guidance (DRAFT)

**Source of truth:** [SECURITY.md](../../SECURITY.md) governs supported code, scope, reporting contact and response expectations. This page does **not** supersede that policy, create a new reporting channel, announce a bounty, promise safe harbor or authorize testing on customer data.

## Before submitting

- **Reporting channel: TODO-OWNER.** [SECURITY.md](../../SECURITY.md#reporting-a-vulnerability) still contains an unassigned private contact. **No operational private reporting endpoint has been verified**; the repository owner must configure and test one before presenting this as a live reporting program.
- **Do not publish vulnerability details in a public issue.** Avoid real payroll records, government identifiers, bank information, credentials, private keys, employee images and customer information. Use synthetic reproduction data only.
- **Scope:** see [SECURITY.md — Scope](../../SECURITY.md#scope) for application/server/API coverage, supported `main` version and third-party boundary. Do not probe real tenants or providers without permission.

## What to include once an authorized private channel exists

- Affected component/route, applicable revision or deployed version **if known**, and a short summary of the potential impact.
- Clear reproduction steps, expected versus observed result, and a proof of concept with **synthetic** data only.
- Whether the issue appears to expose personal data; **do not attach such data**.
- An available contact method for private follow-up.

[SECURITY.md](../../SECURITY.md#response-expectations) describes a **48-hour acknowledgement target after receipt through a designated private channel**, not a guarantee of triage, fix, or public disclosure date. Coordinate any publication with the repository owner after the private channel and response process exist.

## Legal/privacy incident escalation (not a vulnerability-reporting substitute)

For a **suspected personal-data breach**, an authorized operator should separately follow [the DPO draft incident procedure](../security/privacy-breach-response-and-processors.md) and the [DPA counsel checklist](DPA_COMPLIANCE_CHECKLIST.md#breach-response-runbook-proposed-counsel-approval-required). **TODO-LEGAL:** DPO/counsel determine regulatory/contractual notification requirements and whether the conditional 72-hour reporting windows apply. A vulnerability report by itself does not establish a notifiable breach.

## Publication blockers

- [ ] **TODO-OWNER:** replace and verify the private disclosure contact in [SECURITY.md](../../SECURITY.md).
- [ ] **TODO-LEGAL:** review external-facing reporting language, incident handoff and any legal assurances before presenting a live policy.
- [ ] **TODO-OPS:** test intake, confidential tracking, acknowledgment and escalation using synthetic reports.

**Status: draft; no private disclosure channel, legal assurance, certification or regulatory sign-off is claimed.**
