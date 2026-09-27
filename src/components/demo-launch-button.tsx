"use client";

import { useState } from "react";
import { Play } from "lucide-react";

export function DemoLaunchButton({ className = "primary-button", label = "Try Live Demo" }: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);

  async function launch() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "bookkeeper" }),
      });
      if (response.ok) {
        window.location.href = "/";
        return;
      }
      window.location.href = "/login";
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={launch} disabled={busy}>
      <Play size={15} /> {busy ? "Opening demo…" : label}
    </button>
  );
}
