import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
test("Next's global API rule cannot override private approval denial headers",()=>{
 const config=readFileSync("next.config.ts","utf8");
 const base=config.indexOf('source: "/api/:path*"');
 const specific=config.indexOf('source: "/api/managed-payroll/runs/:id/approve"');
 assert.ok(base>=0&&specific>base);
 assert.match(config.slice(specific,specific+240),/"Cache-Control", value: "private, no-store, max-age=0"/);
 const route=readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts","utf8");
 assert.match(route,/const privateHeaders = \{ "Cache-Control": "private, no-store" \}/);
 assert.match(route,/const runNotFound = \(\) => Response\.json/);
});
