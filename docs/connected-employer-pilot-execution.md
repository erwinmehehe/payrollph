# Connected employer pilot execution

The target is Hire → Onboard → Schedule → Clock In → Approve Time → Run Payroll → Review → Release Payroll Records → Prepare Filing Evidence. The source candidate is PR #836. Automated receipts do not close operational acceptance.

## Execute in order

| Stage | Exercise and expected result | Acceptance still required |
| --- | --- | --- |
| Hire | Approved requisition/position, candidate offer, governed hiring approval and conversion to one worker ID | HR operator witnesses actual candidate conversion; record creation alone is insufficient |
| Onboard | Source checklist and employee inputs remain tied to that same worker | Owner/payroll users complete the seven-step phone journey without developer help; record blockers and retries |
| Schedule | Manager publishes the governed seven-day, multi-site roster; worker sees only approved shifts | WFM manager executes #691 scenarios WFM-01..14, including concurrency and tenant switching |
| Clock In | Same worker records a permitted punch with schedule/site evidence | Physical phone/device, GPS/privacy where enabled, offline/replay and failure evidence; seeded punches are insufficient |
| Approve Time | Distinct reviewer approves the exact time snapshot; correction makes approval stale | Independent operator verifies cutoff lock, correction/reapproval and immutable history |
| Run Payroll | Payroll officer calculates the same cutoff and inspects source trace | Incumbent employer payroll is independently compared, employee by employee and component by component |
| Review | Distinct checker reviews wages, contributions, withholding and exceptions | Zero unexplained differences over PHP 0.01 under #579; retain explanations and reviewed originals privately |
| Release Payroll Records | Owner checks the approved snapshot and releases records; employee sees payslip | No payout instruction or money movement. Record-release evidence remains separate from payment evidence |
| Prepare Filing Evidence | Generate/download exact hash-bound draft worksheets; retain original bytes/version | Official agency validation and genuine receipts, signed off independently; downloaded worksheets are not accepted filings |

## Required inputs before a real run

1. A consenting employer, completed incumbent payroll period, authorization to process its records and an approved private encrypted evidence location.
2. An isolated protected staging app with exact deployed SHA, reviewed schema and rollback, distinct operator accounts, disabled live disbursement/provider features, and authorized security/privacy/DBA scope.
3. Actual owner, HR/manager, payroll officer and separate checker participants. Record their real identities and expected/actual results privately. AI/test personas cannot sign for them.
4. Physical phone/device access and a person executing the device scenarios. Use `docs/wfm-pilot-acceptance-matrix.md` for the existing fourteen required scenarios rather than replacing that matrix.
5. Original incumbent register and journal plus matching PayrollPH exports. Normalize using `docs/payroll-certification/private-parallel-reconciliation.md`, preserve transformation mapping and original hashes, then run the private one-period checker with `--pilot`. A clean arithmetic report still needs independent source review.
6. Authorized agency operators and genuine validation/acknowledgement evidence using `docs/ph-official-filing-acceptance-pilot.md`. Do not enter synthetic acceptance references. BIR annual DAT validation and Form 2316 issuance are separate from monthly worksheets.

## Current gate decision

Until those inputs and signed results exist: **NO-GO for declaring the employer journey accepted or submission-ready.** Production #112, WFM #691, real reconciliation #579 and the #744 register remain open. Do not enable production, move money or submit real agency returns from a synthetic test run.

After acceptance, resume the deferred roadmap in this order: real operational-demand observations with measured backtesting; scheduling usability corrections observed during the pilot; governed compensation-cycle workflows. Preserve the pilot freeze on broad module expansion while these gates remain open.
