# OSH employer duties matrix (RA 11058)

Status: research only. No code, schema, route or filing is added, and nothing is activated. Evidence label `SOLO_VERIFIED_DEV`. This is not a compliance certification.

Source read: the Lawphil text of RA 11058 (approved 2018-08-17), Sections 1-35, fetched 2026-11-16. It is a reproduction, not checked against the Official Gazette. The page has typos in Sec. 2, 13(e) and 23.

**The implementing rules (DOLE Department Order 198-18) could not be retrieved.** DOLE sites returned HTTP 403 to automated fetch and Lawphil does not host the order. Everything the Act delegates to DOLE is therefore UNVERIFIED below. Secondary web summaries were found but conflict with each other (section numbers, form names, deadlines), so none are encoded here.

## Duties the Act itself states (verified against the statute text)

| Duty | Section | Notes for the product |
| --- | --- | --- |
| Applies to all establishments, projects and sites including PEZA, except the public sector | 2 | DOLE sets criteria by headcount, operations and risk (criteria not in the Act) |
| Micro = under 10 employees; small = under 100 | 3(h) | Only these two definitions are in the Act |
| Safe workplace, job safety orientation, hazard information, approved equipment, PPE and machine guards, worker participation, first-aid arrangements | 4(a), 5, 11 | Employers, contractors, subcontractors and supervisors |
| PPE free of charge, used on the safety officer's evaluation and recommendation | 8 | Cost is a separate pay item in construction and contracting (Sec. 20) |
| Hazard signage in a language all can understand | 9 | |
| Written safety and health program covering items (a)-(p), prepared with workers, submitted to DOLE, available to all | 12 | DOLE approves, disapproves or modifies it |
| Safety and health committee: employer or representative chairs, safety officer is secretary, worker representatives, health personnel where applicable | 13 | Meeting frequency is not in the Act |
| Safety officers, trained by DOLE, with authority to issue work stoppage orders; count proportionate to workers, equipment and area | 14, 3(n) | Numbers and levels are DOLE's |
| Qualified health personnel (physician, nurse, certified first-aider, dentist) | 15 | Ratio is DOLE's |
| Mandatory basic OSH training for safety personnel; mandatory 8-hour safety and health seminar for all workers; specialised training for listed hazardous work | 16 | Candidate for the training-tracking module |
| Critical occupations assessed and certified by TESDA | 18 | |
| Welfare facilities: drinking water, sanitary and washing facilities, separate facilities where applicable | 19 | |
| Submit all safety and health reports and notifications DOLE prescribes | 17 | No deadline in the Act |
| Workers may refuse unsafe work without reprisal when DOLE determines imminent danger and corrective action is missing | 6 | |
| Wages are payable during a stoppage caused by the employer's fault | 23 | Directly affects payroll; text is garbled on the source page |
| Employer, owner, contractors and subcontractors are jointly and solidarily liable | 21 | |
| Administrative fine up to PHP 100,000 per day for willful non-compliance until corrected; separate fine up to PHP 100,000 for obstruction, false statements or retaliation | 28 | DOLE issues the offense list; amounts below the cap are not in the Act |
| Annual DOLE spot audit; entry at any time of day or night; self-assessment does not replace inspection | 22 | |

## UNVERIFIED: delegated to DOLE (do not build from these)

- Risk classification and the headcount thresholds that decide who is covered.
- Safety officer levels, count and full-time versus part-time by size and risk.
- Health personnel ratios, first-aider counts and clinic requirements.
- Committee meeting frequency and exact composition by size.
- Which reports are required, their forms, and their deadlines. Secondary sources named a monthly and an annual work accident report, an annual medical report and a committee report, with conflicting dates and form numbers. None confirmed.
- Notifiable-accident immediate notification rules.
- Recordkeeping periods.
- The offense list and fine schedule below the PHP 100,000 cap.
- Whether DO 252-25 or any later order amended DO 198-18. A secondary source mentions it; not confirmed.

## Next step

Obtain the DO 198-18 text from a copy you can open directly (DOLE or BWC site in a browser, saved as PDF) and put it in the repo or send it to me. With it I can fill the unverified table from the primary text, then scope the smallest useful build. Candidates, in order: an OSH compliance register (program, committee, safety officer and health personnel records per establishment), an incident register with report due dates, and worker training records tied to the 8-hour seminar. Any build touches tenant tables and routes, so it needs its own isolation proof.

## Payroll impact worth building first

Sec. 23 wages during an employer-fault stoppage is the one duty that touches payroll today. Confirm its exact wording from the Official Gazette before encoding a rule.
