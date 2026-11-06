import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
test("Next API headers keep private receipt bytes and foreign-ID 404 denials uncacheable",()=>{
 const next=readFileSync("next.config.ts","utf8");
 const global=next.indexOf('source: "/api/:path*"');
 const special=next.indexOf('source: "/api/expenses/receipts"');
 assert.ok(global>=0&&special>global,"Specific private rule must follow generic API headers");
 assert.match(next.slice(special,special+220),/"Cache-Control", value: "private, no-store, max-age=0"/);
 const handler=readFileSync("src/app/api/expenses/receipts/route.ts","utf8");
 assert.match(handler,/"Cache-Control": "private, no-store"/);
});
