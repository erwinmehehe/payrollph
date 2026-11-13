/* No-DB unit test: execute the actual three compiled route handlers with traps.
 * This is not a production/IdP integration receipt or method coverage credit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

for (const [path, method] of [
  ["src/app/api/auth/sso/start/route.ts", "GET"],
  ["src/app/api/auth/sso/callback/route.ts", "GET"],
  ["src/app/api/auth/sso/resolve/route.ts", "POST"],
]) {
  test(method + " " + path + " refuses before any request, provider, session or DB access", async () => {
    const source = readFileSync(path, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: path, reportDiagnostics: true,
    });
    assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const called = [];
    const forbidden = new Proxy({}, { get(_obj, key) {
      called.push(String(key));
      throw new Error("Forbidden dependency access before hold: " + String(key));
    }});
    const holder = { exports: {} };
    runInNewContext(compiled.outputText, {
      module: holder, exports: holder.exports, Response,
      require(name) {
        if (name === "@/lib/oidc-sso-runtime") return {
          oidcSsoRuntimeEnabled() { called.push("gate"); return false; },
          oidcSsoDisabledResponse() {
            return Response.json({
              error: "SSO sign-in is not available.", code: "OIDC_SSO_RUNTIME_DISABLED",
            }, { status: 503, headers: {
              "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            }});
          },
        };
        return forbidden;
      },
    }, { filename: path, timeout: 1000 });
    const request = new Proxy({}, { get() { throw new Error("Read a caller input before runtime hold"); }});
    const response = await holder.exports[method](request);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), {
      error: "SSO sign-in is not available.", code: "OIDC_SSO_RUNTIME_DISABLED",
    });
    assert.deepEqual(called, ["gate"]);
  });
}
