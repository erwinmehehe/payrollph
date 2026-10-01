import assert from "node:assert/strict";
import test from "node:test";
import { enforceSameOriginMutation } from "../src/lib/security-request";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("production same-origin Vercel alias is accepted even when APP_BASE_URL names another alias", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    TRUSTED_APP_ORIGINS: process.env.TRUSTED_APP_ORIGINS,
  };

  process.env.NODE_ENV = "production";
  process.env.APP_BASE_URL = "https://erwinmehehe-payrollph.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "erwinmehehe-payrollph.vercel.app";
  delete process.env.TRUSTED_APP_ORIGINS;

  try {
    const request = new Request("http://127.0.0.1/api/auth/demo-switch", {
      method: "POST",
      headers: {
        origin: "https://payrollph-three.vercel.app",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "payrollph-three.vercel.app",
        "x-forwarded-proto": "https",
      },
    });

    assert.equal(enforceSameOriginMutation(request), null);
  } finally {
    restoreEnv("NODE_ENV", previous.NODE_ENV);
    restoreEnv("APP_BASE_URL", previous.APP_BASE_URL);
    restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", previous.VERCEL_PROJECT_PRODUCTION_URL);
    restoreEnv("TRUSTED_APP_ORIGINS", previous.TRUSTED_APP_ORIGINS);
  }
});

test("same-origin hint cannot authorize an Origin that does not match the request target", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    TRUSTED_APP_ORIGINS: process.env.TRUSTED_APP_ORIGINS,
  };

  process.env.NODE_ENV = "production";
  process.env.APP_BASE_URL = "https://erwinmehehe-payrollph.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "erwinmehehe-payrollph.vercel.app";
  delete process.env.TRUSTED_APP_ORIGINS;

  try {
    const request = new Request("http://127.0.0.1/api/auth/demo-switch", {
      method: "POST",
      headers: {
        origin: "https://evil.example.com",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "payrollph-three.vercel.app",
        "x-forwarded-proto": "https",
      },
    });

    const response = enforceSameOriginMutation(request);
    assert.ok(response);
    assert.equal(response.status, 403);
  } finally {
    restoreEnv("NODE_ENV", previous.NODE_ENV);
    restoreEnv("APP_BASE_URL", previous.APP_BASE_URL);
    restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", previous.VERCEL_PROJECT_PRODUCTION_URL);
    restoreEnv("TRUSTED_APP_ORIGINS", previous.TRUSTED_APP_ORIGINS);
  }
});

test("cross-site mutations remain blocked even when forwarded host is a production alias", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const request = new Request("http://127.0.0.1/api/auth/demo-switch", {
      method: "POST",
      headers: {
        origin: "https://payrollph-three.vercel.app",
        "sec-fetch-site": "cross-site",
        "x-forwarded-host": "payrollph-three.vercel.app",
        "x-forwarded-proto": "https",
      },
    });

    const response = enforceSameOriginMutation(request);
    assert.ok(response);
    assert.equal(response.status, 403);
  } finally {
    restoreEnv("NODE_ENV", previous);
  }
});
