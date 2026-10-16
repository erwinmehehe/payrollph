/**
 * Synthetic navigation sweep runner hygiene (#1104).
 * Only Playwright browser process closure before any role page is scanned
 * qualifies for one fresh retry. Never retry app, auth or route failures.
 */
export function isNavSweepBrowserStartupLoss(error) {
  const message = String(error?.message ?? error);
  return /^(?:browserType\.launch|browser\.newContext|browserContext\.storageState):/i.test(message)
    && /(?:Target page, context or browser has been closed|Browser has been closed|browser process has exited)/i.test(message);
}

export async function startNavSweepRoleBrowser({ role, launch, authenticate, onRetry = () => {} }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let browser;
    try {
      browser = await launch();
      const state = await authenticate(browser, role);
      return { browser, state };
    } catch (error) {
      if (browser) {
        try { await browser.close(); } catch { /* already disconnected */ }
      }
      if (attempt === 2 || !isNavSweepBrowserStartupLoss(error)) throw error;
      onRetry({ role, attempt, reason: String(error?.message ?? error).slice(0, 320) });
    }
  }
  throw new Error("Unreachable navigation browser startup state");
}

/**
 * Start a fresh Chromium process for the next viewport, retaining only the
 * synthetic role's storage state. Probe context startup before scanning routes.
 * Only an infrastructure shutdown during this pre-scan probe gets one retry.
 * A route failure or a browser death after scanning starts is never retried.
 */
export async function startNavSweepViewportBrowser({
  role, viewport, launch, storageState, onRetry = () => {},
}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let browser;
    try {
      browser = await launch();
      const probe = await browser.newContext({ storageState });
      await probe.close();
      return browser;
    } catch (error) {
      if (browser) {
        try { await browser.close(); } catch { /* already disconnected */ }
      }
      if (attempt === 2 || !isNavSweepBrowserStartupLoss(error)) throw error;
      onRetry({ role, viewport, attempt, reason: String(error?.message ?? error).slice(0, 320) });
    }
  }
  throw new Error("Unreachable navigation viewport startup state");
}

export function compareNavSweepCaseCoverage(expected, observed) {
  const expectedCounts = new Map();
  const observedCounts = new Map();
  for (const key of expected) expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  for (const key of observed) observedCounts.set(key, (observedCounts.get(key) ?? 0) + 1);
  return {
    missing: [...expectedCounts].flatMap(([key, n]) => Array(Math.max(0, n - (observedCounts.get(key) ?? 0))).fill(key)),
    unexpected: [...observedCounts].flatMap(([key, n]) => Array(Math.max(0, n - (expectedCounts.get(key) ?? 0))).fill(key)),
    duplicates: [...observedCounts].filter(([key, n]) => n > 1 && n > (expectedCounts.get(key) ?? 0)).map(([key]) => key),
  };
}
