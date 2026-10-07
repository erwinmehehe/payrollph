"use client";

import {
  ArrowRight,
  CalendarDays,
  Clock,
  Download,
  FileText,
  Leaf,
  WalletCards,
} from "lucide-react";
import { dashboardDate, dashboardMoney } from "@/lib/dashboard-presentation";

type HomeData = {
  employee: { firstName: string };
  nextPay: { payDate: string; period: string; label: string } | null;
  payslips: Array<{
    entryId: number;
    period: string;
    net: string;
    payDate: string;
  }>;
  attendance: {
    completeCount: number;
    recent: Array<{ workDate: string }>;
    today: { timeIn: string | null; timeOut: string | null } | null;
  };
  leave: {
    balances: Array<{ leaveType: string; available: number }>;
    requests: Array<{ status: string }>;
  };
};

export function EmployeeHomeDashboard({
  data,
  onPayslip,
  onPay,
  onAttendance,
  onLeave,
}: {
  data: HomeData;
  onPayslip: (id: number) => void;
  onPay: () => void;
  onAttendance: () => void;
  onLeave: () => void;
}) {
  const latest = data.payslips[0];
  const pending = data.leave.requests.filter(
    (request) => request.status === "Pending",
  ).length;
  return (
    <div className="clean-dashboard clean-employee-home employee-home">
      <div className="clean-heading">
        <div>
          <h1>Good morning, {data.employee.firstName}.</h1>
          <p>Here’s your payday at a glance.</p>
        </div>
      </div>
      <section className="clean-card clean-employee-next">
        <span className="clean-icon blue">
          <CalendarDays size={24} />
        </span>
        <div>
          <span>Next payday</span>
          <h2>
            {data.nextPay
              ? dashboardDate(data.nextPay.payDate)
              : "Not scheduled yet"}
          </h2>
          <p>
            {data.nextPay
              ? `${data.nextPay.period} · ${data.nextPay.label}`
              : "Your next cycle appears when you’re included in a payroll run."}
          </p>
          <small>
            Your payslip will be available after payroll is released.
          </small>
        </div>
      </section>
      <section
        className="clean-card clean-employee-payslip employee-latest-pay"
        data-latest-payslip={latest ? "" : undefined}
      >
        <div>
          <span className="clean-eyebrow">Latest payslip</span>
          <p>{latest?.period ?? "No released payslip yet"}</p>
          <strong>{latest ? dashboardMoney(latest.net) : "—"}</strong>
          <small>
            {latest
              ? `Net pay · Paid ${dashboardDate(latest.payDate)}`
              : "Your released pay will appear here."}
          </small>
        </div>
        {latest && (
          <div className="clean-payslip-actions">
            <button
              type="button"
              className="clean-link"
              onClick={() => onPayslip(latest.entryId)}
            >
              View payslip <ArrowRight size={17} />
            </button>
            <a
              className="clean-link"
              href={`/api/self/payslips/${latest.entryId}`}
            >
              <Download size={15} /> PDF
            </a>
          </div>
        )}
      </section>
      <div className="clean-employee-grid">
        <section className="clean-card">
          <div className="clean-card-header">
            <h2>Leave balance</h2>
            <span className="clean-icon green">
              <Leaf size={21} />
            </span>
          </div>
          {data.leave.balances.length ? (
            data.leave.balances.map((balance) => (
              <div className="clean-leave-balance" key={balance.leaveType}>
                <strong>
                  {balance.available.toLocaleString("en-PH", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  days
                </strong>
                <span>{balance.leaveType}</span>
              </div>
            ))
          ) : (
            <p className="clean-muted">No leave policy assigned yet.</p>
          )}
          <p className="clean-muted">
            {pending
              ? `${pending} requests awaiting approval`
              : "No pending leave requests"}
          </p>
          <button
            type="button"
            className="clean-button secondary"
            onClick={onLeave}
          >
            Request leave <ArrowRight size={15} />
          </button>
        </section>
        <section className="clean-card">
          <div className="clean-card-header">
            <h2>Attendance</h2>
            <span className="clean-icon blue">
              <Clock size={21} />
            </span>
          </div>
          <div className="clean-leave-balance">
            <strong>{data.attendance.completeCount} complete</strong>
            <span>Of {data.attendance.recent.length} recent time records</span>
          </div>
          <p className="clean-muted">
            {data.attendance.today?.timeIn
              ? data.attendance.today.timeOut
                ? "Today’s shift is complete"
                : "You’re clocked in"
              : "Not clocked in today"}
          </p>
          <button
            type="button"
            className="clean-button secondary"
            onClick={onAttendance}
          >
            View attendance <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <section className="clean-card">
        <div className="clean-card-header">
          <h2>Recent payslips</h2>
          <button type="button" className="clean-link" onClick={onPay}>
            View all <ArrowRight size={15} />
          </button>
        </div>
        {data.payslips.length ? (
          data.payslips.slice(0, 3).map((slip) => (
            <button
              key={slip.entryId}
              type="button"
              className="clean-action-row"
              onClick={() => onPayslip(slip.entryId)}
            >
              <span className="clean-icon blue">
                <FileText size={19} />
              </span>
              <span>
                <strong>{slip.period}</strong>
                <small>Paid {dashboardDate(slip.payDate)}</small>
              </span>
              <strong>{dashboardMoney(slip.net)}</strong>
              <ArrowRight size={16} />
            </button>
          ))
        ) : (
          <p className="clean-muted">
            <WalletCards size={18} /> No released payslips yet.
          </p>
        )}
      </section>
    </div>
  );
}
