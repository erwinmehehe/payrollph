import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  compareNavSweepCaseCoverage,
  isNavSweepBrowserStartupLoss,
  startNavSweepRoleBrowser,
  startNavSweepViewportBrowser,
} from "./e2e/nav-sweep-startup.mjs";

const disconnect = new Error("browserContext.storageState: Target page, context or browser has been closed");

test("only an actual Playwright startup disconnect is retryable", () => {
  assert.equal(isNavSweepBrowserStartupLoss(disconnect), true);
  assert.equal(isNavSweepBrowserStartupLoss(new Error("browser.newContext: Browser has been closed")), true);
  assert.equal(isNavSweepBrowserStartupLoss(new Error("Fictional MFA login: checker")), false);
  assert.equal(isNavSweepBrowserStartupLoss(new Error("HTTP 500 GET /app")), false);
  assert.equal(isNavSweepBrowserStartupLoss(new Error("browserContext.storageState: Forbidden")), false);
});

test("one startup browser loss allows exactly one fresh Chromium/login attempt", async () => {
  let launches = 0, closed = 0, retried = 0;
  const returned = await startNavSweepRoleBrowser({
    role: "checker",
    launch: async () => ({ id: ++launches, close: async () => { closed++; } }),
    authenticate: async (browser, role) => {
      assert.equal(role, "checker");
      if (browser.id === 1) throw disconnect;
      return { syntheticOnly: true, browserId: browser.id };
    },
    onRetry: event => { retried++; assert.equal(event.attempt, 1); },
  });
  assert.equal(launches, 2);
  assert.equal(closed, 1);
  assert.equal(retried, 1);
  assert.equal(returned.state.browserId, 2);
  await returned.browser.close();
});

test("repeated browser death stays FAILED after one retry", async () => {
  let launches = 0, closed = 0;
  await assert.rejects(startNavSweepRoleBrowser({
    role: "checker",
    launch: async () => { launches++; return { close: async () => { closed++; } }; },
    authenticate: async () => { throw disconnect; },
  }), /Target page, context or browser has been closed/);
  assert.equal(launches, 2);
  assert.equal(closed, 2);
});

test("login/auth and application errors do not retry", async () => {
  for (const reason of ["Fictional MFA login: checker", "HTTP 500 GET /app"]) {
    let launches = 0, closed = 0;
    await assert.rejects(startNavSweepRoleBrowser({
      role: "checker",
      launch: async () => { launches++; return { close: async () => { closed++; } }; },
      authenticate: async () => { throw new Error(reason); },
    }), error => error.message === reason);
    assert.equal(launches, 1);
    assert.equal(closed, 1);
  }
});

test("viewport rotation starts a fresh browser from synthetic storage state only", async () => {
  let launches = 0, contexts = 0, closed = 0, probesClosed = 0, retried = 0;
  const state = { cookies: [{ name: "synthetic-session", value: "fictional" }] };
  const browser = await startNavSweepViewportBrowser({
    role: "checker", viewport: 390, storageState: state,
    launch: async () => ({
      id: ++launches,
      close: async () => { closed++; },
      newContext: async ({ storageState }) => {
        contexts++;
        assert.equal(storageState, state);
        if (launches === 1) {
          throw new Error("browser.newContext: Target page, context or browser has been closed");
        }
        return { close: async () => { probesClosed++; } };
      },
    }),
    onRetry: event => {
      retried++;
      assert.equal(event.role, "checker");
      assert.equal(event.viewport, 390);
      assert.equal(event.attempt, 1);
    },
  });
  assert.equal(launches, 2);
  assert.equal(contexts, 2);
  assert.equal(closed, 1);
  assert.equal(probesClosed, 1);
  assert.equal(retried, 1);
  await browser.close();
  assert.equal(closed, 2);
});

test("viewport startup never hides authentication, application or repeated browser errors", async () => {
  for (const reason of [
    "browser.newContext: Forbidden",
    "HTTP 500 GET /app",
    "browser.newContext: Target page, context or browser has been closed",
  ]) {
    let launches = 0, closed = 0;
    await assert.rejects(startNavSweepViewportBrowser({
      role: "checker", viewport: 390, storageState: { cookies: [] },
      launch: async () => {
        launches++;
        return {
          close: async () => { closed++; },
          newContext: async () => { throw new Error(reason); },
        };
      },
    }), error => error.message === reason);
    const retryable = isNavSweepBrowserStartupLoss(new Error(reason));
    assert.equal(launches, retryable ? 2 : 1);
    assert.equal(closed, launches);
  }
});

test("truncated, duplicated and unexpected matrices remain detectable", () => {
  const planned = ["owner:1280:Overview", "owner:390:Overview", "checker:390:Approvals"];
  assert.deepEqual(compareNavSweepCaseCoverage(planned, planned), {
    missing: [], unexpected: [], duplicates: [],
  });
  const bad = compareNavSweepCaseCoverage(planned, [
    "owner:1280:Overview", "owner:1280:Overview", "other:390:Unknown",
  ]);
  assert.deepEqual(bad.missing, ["owner:390:Overview", "checker:390:Approvals"]);
  assert.deepEqual(bad.unexpected, ["owner:1280:Overview", "other:390:Unknown"]);
  assert.deepEqual(bad.duplicates, ["owner:1280:Overview"]);
});

test("navigation sweep still blocks writes, injects HTTP 500 and fails closed", () => {
  const source = readFileSync("tests/e2e/nav-sweep.spec.mjs", "utf8");
  assert.match(source, /BUILD_BLOCK_ACCEPTANCE_MODE.*synthetic-postgres-only/);
  assert.match(source, /route\.abort\("blockedbyclient"\)/);
  assert.match(source, /NAV_SWEEP_INJECT_BROKEN/);
  assert.match(source, /status: 500/);
  assert.match(source, /compareNavSweepCaseCoverage\(expectedCases, observedCases\)/);
  assert.match(source, /startNavSweepViewportBrowser\(/);
  assert.match(source, /await browser\.close\(\);\s*browser = await startNavSweepViewportBrowser/);
  assert.match(source, /page: "SWEEP_COVERAGE",\s*viewport: 0, result: "FAIL"/);
  assert.match(source, /assert\.equal\(results\.filter\(r => r\.result === "FAIL"\)\.length, 0/);
});
