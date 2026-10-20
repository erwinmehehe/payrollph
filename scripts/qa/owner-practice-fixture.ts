import { writeFileSync, mkdirSync } from "node:fs";
import { buildPracticePayroll } from "../../src/lib/practice-payroll-server";

// Fixed engine inputs only. This script does not read employer records.
mkdirSync("qa-artifacts/owner-practice", { recursive: true });
writeFileSync("qa-artifacts/owner-practice/fixture.json", JSON.stringify(buildPracticePayroll()));
