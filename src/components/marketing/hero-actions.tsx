"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, Play, UserPlus } from "lucide-react";
import { Spinner } from "@/components/workspace/ui";

/**
 * The three real entry points.
 *
 * "Try live demo" calls the seeded demo-session endpoint and lands the visitor
 * in the actual workspace, it is not a video or a mockup. If the deployment is
 * not in demo mode the call fails and we send them to the sign-in page instead
 * of pretending.
 */
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
        setError("The demo workspace is not available on this deployment. Sign in or book a demo instead.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the demo endpoint. Sign in or book a demo instead.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <>
      <div className="hero-cta">
        {demoEnabled ? (
          <button className="primary-button" onClick={launchDemo} disabled={launching}>
            {launching ? <Spinner label="Opening the workspace" /> : <Play size={16} />}
            {launching ? "Opening the workspace…" : "Try live demo"}
          </button>
        ) : (
          <a className="primary-button" href="/signup">
            <UserPlus size={16} /> Create account
          </a>
        )}
        <a className="secondary-button" href="/signup">
          <UserPlus size={16} /> Create account
        </a>
        <a className="secondary-button" href="/book-demo">
          <CalendarDays size={16} /> Book a demo
        </a>
        <a className="link-button" href="#preview" style={{ marginLeft: 4 }}>
          or play with the preview below <ArrowRight size={12} style={{ display: "inline", verticalAlign: "middle" }} />
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
