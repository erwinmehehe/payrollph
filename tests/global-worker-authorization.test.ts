import assert from "node:assert/strict";
import test from "node:test";
import { requireGlobalWorkerToken } from "../src/lib/global-worker-authorization";

const token = "fictional-only-worker-" + "x".repeat(48);
const disabledMessage = "Worker unavailable until configured.";

function request(workerToken?: string, cookie?: string) {
  return new Request("https://payroll.example.test/api/webhooks/drain", {
    method: "POST",
    headers: {
      ...(workerToken === undefined ? {} : { "x-worker-token": workerToken }),
      ...(cookie === undefined ? {} : { cookie }),
      origin: "https://payroll.example.test",
    },
  });
}

test("global cross-tenant workers deny missing, forged and browser-only credentials", async () => {
  const previousToken = process.env.WORKER_TOKEN;
  const previousMaster = process.env.TOTP_ENCRYPTION_KEY;
  try {
    // Remove both dedicated and derived-token configuration. Nothing can run.
    delete process.env.WORKER_TOKEN;
    delete process.env.TOTP_ENCRYPTION_KEY;
    const unavailable = requireGlobalWorkerToken(request(), disabledMessage);
    assert.equal(unavailable?.status, 503);
    assert.deepEqual(await unavailable!.json(), { error: disabledMessage });
    assert.equal(unavailable?.headers.get("cache-control"), "no-store");

    // A signed-in tenant browser cannot run any cross-tenant job.
    process.env.WORKER_TOKEN = token;
    const browserOnly = requireGlobalWorkerToken(
      request(undefined, "session=fictional-tenant-cookie"), disabledMessage,
    );
    assert.equal(browserOnly?.status, 401);
    assert.deepEqual(await browserOnly!.json(), { error: "A valid worker token is required." });
    assert.equal(browserOnly?.headers.get("cache-control"), "no-store");

    const forged = requireGlobalWorkerToken(request("incorrect-worker-credential"), disabledMessage);
    assert.equal(forged?.status, 401);
    assert.deepEqual(await forged!.json(), { error: "A valid worker token is required." });

    // Only a matching operational credential reaches the downstream work path.
    assert.equal(requireGlobalWorkerToken(request(token), disabledMessage), null);
  } finally {
    if (previousToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = previousToken;
    if (previousMaster === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = previousMaster;
  }
});
