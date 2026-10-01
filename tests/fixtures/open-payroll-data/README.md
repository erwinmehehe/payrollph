# open-payroll-data fixtures

Pinned copies of four reference tables, used only by `tests/rates-crosscheck.test.ts`
to check Linaw's SSS, PhilHealth, Pag-IBIG and withholding-tax functions against an
independent transcription of the same government tables.

- Source: https://github.com/open-payroll-data/philippines-payroll-data
- Pinned commit: `89513baa13c1d382a2567965eb122995db6e28e8` (2026-06-30)
- Files: `data/sss_2025.json`, `data/philhealth_2025.json`, `data/pagibig_2025.json`, `data/income_tax_2025.json`
- Licence: MIT, Copyright (c) 2026 Philippine Payroll Knowledge Base maintainers

Files are unmodified. Each cites the government issuance it was transcribed from; those
citations have not been independently verified here. These fixtures are test data, not a
source of truth: when a cross-check fails, read the cited circular before changing anything.
To update, re-download from a newer commit, update the pin above, and review any new failures.

```
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
```
