"use client";

import { useEffect } from "react";
import { captureFirstTouchAttribution } from "@/lib/marketing-attribution-client";

export function MarketingAttributionCapture() {
  useEffect(() => {
    captureFirstTouchAttribution();
  }, []);

  return null;
}
