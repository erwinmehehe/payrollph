"use client";

import { useState } from "react";
import { ArrowRight, Play, UserPlus } from "lucide-react";
import { Spinner } from "@/components/workspace/ui";

export function HeroActions({ demoEnabled }: { demoEnabled: boolean }) {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  async function launchDemo() {
    setLaunching(true);
    setError("");
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "bookkeeper" }),
      });
      if (!response.ok) {
        setError("The demo workspace is not available on this deployment. You can still use the interactive preview below.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the demo endpoint. You can still use the interactive preview below.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <>
      <div className="hero-cta">
        {demoEnabled ? (
          <button className="primary-button" onClick={launchDemo} disabled={launching}>
            {launching ? <Spinner label="Opening the workspace" /> : <Play size={16} className="i-blue" />}
            {launching ? "Opening the workspace…" : "Try live demo"}
          </button>
        ) : (
          <a className="primary-button" href="#preview">
            <Play size={16} className="i-blue" /> Try live demo
          </a>
        )}
        <a className="secondary-button" href="/signup">
          <UserPlus size={16} className="i-purple" /> Start free
        </a>
        <a className="link-button" href="#pricing" style={{ marginLeft: 4 }}>
          See pricing <ArrowRight size={12} style={{ display: "inline", verticalAlign: "middle" }} />
        </a>
      </div>
      {error && (
        <div className="notice notice-amber" style={{ maxWidth: 560 }}>
          <span>{error}</span>
        </div>
      )}
    </>
  );
}
