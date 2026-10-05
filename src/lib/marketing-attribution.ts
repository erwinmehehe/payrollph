export type MarketingAttribution = {
  landingPath: string;
  conversionPath: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
};

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function pathOnly(value: unknown) {
  const raw = text(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://payroll.ph");
    return url.pathname.slice(0, 300);
  } catch {
    return raw.startsWith("/") ? raw.split(/[?#]/, 1)[0].slice(0, 300) : "";
  }
}

function referrerWithoutQuery(value: unknown) {
  const raw = text(value, 700);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return "";
  }
}

export function sanitizeMarketingAttribution(value: unknown): MarketingAttribution {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    landingPath: pathOnly(input.landingPath),
    conversionPath: pathOnly(input.conversionPath),
    referrer: referrerWithoutQuery(input.referrer),
    utmSource: text(input.utmSource, 120),
    utmMedium: text(input.utmMedium, 120),
    utmCampaign: text(input.utmCampaign, 160),
    utmContent: text(input.utmContent, 160),
    utmTerm: text(input.utmTerm, 160),
  };
}
