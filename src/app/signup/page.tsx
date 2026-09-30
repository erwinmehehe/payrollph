import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { needsSetup } from "@/app/api/setup/route";
import { SetupWizard } from "@/components/setup-wizard";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create your Linaw workspace",
  description: "First-run setup creates your organization and its owner account with a policy-checked password.",
};

/**
 * The real account-creation path.
 *
 * An empty deployment goes through first-run setup, which is the only way an
 * owner account is created. Once an owner exists, setup refuses to run (409) so
 * the wizard cannot be used to hijack a live workspace, in that case this page
 * says so plainly and offers the routes that do work, rather than showing a
 * sign-up form that would fail.
 */
export default async function SignupPage() {
  const empty = await needsSetup();

  if (empty) return <SetupWizard needsSetup />;

  return (
    <div className="site">
      <SiteNav />

      <section className="section" style={{ borderBottom: 0 }}>
        <div className="site-shell">
          <div className="split">
            <div>
              <p className="eyebrow">Create account</p>
              <h1 style={{ margin: "8px 0 0", fontSize: "clamp(28px, 3.6vw, 40px)", lineHeight: 1.12, letterSpacing: "-0.04em", fontWeight: 750 }}>
                This workspace already has an owner.
              </h1>
              <p className="section-copy">
                Linaw creates exactly one owner account, through first-run setup. After that, accounts are created by
                invitation from inside the workspace, an invited user gets a single-use, time-limited token by email and
                sets their own password. That is deliberate: a public sign-up form on a payroll instance is a way for
                strangers to end up inside somebody&apos;s payroll.
              </p>

              <div className="notice notice-blue">
                <ShieldCheck size={15} className="i-green" />
                <span>
                  Setup returns <span className="mono">409</span> once any user exists, so this is enforced by the API and
                  not just by this page.
                </span>
              </div>

              <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
                <Link className="export-card" href="/#simulation" style={{ textDecoration: "none" }}>
                  <span className="inline-icon green" aria-hidden>
                    <Check size={16} />
                  </span>
                  <div>
                    <h3>
                      Try the workspace preview <ArrowUpRight size={13} style={{ display: "inline", verticalAlign: "middle" }} />
                    </h3>
                    <p>Playable, no account needed. Real statutory arithmetic on sample people.</p>
                  </div>
                </Link>

                <a className="export-card" href="/book-demo" style={{ textDecoration: "none" }}>
                  <span className="inline-icon blue" aria-hidden>
                    <Mail size={16} />
                  </span>
                  <div>
                    <h3>
                      Book a demo <ArrowUpRight size={13} style={{ display: "inline", verticalAlign: "middle" }} />
                    </h3>
                    <p>Tell us your headcount and entity structure and we will walk through your setup.</p>
                  </div>
                </a>

                <a className="export-card" href="/login" style={{ textDecoration: "none" }}>
                  <span className="inline-icon slate" aria-hidden>
                    <LockKeyhole size={16} />
                  </span>
                  <div>
                    <h3>
                      Sign in <ArrowUpRight size={13} style={{ display: "inline", verticalAlign: "middle" }} />
                    </h3>
                    <p>Already have an account, or received an invitation? Sign in here.</p>
                  </div>
                </a>
              </div>
            </div>

            <article className="card" style={{ padding: 26 }}>
              <p className="eyebrow" style={{ margin: 0 }}>
                How accounts actually get created
              </p>
              <h2 style={{ margin: "6px 0 16px", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
                Three steps, all server-enforced
              </h2>

              <div className="worksheet-list">
                <div>
                  <span className="contribution-mark" aria-hidden>
                    1
                  </span>
                  <span>
                    First-run setup
                    <small>
                      An empty instance creates the organization and its owner. The password policy (12+ characters, upper,
                      lower, digit) is checked on the server with per-rule messages.
                    </small>
                  </span>
                </div>
                <div>
                  <span className="contribution-mark" aria-hidden>
                    2
                  </span>
                  <span>
                    Invitation
                    <small>
                      The owner invites colleagues with a role. The token is stored as a SHA-256 hash and sent by email,
                      never returned in an HTTP response, and it cannot be reused.
                    </small>
                  </span>
                </div>
                <div>
                  <span className="contribution-mark" aria-hidden>
                    3
                  </span>
                  <span>
                    Employee linking
                    <small>
                      Staff accounts are linked to exactly one employee record and land on the self-service portal.
                      Linking an admin is refused, because it used to demote them and lock them out.
                    </small>
                  </span>
                </div>
              </div>

              <div className="notice notice-amber" style={{ marginBottom: 0 }}>
                <Mail size={15} className="i-pink" />
                <span>
                  If this deployment has no mail provider configured, invitation and reset messages stay queued in the
                  outbox instead of being sent. The workspace shows them there honestly rather than reporting them as
                  delivered.
                </span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
