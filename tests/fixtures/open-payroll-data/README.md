# open-payroll-data fixtures

Pinned reference data used only by PayrollPH's independent cross-check tests.

- Source: https://github.com/open-payroll-data/philippines-payroll-data
- Pinned commit: `89513baa13c1d382a2567965eb122995db6e28e8` (2026-06-30)
- Licence: MIT, Copyright (c) 2026 Philippine Payroll Knowledge Base maintainers
- Tests:
  - `tests/rates-crosscheck.test.ts`
  - `tests/wage-13th-crosscheck.test.ts`
  - `tests/premium-pay-crosscheck.test.ts`

The fixture set covers SSS, PhilHealth, Pag-IBIG, TRAIN withholding,
13th-month rules, the regional minimum-wage matrix, and premium-pay
multipliers.

These are **independent transcriptions, not PayrollPH's source of truth**.
A passing cross-check means two maintained datasets agree; it does not replace
verification against the cited SSS/BIR/PhilHealth/HDMF/DOLE/NWPC issuance.
When a cross-check fails, inspect the cited primary source before changing
production payroll logic.

The minimum-wage fixture is intentionally date-pinned and volatile. PayrollPH
keeps `verified: false` on wage rows until the cited government source is
checked directly.

To refresh these files, re-download them from a reviewed upstream commit,
update the pin above, and review every resulting test difference.

MIT License

Copyright (c) 2026 Philippine Payroll Knowledge Base maintainers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
