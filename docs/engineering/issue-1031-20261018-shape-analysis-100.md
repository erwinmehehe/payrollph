# Issue #1031 — read-only, source-only migration shape analysis (100 named tables)

**CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL**

**INCOMPLETE — RELEASE NO-GO. This is not the historical 113-table final-state parity proof.**

## Evidence provenance

- `git fetch origin main` was attempted from an initialized local repository and failed because github.com DNS resolution is blocked. The GitHub connector then pinned every file read to the current `main` commit **8263346e4433c7c6699c8df9d3ff6aeae9725c9d**. No stale checkout was used. After the source snapshot was pinned, `main` advanced to `0921b02ad73475e4eaf76ea6b45f65efc046ce5d` via a payout-related merge. An exact commit comparison found no changes to `src/db/schema.ts`, `drizzle/`, the #1198 named inventory, the source worksheet or the crosswalk; the pinned analysis inputs remain unchanged.
- `docs/engineering/issue-1031-schema-drift-remediation.md` and merged PR #1097 preserve the historical **137** absent-table count but **not its 137 individual names**. The historic 113 with numbered creators therefore cannot be established from repo evidence. Do not fabricate 13 missing identities.
- A distinct, dated October 17 #1198 catalog observation preserves **124 named absent tables**. Its independent list joins to **100** numbered-file creating tables in the current 271-row source crosswalk; the other **24** do not have numbered creators in that crosswalk. Those **100** are the scope of the attached CSV, not the historical 113.
- The latest worksheet contains **148** `drizzle/` entries, and 53 source files are statically marked as creating or touching these 100 names. Neither the historical 142-file count nor any filename proves deployment or receipt.

## Classification counts (the named 100 only)

| Class | Rows |
| --- | ---: |
| MATCH | 0 |
| DRIFT | 1 |
| UNPARSEABLE | 99 |
| MIGRATION_ORDER_RISK | 0 |
| **Total** | **100** |

**Confirmed DRIFT:** `automation_event_log` — index `automation_event_log_org_trigger_occurred_idx` specifies `occurred_at DESC` in `drizzle/0081_automation_event_ledger.sql`; its `src/db/schema.ts:5393` declaration omits `.desc()`, which defaults to ASC. A difference in static source is not evidence of a deployed index.

The initial numbered CREATE and the current Drizzle column definition were extracted for **100** rows, with **93** rows containing one or more initial-stage column name, type, nullability or default candidates in the CSV. These **are not certified final-state differences**: later ALTER/RENAME/DROP, conditional or procedural SQL, duplicate numeric prefixes and implicit PostgreSQL semantics may explain them. No table is claimed MATCH.

## What the CSV covers, and does not

Each row records numbered creator and relation-touch sources (with `baseline.sql` identified separately as an unnumbered snapshot, **never** a numbered source or receipt), the Drizzle declaration line, initial column counts and candidate mismatches, PK/unique and FK caveats, matching named index candidates, CHECK counts, later touching migrations, organization column presence, reason for uncertainty, and **six deliberately blank** receipt and disposition fields.

Full final-state equivalence for columns/types/defaults, constraint names, FKs (referenced columns and ON DELETE/UPDATE), index expression/order/partial predicates, CHECK expressions, RLS, tenant isolation, SQL procedural branches and migration ordering has **not** been established. This lexical pass is not the authoritative `scripts/lib/issue-1031-schema-manifest.ts` AST/Drizzle final-shape comparator. Unsupported parsing is **UNPARSEABLE**, never silently MATCH. Migration-order risk is not forced without an unambiguous canonical history.

## Needs human decision

1. Recover an independently attested original **137-name** absence list, with original timestamp, target and source SHA, from *existing* authorized evidence. Do not query production or Neon for this task. Join those names to the current source crosswalk and verify the claimed exact 113.
2. Resolve the 13 duplicate numbered-prefix groups and any prerequisite/order dependencies using authentic migration history evidence, **not filename order**. Flag malformed `0093_mwe_classification_governance.sql`'s dollar delimiter without editing its history.
3. Perform a grammar-checked CREATE/ALTER/RENAME/DROP final-state diff across the exact attested 113, and compare every PK, unique, FK action, CHECK, partial/unique index, default, tenant/RLS signature against `scripts/lib/issue-1031-schema-manifest.ts` and current `src/db/schema.ts`. Unsupported constructs remain UNPARSEABLE.
4. Witness ten complete real MATCH comparisons only once all relevant dimensions and later migrations have been inspected; **zero are established here**.
5. Keep migration receipts **blank**, preserve tenant/security controls in #1075/#1090/#1097 and keep **production NO-GO**. Do not modify migration SQL, runtime schema or deployed databases.

**CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL** — No production/Neon access, no SQL execution against any database, no payroll or payment activity, no migration release approval.
