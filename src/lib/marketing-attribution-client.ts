"use client";

import type { MarketingAttribution } from "@/lib/marketing-attribution";

const STORAGE_KEY = "linaw:first-touch:v1";

type FirstTouch = Omit<MarketingAttribution, "conversionPath">;

function cleanReferrer(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return "";
  }
}

export function captureFirstTouchAttribution() {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return;

    const params = new URLSearchParams(window.location.search);
    const firstTouch: FirstTouch = {
      landingPath: window.location.pathname.slice(0, 300),
      referrer: cleanReferrer(document.referrer),
      utmSource: (params.get("utm_source") ?? "").slice(0, 120),
      utmMedium: (params.get("utm_medium") ?? "").slice(0, 120),
      utmCampaign: (params.get("utm_campaign") ?? "").slice(0, 160),
      utmContent: (params.get("utm_content") ?? "").slice(0, 160),
      utmTerm: (params.get("utm_term") ?? "").slice(0, 160),
    };

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(firstTouch));
  } catch {
    // Attribution must never block navigation or form submission.
  }
}

export function readMarketingAttribution(): MarketingAttribution {
  const empty: MarketingAttribution = {
    landingPath: "",
    conversionPath: "",
    referrer: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    utmTerm: "",
  };

  if (typeof window === "undefined") return empty;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) as Partial<FirstTouch> : {};
    return {
      landingPath: String(stored.landingPath ?? "").slice(0, 300),
      conversionPath: window.location.pathname.slice(0, 300),
      referrer: cleanReferrer(String(stored.referrer ?? "")),
      utmSource: String(stored.utmSource ?? "").slice(0, 120),
      utmMedium: String(stored.utmMedium ?? "").slice(0, 120),
      utmCampaign: String(stored.utmCampaign ?? "").slice(0, 160),
      utmContent: String(stored.utmContent ?? "").slice(0, 160),
      utmTerm: String(stored.utmTerm ?? "").slice(0, 160),
    };
  } catch {
    return { ...empty, conversionPath: window.location.pathname.slice(0, 300) };
  }
}
