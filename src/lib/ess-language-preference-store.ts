import { ESS_LANGUAGE_STORAGE_KEY, parseEssLanguage, type EssLanguage } from "./ess-language";

// A browser preference, not an employee record. Read through a hydration-safe
// external store rather than synchronously setting React state in an effect.
const CHANGE_EVENT = "linaw:ess-language-change";

export function getEssLanguageSnapshot(): EssLanguage {
  try {
    return parseEssLanguage(window.localStorage.getItem(ESS_LANGUAGE_STORAGE_KEY));
  } catch {
    // Browsers can reject localStorage (private mode, disabled storage).
    return "en";
  }
}

export function getEssLanguageServerSnapshot(): EssLanguage {
  // SSR and hydration start with identical content; the browser preference
  // becomes visible only after React is ready to consume the client snapshot.
  return "en";
}

export function subscribeEssLanguage(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ESS_LANGUAGE_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function persistEssLanguage(next: EssLanguage): boolean {
  try {
    window.localStorage.setItem(ESS_LANGUAGE_STORAGE_KEY, next);
    // The native storage event only reaches other documents, so notify this
    // tab's external-store subscribers explicitly.
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}
