# Employer-specific external acceptance evidence binding

The `payroll:ga:evidence` private release assessment **requires** a binding
manifest that associates the already-verified external source documents with the
same reviewed payroll engine commit, legal employer and real parallel payroll months.

It does **not** validate a government portal, certify payroll compliance or
authenticate reviewer signatures. It compares IDs, actual local file SHA-256
digests and original issuer references that must still be verified by a human.

## Private operator flow

Use the existing ignored, encrypted employer-specific directory:
`certification/external-private/EMPLOYER_CODE`. Keep original government,
bank and payroll records there, never in GitHub/CI.

1. Collect two real independently reconciled payroll months with at least 10
   matched workers each. Run `payroll:parallel:check`.
2. Collect originals for reviewer opinion and license, all five government
   submission/acceptance pairs and accepted/rejected bank test evidence.
   Run `payroll:evidence:check`.
3. Copy `certification/acceptance-bindings-template.json` to your private
   `bindings.json` and replace every placeholder. Use the **same evidence IDs,
   hashes and external references** already in `manifest.json`.
4. Check the bindings alone if useful:

```bash
npm run payroll:acceptance:check -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/bindings.json \
  certification/external-private/EMPLOYER_CODE/files \
  EXACT_40_CHARACTER_REVIEWED_ENGINE_COMMIT_SHA
```

5. Run the **mandatory combined GA evidence assessment**, including the
   existing nine operational proof documents and independently witnessed DR:

```bash
npm run payroll:ga:evidence -- \
  certification/external-private/EMPLOYER_CODE/parallel.json \
  certification/external-private/EMPLOYER_CODE/manifest.json \
  certification/external-private/EMPLOYER_CODE/operational.json \
  certification/external-private/EMPLOYER_CODE/bindings.json \
  certification/external-private/EMPLOYER_CODE/files \
  EXACT_40_CHARACTER_REVIEWED_ENGINE_COMMIT_SHA
```

The accepted programmatic status is
`evidence-ready-for-independent-final-review`, with `gaApproved: false`.
Errors, missing manifests, stale SHAs, mismatched employer/month scope,
duplicated receipt references, or incorrect bank evidence make it `blocked`.

A qualified independent reviewer must still verify document provenance,
agency acknowledgement authenticity, applicable filing periods, bank
settlement and negative cases, employee statutory treatment, and written
employer-specific release authorization. No automatic GA approval is possible.
