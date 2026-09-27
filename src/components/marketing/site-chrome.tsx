"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "/welcome#payroll", label: "Payroll engine" },
  { href: "/welcome#workspace", label: "Workspace" },
  { href: "/welcome#proof", label: "Proof" },
  { href: "/welcome#pricing", label: "Pricing" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/status", label: "Status" },
];

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <span className="brand-bars">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

export function SiteNav() {
  const [stuck, setStuck] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header className={`site-nav ${stuck ? "stuck" : ""}`}>
        <div className="site-nav-inner">
          <a className="site-brand" href="/welcome">
            <BrandMark />
            <span>
              <strong>linaw</strong>
              <small>HR &amp; Payroll</small>
            </span>
          </a>

          <nav className="site-links" aria-label="Sections">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="site-nav-cta">
            <a className="secondary-button" href="/login">
              Sign in
            </a>
            <a className="primary-button" href="/welcome#preview">
              Try live demo
            </a>
            <button
              className="icon-button site-burger"
              onClick={() => setDrawer((current) => !current)}
              aria-expanded={drawer}
              aria-label={drawer ? "Close menu" : "Open menu"}
            >
              {drawer ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      <div className={`site-drawer ${drawer ? "open" : ""}`}>
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setDrawer(false)}>
            {link.label}
          </a>
        ))}
        <div className="drawer-cta">
          <a className="secondary-button" href="/login">
            Sign in
          </a>
          <a className="primary-button" href="/welcome#preview" onClick={() => setDrawer(false)}>
            Try live demo
          </a>
        </div>
      </div>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-shell">
        <div className="footer-grid">
          <div>
            <a className="site-brand" href="/welcome" style={{ color: "#fff" }}>
              <BrandMark />
              <span>
                <strong style={{ color: "#fff" }}>linaw</strong>
                <small style={{ color: "var(--console-faint)" }}>HR &amp; Payroll</small>
              </span>
            </a>
            <p className="footer-disclosure">
              Philippine payroll and HRIS for one person or ten thousand. Built so that what the product claims and what
              the code does are the same thing, the capability scorecard classifies every feature as verified, partial or
              absent, with its evidence.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <ul>
              <li>
                <a href="/welcome#payroll">Payroll engine</a>
              </li>
              <li>
                <a href="/welcome#workspace">Multi-client workspace</a>
              </li>
              <li>
                <a href="/welcome#preview">Workspace preview</a>
              </li>
              <li>
                <a href="/welcome#pricing">Pricing</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Proof</h4>
            <ul>
              <li>
                <a href="/scorecard">Capability scorecard</a>
              </li>
              <li>
                <a href="/status">System status</a>
              </li>
              <li>
                <a href="/api/readiness">Launch readiness gates</a>
              </li>
              <li>
                <a href="/api/capabilities">Capabilities API</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Get started</h4>
            <ul>
              <li>
                <a href="/signup">Create account</a>
              </li>
              <li>
                <a href="/book-demo">Book a demo</a>
              </li>
              <li>
                <a href="/login">Sign in</a>
              </li>
              <li>
                <a href="/api/v1">API reference</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-note">
          <span>Linaw, Philippine HR &amp; payroll workspace.</span>
          <span>
            Statutory computations follow RA 11199 (SSS), RA 11223 (PhilHealth), RA 9679 (Pag-IBIG) and RA 10963 (TRAIN).
            Government worksheet output is labelled DRAFT.
          </span>
        </div>
      </div>
    </footer>
  );
}
