# Golden payroll Phases 35 and 36

The real payroll engine calculates three consecutive fictional cutoffs on disposable PostgreSQL 16. The test supplies the releasing state normally claimed by the release endpoint, then calls the normal settlement transaction. Expected amounts are fixed centavo literals.

| Cutoff | Loan deduction | Loan balance after release | Advance recovery |
| --- | ---: | ---: | ---: |
| July 15 | ₱1,500.00 | ₱1,000.00 | ₱1,050.00 |
| July 31 | ₱1,000.00 | ₱0.00 | ₱0.00 |
| August 15 | ₱0.00 | ₱0.00 | ₱0.00 |

Phase 35 checks that the second deduction uses the balance left by the first release, the loan becomes paid off, and the loan journal contains exactly two payment rows. Phase 36 checks that the original ₱1,000.00 advance and ₱50.00 fee are recovered once, tied to the first run, and omitted from later runs. A second settlement call against each released run is refused.

Both cases passed locally on disposable PG16. The workflow also runs the same fixture on a fresh PG16 service. The scenario exercises the settlement transaction with the default loan-settlement profile. HTTP approval, provider delivery, and benefit deferral are outside this fixture.
