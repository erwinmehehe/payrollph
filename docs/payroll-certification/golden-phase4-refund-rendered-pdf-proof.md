# Phase 4 refund payslip — additional PDF rendering proof (synthetic)

Merged PR #1783 fixed the economic-bucket source defect: a **positive** `YE-TAX-*` year-end refund is a **negative deduction credit on the displayed payslip**, not a salary earning. Golden Phase 4 already checks real-engine stored line sums.

This follow-up adds **no runtime or DB changes**. Its new test renders the actual production PDF writer with the same split/map sequence used by the employee PDF route, then inspects PDF text sections and centavo totals. It generates two fictional review files in CI:

- `golden-phase4-refund-payslip.pdf`: basic earnings ₱15,000.00, withheld before adjustment ₱1,728.70, tax refund credit **−₱1,200.00** in deductions, deductions ₱528.70, net ₱14,471.30.
- `golden-phase4-collection-payslip.pdf`: basic earnings ₱15,000.00, withheld before adjustment ₱1,728.70, tax collection **+₱800.00** in deductions, deductions ₱2,528.70, net ₱12,471.30.

The PDF label must occur **between** the printed DEDUCTIONS heading and TOTAL DEDUCTIONS; headings and displayed amounts must agree with the independent money literals. The test also guards the employee PDF route's membership and Released-only conditions against accidental removal, although this source guard is *not* real-HTTP authorization acceptance.

## Scope and acceptance limit

This verifies **PDF bytes emitted by the current production renderer**, not the actual authenticated HTTP route, browser visuals, PDF viewer screenshots, employer-workspace UI, or the independent human accept/reject decision. For those outstanding items, continue **issue #2072** with an isolated fictional employer, browser captures and visual PDF review. Do not mark issue #2072 closed solely because these tests pass.

Fictional data only. No Neon, provider tokens, real employees, real money, migrations, effective payroll actions or application changes. Existing Phase 39 (#2071) remains separate.
