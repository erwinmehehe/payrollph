# Issue #1102: final hosted UI check (operator evidence required)

**Repository evidence from October 20, 2026 says the original fictional
Neon rows were already repaired. Do not reapply the guarded header UPDATE.**
See \`docs/qa/issue-1102-manual-neon-operator-handoff-20261018.md\`, section
"October 20 authorized original-target execution receipt."

The remaining issue is **actual hosted UI verification**: the serving app
was subsequently connected to a different database, so historical Neon row
correction does not establish that users see the corrected amounts.

1. An authorized operator first confirms the actual Vercel deployment SHA and
   serving database/project/branch/endpoint, privately; DO NOT paste URLs,
   passwords, account data or employee identifiers into GitHub.
2. Obtain one new authorized read-only catalog/aggregate receipt from the
   intended historical demo target, with exactly 3 runs, 8 fictional employees,
   18 detail rows (six per run), matching periods/statuses and centavo sums.
   No data mutation, payment or filing.
3. Observe the three run summaries in the actual hosted authenticated
   application. Also inspect the corresponding API responses through an
   authorized session. Collect ONLY the six gross/net figures per surface.
4. Supply a private JSON file to
   \`npx tsx scripts/qa/verify-1102-hosted-ui-evidence.mjs --file /private/issue1102-ui.json\`.
   Required fields: \`runningSha\` (40 hex chars), \`observedAt\` (ISO
   timestamp), \`verifiedOriginalDbTarget: true\`,
   \`verifiedServedAppDbBinding: true\`, \`observerRole\`, and \`runs\`.
   Each of the three run records contains EXACTLY these fields:
   \`runId\`, \`status\`, \`period\`, \`detailCount\`, \`dbGross\`, \`dbNet\`,
   \`apiGross\`, \`apiNet\`, \`uiGross\`, \`uiNet\`. Money values must
   include exact two-decimal centavos; UI strings may use PHP or ₱.
5. The script only compares operator-supplied numeric evidence against the
   already merged six-row demo fixture generator. Its PASS does not query
   the app or Neon, prove that the observer is genuine, certify the deployment
   or authorize closure by itself. Record signed operator evidence privately,
   including screenshots, actual DB target binding and final independent
   verification before changing #1102 to closed.

The new test suite uses invented test values and deliberately fails stale
legacy headers. No online or production actions, credentials or DB writes
occur in the CI test.
