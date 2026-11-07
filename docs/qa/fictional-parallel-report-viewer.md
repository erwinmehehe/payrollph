# Fictional parallel-payroll QA viewer (local only)

This optional report viewer renders **count-only fictional** summary output based on the existing private `payroll:parallel:check` result schema. It does **not** run payroll, change its reconciliation rules, read a payroll CSV, modify a tenant, or send data to a server. It is **not suitable for any real-employer evidence** or launch certification.

## Try it with the checked-in fictional fixture

```sh
node scripts/qa/render-fictional-parallel-report.mjs fixtures/qa/fictional-parallel-report.json /tmp/fictional-qa-report.html --fictional
```

Open the resulting local HTML file in a browser. The viewer uses inline CSS, no JavaScript, no remote images, no network calls, and a restrictive CSP. It refuses to overwrite an existing report file and creates the new file with 0600 permissions.

## Input contract

- The input must be a JSON wrapper containing precisely `fixtureType: "fictional-parallel-payroll"`, `fictionalFixture: true` and a `report` object matching the count-only result schema of `scripts/check-private-parallel-payroll.ts`.
- The employer code must start with `FICTIONAL`, `SYNTHETIC`, `TEST`, `DEMO` or `PH-TEST`.
- No worker identifiers, salaries, private path values, raw payroll CSVs, approval claims, or extra report fields are accepted. Free-text checker issue messages are **never copied into the HTML**; only predefined issue categories and counts appear.
- The displayed result is **arithmetic matched, independent review pending** or **blocked**. Never present it as a certified payroll run or payment instruction.

## Boundaries

Do not run this viewer on a customer's real report by adding a fictional marker. For a real employer, use the existing private `#579` handoff and approved encrypted evidence vault. The canonical verifier and independent reviewer remain authoritative; this viewer adds no reconciliation logic and no production gate.

Regression test: `node --test tests/fictional-parallel-report-viewer.test.mjs`.
