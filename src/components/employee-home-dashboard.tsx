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
import { taskFirstUiEnabled } from "@/lib/task-first-ui";

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
  onRequestLeave,
}: {
  data: HomeData;
  onPayslip: (id: number) => void;
  onPay: () => void;
  onAttendance: () => void;
  onLeave: () => void;
  onRequestLeave: () => void;
}) {
  const latest = data.payslips[0];
  const taskFirst = taskFirstUiEnabled();
  const pending = data.leave.requests.filter(
    (request) => request.status === "Pending",
  ).length;
  return (
    <div className="clean-dashboard clean-employee-home employee-home">
      <div className="clean-heading">
        <div>
          <h1>Good morning, {data.employee.firstName}.</h1>
          <p>Your pay, leave and attendance at a glance.</p>
        </div>
        <button type="button" className="clean-button secondary employee-leave-shortcut" onClick={onLeave}>
          <Leaf size={16} aria-hidden="true" /> My leave
        </button>
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
          <button type="button" className="clean-link" onClick={onLeave}>
            View leave details <ArrowRight size={16} aria-hidden="true" />
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
        </section>
      </div>
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
              ? `Payslip available · Net pay · ${taskFirst ? "Pay date" : "Paid"} ${dashboardDate(latest.payDate)}`
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
      <div className="clean-employee-actions">
        <button type="button" className="clean-button secondary" onClick={onRequestLeave}>
          <Leaf size={17} /> Request leave
        </button>
        <button type="button" className="clean-button secondary" onClick={onAttendance}>
          <CalendarDays size={17} /> View attendance
        </button>
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
                <small>{taskFirst ? "Pay date" : "Paid"} {dashboardDate(slip.payDate)}</small>
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
