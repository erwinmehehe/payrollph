"use client";

import { AlertTriangle, BriefcaseBusiness, FileBarChart2, UsersRound, UserPlus, UserX, WalletCards } from "lucide-react";
import type { PeopleIntelligenceSummary } from "@/lib/hcm-people-intelligence";
import { Metric, money, shortMoney } from "./ui";

const count = (value: number | null) => value == null ? "Unverified" : value.toLocaleString("en-PH");
const days = (value: number | null) => value == null ? "—" : `${value.toFixed(1)} days`;

export function PeopleIntelligenceOverview({ report }: { report: PeopleIntelligenceSummary }) {
  return (
    <>
      <section className="stats-grid" aria-label="People Intelligence summary">
        <Metric
          label="Verified headcount"
          value={count(report.headcount)}
          hint={`As of ${report.asOf} · ${report.coverage.percent.toFixed(1)}% status coverage`}
          icon={<UsersRound size={16} className="i-blue" />}
          tone="blue"
        />
        <Metric
          label="Hires in window"
          value={count(report.hires)}
          hint={`${report.windowDays} days · effective employment starts`}
          icon={<UserPlus size={16} className="i-green" />}
          tone="mint"
        />
        <Metric
          label="Released exits"
          value={count(report.completedExits)}
          hint={`Completed final-pay separations · turnover ${report.turnoverRate == null ? "not verifiable" : report.turnoverRate.toFixed(1) + "%"}`}
          icon={<UserX size={16} className="i-red" />}
          tone="amber"
        />
        <Metric
          label="Approved vacancies"
          value={count(report.vacantPositions)}
          hint={report.historical ? "No reliable historical position-state snapshot" : "Unoccupied approved/open positions"}
          icon={<BriefcaseBusiness size={16} className="i-teal" />}
          tone="blue"
        />
      </section>

      <section className="stats-grid" aria-label="Staffing and payroll evidence">
        <Metric
          label="Primary assigned FTE"
          value={report.assignedFte == null ? "Unverified" : report.assignedFte.toFixed(2)}
          hint="Effective-dated position assignments"
          icon={<UsersRound size={16} className="i-blue" />}
          tone="slate"
        />
        <Metric
          label="Open requisitions"
          value={count(report.activeRequisitions)}
          hint={`Median time to hire: ${days(report.medianHireDays)}`}
          icon={<BriefcaseBusiness size={16} className="i-green" />}
          tone="blue"
        />
        <Metric
          label="Released payroll gross"
          value={report.releasedPayrollGross == null ? "Unverified" : shortMoney(report.releasedPayrollGross)}
          hint={`${report.releasedRunCount} released run(s) · PHP · ${report.windowDays} days`}
          icon={<WalletCards size={16} className="i-teal" />}
          tone="mint"
        />
        <Metric
          label="Vacancy budget"
          value={report.recordedAnnualVacancyBudget == null ? "Unverified" : shortMoney(report.recordedAnnualVacancyBudget)}
          hint="Recorded annual approved-position budget · not payroll spend"
          icon={<FileBarChart2 size={16} className="i-blue" />}
          tone="slate"
        />
      </section>

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Effective-dated workforce</div>
            <h2>Six reporting points · headcount verification</h2>
            <p>Historic headcount is shown only when worker employment events support a complete snapshot. Missing evidence is not estimated.</p>
          </div>
          <span className="badge badge-subtle">{report.asOf}</span>
        </div>
        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead><tr><th>Reporting date</th><th className="right">Headcount</th><th className="right">Verified workers</th></tr></thead>
            <tbody>
              {report.trends.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td className="right num">{point.headcount == null ? "Incomplete" : point.headcount.toLocaleString("en-PH")}</td>
                  <td className="right num">{point.verified} / {point.eligible}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Decision integrity</div>
            <h2>Coverage and source limitations</h2>
            <p>{`${report.coverage.verified} of ${report.coverage.eligible} eligible workers have verifiable status as of ${report.asOf}.`}</p>
          </div>
        </div>
        {report.warnings.length ? (
          <div style={{ display: "grid", gap: 10, padding: "0 18px 18px" }}>
            {report.warnings.map((warning) => (
              <div key={warning} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <AlertTriangle size={16} className="i-amber" aria-hidden />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ padding: "0 18px 18px" }}>No source-coverage exceptions detected in this snapshot. Figures still require normal HR and Finance reconciliation.</p>
        )}
        <p style={{ padding: "0 18px 18px", fontSize: 12, opacity: 0.8 }}>
          Released gross payroll: {report.releasedPayrollGross == null ? "Unverified" : money(report.releasedPayrollGross)} PHP · released net: {report.releasedPayrollNet == null ? "Unverified" : money(report.releasedPayrollNet)} PHP.
          Approved salary-cycle movement is an annual proposal delta, not an additional payroll expense.
          Historical reporting is reconstructed from effective dates; it is not a reconstruction of what users knew on an earlier publication date.
        </p>
      </article>

      {report.units && report.units.length > 0 && (
        <article className="card table-card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">Current organization structure</div>
              <h2>Headcount by org unit</h2>
              <p>The entire breakdown is withheld if any unit has fewer than five employees, preventing subtraction of a small group from the company total.</p>
            </div>
          </div>
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead><tr><th>Organization unit</th><th className="right">People</th></tr></thead>
              <tbody>
                {report.units.map((row) => (
                  <tr key={row.orgUnit}>
                    <td>{row.orgUnit}</td>
                    <td className="right num">{row.headcount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </>
  );
}
