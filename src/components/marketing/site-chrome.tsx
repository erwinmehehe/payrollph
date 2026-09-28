"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "/#workflow", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/payroll-outsourcing", label: "Payroll outsourcing" },
  { href: "/scorecard", label: "Scorecard" },
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
          <Link className="site-brand" href="/">
            <BrandMark />
            <span>
              <strong>linaw</strong>
              <small>HR &amp; Payroll</small>
            </span>
          </Link>

          <nav className="site-links" aria-label="Sections">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="site-nav-cta">
            <Link className="secondary-button" href="/login">
              Sign in
            </Link>
            <Link className="primary-button" href="/signup">
              Start free
            </Link>
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
          <Link key={link.href} href={link.href} onClick={() => setDrawer(false)}>
            {link.label}
          </Link>
        ))}
        <div className="drawer-cta">
          <Link className="secondary-button" href="/login">
            Sign in
          </Link>
          <Link className="primary-button" href="/signup" onClick={() => setDrawer(false)}>
            Start free
          </Link>
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
            <Link className="site-brand" href="/" style={{ color: "#fff" }}>
              <BrandMark />
              <span>
                <strong style={{ color: "#fff" }}>linaw</strong>
                <small style={{ color: "var(--console-faint)" }}>HR &amp; Payroll</small>
              </span>
            </Link>
            <p className="footer-disclosure">
              Philippine payroll software and HRIS with a public capability scorecard that separates verified, partial and
              absent features from marketing claims.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <ul>
              <li><Link href="/#workflow">How it works</Link></li>
              <li><Link href="/#features">Features</Link></li>
              <li><Link href="/#pricing">Pricing</Link></li>
              <li><Link href="/payroll-outsourcing">Payroll outsourcing</Link></li>
            </ul>
          </div>

          <div>
            <h4>Proof</h4>
            <ul>
              <li><Link href="/scorecard">Capability scorecard</Link></li>
              <li><Link href="/status">System status</Link></li>
              <li><Link href="/api/readiness">Launch readiness gates</Link></li>
              <li><Link href="/api/capabilities">Capabilities API</Link></li>
            </ul>
          </div>

          <div>
            <h4>Get started</h4>
            <ul>
              <li><Link href="/signup">Start free</Link></li>
              <li><Link href="/book-demo">Book a demo</Link></li>
              <li><Link href="/login">Sign in</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-note">
          <span>Linaw, Philippine HR and payroll workspace.</span>
          <span>
            Statutory computations follow RA 11199 (SSS), RA 11223 (PhilHealth), RA 9679 (Pag-IBIG) and RA 10963 (TRAIN).
            Government worksheet output is labelled DRAFT.
          </span>
        </div>
      </div>
    </footer>
  );
}
