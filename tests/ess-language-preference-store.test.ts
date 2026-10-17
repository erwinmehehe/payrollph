import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ESS_LANGUAGE_STORAGE_KEY } from "../src/lib/ess-language";
import {
  getEssLanguageServerSnapshot,
  getEssLanguageSnapshot,
  persistEssLanguage,
  subscribeEssLanguage,
} from "../src/lib/ess-language-preference-store";

test("ESS language preference uses a hydration-safe English server snapshot", () => {
  assert.equal(getEssLanguageServerSnapshot(), "en");
  const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");
  assert.match(portal, /useSyncExternalStore\(subscribeEssLanguage, getEssLanguageSnapshot, getEssLanguageServerSnapshot\)/);
  assert.match(portal, /sessionLanguage \?\? storedLanguage/);
  assert.doesNotMatch(portal, /setLanguage\(parseEssLanguage\(window\.localStorage/);
  assert.doesNotMatch(portal, /localStorage\.setItem\(ESS_LANGUAGE_STORAGE_KEY, next\)/);
});

test("ESS language reads saved Taglish, broadcasts own changes, observes cross-tab changes and unsubscribes", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const saved = new Map<string, string>([[ESS_LANGUAGE_STORAGE_KEY, "fil"]]);
  const handlers = new Map<string, Set<(event: { type: string; key?: string | null }) => void>>();
  let blocked = false;

  const fakeWindow = {
    localStorage: {
      getItem(key: string) {
        if (blocked) throw new Error("storage unavailable");
        return saved.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (blocked) throw new Error("storage unavailable");
        saved.set(key, value);
      },
    },
    addEventListener(type: string, handler: (event: { type: string; key?: string | null }) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)?.add(handler);
    },
    removeEventListener(type: string, handler: (event: { type: string; key?: string | null }) => void) {
      handlers.get(type)?.delete(handler);
    },
    dispatchEvent(event: { type: string; key?: string | null }) {
      for (const handler of handlers.get(event.type) ?? []) handler(event);
      return true;
    },
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    assert.equal(getEssLanguageSnapshot(), "fil");
    let updates = 0;
    const unsubscribe = subscribeEssLanguage(() => { updates++; });
    assert.equal(persistEssLanguage("en"), true);
    assert.equal(saved.get(ESS_LANGUAGE_STORAGE_KEY), "en");
    assert.equal(getEssLanguageSnapshot(), "en");
    assert.equal(updates, 1, "same-tab notification");

    fakeWindow.dispatchEvent({ type: "storage", key: "unrelated" });
    assert.equal(updates, 1);
    saved.set(ESS_LANGUAGE_STORAGE_KEY, "fil");
    fakeWindow.dispatchEvent({ type: "storage", key: ESS_LANGUAGE_STORAGE_KEY });
    assert.equal(updates, 2, "cross-tab preference update");
    assert.equal(getEssLanguageSnapshot(), "fil");
    fakeWindow.dispatchEvent({ type: "storage", key: null });
    assert.equal(updates, 3, "clear-storage event");

    blocked = true;
    assert.equal(getEssLanguageSnapshot(), "en", "storage denial is not a crash");
    assert.equal(persistEssLanguage("fil"), false, "caller retains a session-only fallback");
    assert.equal(updates, 3);

    unsubscribe();
    blocked = false;
    assert.equal(persistEssLanguage("fil"), true);
    assert.equal(updates, 3, "unmounted listeners do not fire");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
