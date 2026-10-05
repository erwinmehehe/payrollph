# Customer Proof Intake

Do not publish a customer story until the evidence below is complete.

## Customer approval

- Customer/company name approved for publication.
- Logo usage approved if a logo will be displayed.
- Named speaker and role approved for any quote.
- Final story or quote approved through the agreed customer process.

## Baseline

Document the prior process with a source:
- payroll processing time,
- number of manual spreadsheets/files,
- headcount or payroll population,
- payroll frequency,
- entities/branches,
- recurring exception volume,
- support/payslip workload,
- other relevant operational baseline.

## Implementation

Record what was actually deployed:
- Linaw modules/workflows,
- migration scope,
- integrations or exports,
- approval roles,
- implementation timeline,
- important exclusions.

## Outcomes

Every number needs:
- metric name,
- before value,
- after value,
- measurement period,
- evidence source,
- owner who verified it.

If evidence is unavailable, describe the result qualitatively rather than inventing a percentage.

## Quote approval

Store:
- exact approved quote,
- speaker name,
- speaker role,
- approval date,
- evidence/location of approval.

## Publication rules

- Never convert an estimate into an achieved result.
- Never imply causation beyond the available evidence.
- Avoid “best,” “guaranteed,” “zero errors” and similar unsupported claims.
- If the customer requests anonymity, do not expose identifying details through screenshots, URLs or structured data.


## Publication registry requirements

Before setting a story to `approved: true`, populate:

- `approvalEvidence`: where customer publication approval is stored.
- `approvedAt`: approval date.
- Every metric's `evidenceNote`: the source that substantiates the published value.
- If a quote is present, `quote.approved` must be true.
- An approved quote also needs `quote.approvalEvidence` and `quote.approvedAt`.

The public site, customer-story sitemap and static story routes use the same publication validator. A story with `approved: true` but missing evidence remains unpublished.

## Recommended evidence locations

Evidence can reference an internal CRM record, signed approval email/thread, approved document, analytics report, implementation record or other durable source. Do not place private evidence material directly in public page copy.
