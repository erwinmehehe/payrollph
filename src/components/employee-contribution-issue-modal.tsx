"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { essText, type EssLanguage } from "@/lib/ess-language";

const ISSUE_OPTIONS = [
  ["missing_posting", "Contribution is missing from my agency record"],
  ["wrong_posted_amount", "Amount posted by the agency looks wrong"],
  ["unexpected_deduction", "Payslip deduction looks wrong or unexpected"],
  ["missing_payslip_evidence", "Payslip / deduction evidence is missing"],
  ["other", "Something else is wrong"],
] as const;

export function EmployeeContributionIssueModal({
  memberId,
  language = "en",
  initialAgency,
  initialMonth,
  onClose,
  onSubmitted,
}: {
  memberId: number | null;
  language?: EssLanguage;
  initialAgency?: string;
  initialMonth?: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const t = (text: string) => essText(language, text);
  const [agency, setAgency] = useState(initialAgency ?? "");
  const [applicableMonth, setApplicableMonth] = useState(initialMonth ?? "");
  const [issueType, setIssueType] = useState("missing_posting");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!agency || !applicableMonth || description.trim().length < 20) {
      setError(t("Choose the agency/month and describe the problem in at least 20 characters."));
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/self/contribution-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          agency,
          applicableMonth,
          issueType,
          description,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? t("The contribution issue could not be submitted."));
        return;
      }
      onSubmitted();
      onClose();
    } catch {
      setError(t("The contribution issue could not be submitted because the server could not be reached."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal employee-leave-modal" role="dialog" aria-modal="true" aria-label={t("Report contribution issue")}>
        <div className="card-kicker">{t("MANDATORY CONTRIBUTIONS")}</div>
        <h2>{t("Report a contribution problem")}</h2>
        <p>
          {t("This creates a payroll compliance case. It does not change your payslip or agency record.")}
        </p>

        <form onSubmit={submit} className="employee-leave-form">
          <div className="employee-form-two">
            <label>
              {t("Agency")}
              <select value={agency} onChange={(event) => setAgency(event.target.value)} disabled={Boolean(initialAgency)}>
                <option value="">{t("Select agency")}</option>
                <option value="SSS">SSS</option>
                <option value="PhilHealth">PhilHealth</option>
                <option value="Pag-IBIG">Pag-IBIG</option>
              </select>
            </label>
            <label>
              {t("Applicable month")}
              <input
                type="month"
                value={applicableMonth}
                onChange={(event) => setApplicableMonth(event.target.value)}
                disabled={Boolean(initialMonth)}
                required
              />
            </label>
          </div>

          <label>
            {t("What looks wrong?")}
            <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
              {ISSUE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{t(label)}</option>
              ))}
            </select>
          </label>

          <label>
            {t("What did you notice?")}
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder={t("Example: My September payslip deducted SSS, but the contribution does not appear in my SSS record.")}
              required
            />
            <small>{description.trim().length}/20 {t("minimum characters")}</small>
          </label>

          <div className="notice notice-amber">
            <AlertTriangle size={15} />
            <span>
              {t("Do not include passwords, OTPs or login credentials. Payroll can review contribution evidence without access to your agency account.")}
            </span>
          </div>

          {error && <div className="notice notice-red"><span>{error}</span></div>}

          <div className="employee-modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>{t("Cancel")}</button>
            <button className="primary-button brand" disabled={busy || !agency || !applicableMonth || description.trim().length < 20}>
              {busy ? t("Submitting…") : t("Submit compliance case")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
