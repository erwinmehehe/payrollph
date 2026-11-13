# Form 2316: hydrated browser, real source API, and unsigned PDF proof

**Test-only / draft security evidence / NOT ACCEPTED.** This review extends the merged Form 2316 SSR isolation test (#1960). It adds no change to application code, migrations, authorized roles, BIR mapping rules, the global tenant inventory, credited historical receipts, or feature defaults. It does not authorize a statutory filing, sign a document, release payroll, make a provider call, or deploy.

## Disposable execution

- Workflow: .github/workflows/tenant-2316-browser-pdf-qa.yml
- Browser/API runner: scripts/qa/tenant-2316-browser-pdf-http.mjs
- Fail-closed source/environment assertions: scripts/qa/tenant-2316-browser-pdf-contract.mjs
- Anti-false-pass tests: tests/tenant-2316-browser-pdf-contract.test.mjs
- Only fresh, empty local PostgreSQL 16 app_db, local production-mode Next on 127.0.0.1, Chromium headless shell pinned to Playwright 1.55.0. The complete fixture is fictional; providers, worker, central scheduler and money movement are OFF.
- Refuses unsafe environment variables, external API credentials, drift in the original #1960 sources, or drift in the certificate API, client, withholding, digest and PDF generator.
- The only stored sensitive example values are encrypted with newly generated disposable keys. Real login credentials and TOTP secrets are fabricated at runtime and never printed.
- Checkout pins the exact PR head, and only a separately executed successful job on that head constitutes a passing test. The run may remain queued, fail, or be cancelled; no credit follows from merely adding a workflow.

## Evidence required from the executable test

1. Three independent fictional parent employers with distinct company-wide owner sessions, genuine password plus authenticator (TOTP) logins and persisted higher-ID victim.
2. A second, populated but ungranted legal employer under the same parent; it has its own actual worker, legal entity, payroll release, and historical separation evidence, and is not accessible through the owner's grant.
3. Distinct released payroll entries and final-pay source records: real employer/worker IDs, valid encrypted employee TIN/branch, legal-employer BIR registrations, payroll entry with a posted zero WHT code, nonzero PHP 10,000 taxable compensation, annualization snapshot, three distinct maker/checker/releaser identities, and an actual release reference/timestamp. The final-pay calculation is internally consistent; it does not imply an employer paid or filed anything.
4. Positive authenticated real HTTP GETs must return employer/worker-specific, nonempty source records, exactly one posted withholding ledger entry, source digest and no other-employer or same-parent ungranted worker markers.
5. Chromium must render the selected employee and tax year; an actual button click loads payroll source. Test fills every prescribed text/amount field, selects the employer type, explicitly reviews previous employer and PERA, and acknowledges the unsigned preview before submitting.
6. The generated PDF must be downloaded through the real browser, not reconstructed by a test helper. Its bytes are parsed by pdf-lib; verify one official-template-size page, expected fictional employer, a nonzero item 39, draft/unsigned notices, and no fabricated signature fields. The API must record the expected bounded audit metadata without storing full TIN.
7. Real historical employer attribution is checked after transferring the worker's current legal employer away from the frozen released employer; the frozen-employer PDF remains accessible to the prior authorized operator while worker-only annual scope remains deferred.
8. Real SQL source change invalidates an earlier source digest. Incomplete review and forged digest must not produce a PDF; cross-origin mutation must refuse; a browser mobile viewport of 390px must be usable.
9. Existing, higher-ID foreign employer plus same-parent ungranted employer GET/POST and browser navigation must be refused, with no private markers. Revoked historical legal-entity grant and revoked membership must deny GET, POST and page on the existing authenticated sessions. Assert protected payroll, source, grant, employee and audit tables unchanged for failed requests; own GET/PDF is permitted only to append its expected audit records.
10. The test runner must emit one structured pass marker only after all observed positives, negatives, audited PDF downloads and SQL invariants succeed. No assertion can be replaced by a static fixture/status guess.

## Explicit remaining gates

- This is an integration test, not an independent security, privacy or Philippine tax-law assessment. It does not automatically establish filing correctness or BIR validation, substituted filing eligibility, full prior-employer source reconciliation, every document delivery option, or real operational readiness.
- The PDF must remain a draft/unsigned preparer preview, with no filing, certificate signature, government submission or payroll release performed.
- The source/API code and existing owner authorization must remain untouched; any new app source change requires full reinspection of all source pins.
- No tenant-method credit or whole-page action credit is requested. Form 2316 remains a page GAP and the full tenant-isolation ledger remains NOT ACCEPTED regardless of green local synthetic tests.
- Human maintainers must inspect the executed GitHub Actions logs and negative cases. Separate independent security, privacy and payroll-tax reviewer acceptance, plus an explicit owner decision, is mandatory before proposing a subsequent source-sealed acceptance/coverage PR.

**Provenance:** prior SSR transfer/revocation evidence #1960 and same-parent worker existence fix #1953; this workflow is independent additional browser/API/PDF coverage, not a replacement for historical source receipts.
