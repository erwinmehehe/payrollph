"use client";

import { useMemo } from "react";
import {
  ArrowUpRight,
  Check,
  ClipboardCheck,
  CircleDollarSign,
  Clock3,
  FileBarChart2,
  Plus,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type { DashboardData, PayrollRun, Task } from "./types";
import {
  Avatar,
  Battery,
  EmptyState,
  Metric,
  PageHeading,
  Progress,
  Sparkline,
  StackedBars,
  Status,
  formatDate,
  money,
  relativeTime,
  shortMoney,
} from "./ui";

export function OverviewView({
  data,
  currentRun,
  onNewRun,
  onPage,
  onDecide,
}: {
  data: DashboardData;
  currentRun?: PayrollRun;
  onNewRun: () => void;
  onPage: (page: string) => void;
  onDecide: (id: number, status: "Approved" | "Declined") => void;
}) {
  const openTasks = data.tasks.filter((task) => task.status === "Pending");
  const activePeople = data.employees.filter((employee) => employee.status === "Active").length;
  const firstName = (data.user?.name ?? "there").split(" ")[0];

  const entryMix = useMemo(() => {
    const exception = data.payrollEntries.filter((entry) => entry.status === "Exception").length;
    return [
      { key: "ok" as const, label: "ready", value: data.payrollEntries.length - exception },
      { key: "review" as const, label: "exception", value: exception },
      {
        key: "pending" as const,
        label: "not calculated",
        value: Math.max((currentRun?.employeeCount ?? 0) - data.payrollEntries.length, 0),
      },
    ];
  }, [data.payrollEntries, currentRun]);

  // Cost history: oldest run first, straight from the run records.
  const costSeries = useMemo(() => {
    const runs = [...data.payrollRuns].reverse();
    return runs.map((run) => {
      const gross = Number(run.grossPay);
      const net = Number(run.netPay);
      return {
        label: shortPeriod(run.periodLabel),
        sublabel: `${run.periodLabel} · ${run.employeeCount} people`,
        segments: [
          { key: "net", value: net, color: "var(--brand)" },
          { key: "deductions", value: Math.max(gross - net, 0), color: "var(--active-bright)" },
        ],
      };
    });
  }, [data.payrollRuns]);

  const netSeries = useMemo(() => [...data.payrollRuns].reverse().map((run) => Number(run.netPay)), [data.payrollRuns]);

  const chunkPercent = currentRun?.totalChunks
    ? ((currentRun.processedChunks ?? 0) / Math.max(currentRun.totalChunks, 1)) * 100
    : data.payrollEntries.length
      ? 100
      : 0;

  return (
    <>
      <PageHeading
        eyebrow={data.selectedOrganization.legalName}
        title={`Good day, ${firstName}.`}
        copy={`Everything below is read from ${data.selectedOrganization.name}'s own records, no sample figures.`}
        actions={
          <>
            <button className="secondary-button" onClick={() => onPage("Analytics")}>
              <FileBarChart2 size={15} /> Analytics
            </button>
            <button className="primary-button brand" onClick={onNewRun}>
              <Plus size={16} /> New payroll
            </button>
          </>
        }
      />

      {/* Console strip, the payday state of play */}
      {currentRun ? (
        <section className="console-strip">
          <div className="console-strip-top">
            <div>
              <span className="kicker">
                <span className="pulse-dot" aria-hidden /> Live run · {currentRun.scopeLabel}
              </span>
              <h2>{currentRun.periodLabel}</h2>
              <p>
                Pay date {formatDate(currentRun.payDate)} · rule engine {currentRun.ruleVersion} ·{" "}
                {currentRun.employeeCount} employees in scope
              </p>
            </div>
            <div className="console-figures">
              <div>
                <span>Gross</span>
                <strong>{shortMoney(currentRun.grossPay)}</strong>
              </div>
              <div>
                <span>Net</span>
                <strong>{shortMoney(currentRun.netPay)}</strong>
              </div>
              <div>
                <span>Exceptions</span>
                <strong style={{ color: currentRun.exceptions ? "#ffc46b" : undefined }}>{currentRun.exceptions}</strong>
              </div>
            </div>
          </div>

          <div className="track">
            <TrackStep label="Cutoff" value="Punches captured" state={data.payrollEntries.length ? "done" : "now"} />
            <TrackStep
              label="Calculate"
              value={`${Math.round(chunkPercent)}% of queue`}
              state={chunkPercent >= 100 ? "done" : "now"}
            />
            <TrackStep
              label="Approve"
              value={openTasks.length ? `${openTasks.length} open` : "Clear"}
              state={openTasks.length ? "now" : "done"}
            />
            <TrackStep
              label="Release"
              value={currentRun.status === "Released" ? "Released" : "Pending"}
              state={currentRun.status === "Released" ? "done" : "todo"}
            />
          </div>
        </section>
      ) : (
        <section className="console-strip">
          <div className="console-strip-top">
            <div>
              <span className="kicker">No active run</span>
              <h2>Nothing is being paid right now</h2>
              <p>Create a semi-monthly run when this client&apos;s cutoff closes.</p>
            </div>
            <button className="primary-button brand" onClick={onNewRun}>
              <Plus size={15} /> New payroll
            </button>
          </div>
        </section>
      )}

      <section className="stats-grid">
        <Metric
          label="Active people"
          value={String(activePeople)}
          hint={`of ${data.employees.length} on this client`}
          icon={<UsersRound size={16} />}
          tone="mint"
        />
        <Metric
          label="Next payroll"
          value={currentRun?.periodLabel ?? "None"}
          hint={currentRun ? `pay date ${formatDate(currentRun.payDate)}` : "no run in progress"}
          icon={<WalletCards size={16} />}
          tone="blue"
          compact
        />
        <Metric
          label="Net pay this run"
          value={currentRun ? shortMoney(currentRun.netPay) : "-"}
          hint={currentRun ? `${shortMoney(currentRun.grossPay)} gross` : "no payroll data"}
          icon={<CircleDollarSign size={16} />}
          tone="purple"
          trailing={netSeries.length > 1 ? <div className="spark-box"><Sparkline values={netSeries} /></div> : undefined}
        />
        <Metric
          label="Open approvals"
          value={String(openTasks.length)}
          hint={openTasks.length ? "waiting on a decision" : "queue is clear"}
          icon={<ClipboardCheck size={16} />}
          tone={openTasks.length ? "amber" : "mint"}
        />
      </section>

      <section className="overview-grid">
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Payroll cost by run</div>
              <h2>{data.payrollRuns.length} run{data.payrollRuns.length === 1 ? "" : "s"} on record</h2>
              <p>Net pay and employee deductions, taken from each stored run, not a projection.</p>
            </div>
          </div>
          <StackedBars
            data={costSeries}
            legend={[
              { key: "net", label: "Net pay", color: "var(--brand)" },
              { key: "deductions", label: "Deductions", color: "var(--active-bright)" },
            ]}
          />
        </article>

        <article className="card attention-card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Attention queue</div>
              <h2>Your action items</h2>
              <p>Assigned to you or to a delegate in your chain</p>
            </div>
            <button className="link-button" onClick={() => onPage("Approvals")}>
              View all
            </button>
          </div>
          <div className="attention-list">
            {openTasks.length === 0 ? (
              <div className="empty-state small">
                <Check size={17} style={{ color: "var(--success)" }} />
                Your approval queue is clear.
              </div>
            ) : (
              openTasks.slice(0, 4).map((task: Task) => (
                <div className="attention-item" key={task.id}>
                  <div className={`attention-icon ${task.priority === "High" ? "urgent" : ""}`} aria-hidden>
                    <ClipboardCheck size={16} />
                  </div>
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.detail}</p>
                    <span>{task.dueLabel}</span>
                  </div>
                  <button
                    className="approve-mini"
                    onClick={() => onDecide(task.id, "Approved")}
                    aria-label={`Approve ${task.title}`}
                    title="Approve"
                  >
                    <Check size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="overview-grid lower-grid">
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Entry status</div>
              <h2>Where this run stands, employee by employee</h2>
            </div>
            {currentRun && <Status value={currentRun.status} />}
          </div>
          <div className="card-body">
            {data.payrollEntries.length === 0 ? (
              <EmptyState icon={<Clock3 size={20} />} title="No calculated entries yet">
                Once the run is calculated, each employee&apos;s entry lands here as ready or flagged.
              </EmptyState>
            ) : (
              <>
                <Battery slices={entryMix} />
                <div className="progress-label" style={{ marginTop: 18 }}>
                  <span>Queue progress</span>
                  <strong>{Math.round(chunkPercent)}%</strong>
                </div>
                <Progress percent={chunkPercent} tone={chunkPercent < 100 ? "blue" : undefined} />
              </>
            )}
          </div>
          <button className="card-action" onClick={() => onPage("Payroll")}>
            Open the payroll workspace <ArrowUpRight size={15} />
          </button>
        </article>

        <article className="card directory-card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Directory</div>
              <h2>People on this client</h2>
            </div>
            <button className="link-button" onClick={() => onPage("People")}>
              Directory <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="mini-directory">
            {data.employees.slice(0, 5).map((employee) => (
              <div className="mini-person" key={employee.id}>
                <Avatar initials={employee.avatarInitials} index={employee.id} />
                <div>
                  <strong>
                    {employee.firstName} {employee.lastName}
                  </strong>
                  <span>
                    <span className="mono">{employee.employeeNo}</span> · {employee.title}
                  </span>
                </div>
                <Status value={employee.status} />
              </div>
            ))}
            {data.employees.length === 0 && (
              <EmptyState icon={<UsersRound size={20} />} title="No people yet">
                Import a roster or add the first employee from the People page.
              </EmptyState>
            )}
          </div>
        </article>
      </section>

      <section className="overview-grid lower-grid">
        <article className="card compliance-brief">
          <div className="card-header">
            <div>
              <div className="card-kicker">Compliance watch</div>
              <h2>Statutory rulebook</h2>
            </div>
            <Status value={currentRun?.ruleVersion ?? "PH-2026.01"} />
          </div>
          <div className="compliance-row">
            <span className="check-round" aria-hidden>
              <Check size={13} />
            </span>
            <div>
              <strong>SSS, PhilHealth and Pag-IBIG tables are versioned and unit-tested</strong>
              <p>Computed server-side against RA 11199, RA 11223 and RA 9679, with TRAIN withholding brackets.</p>
            </div>
          </div>
          {data.advisories.filter((advisory) => advisory.active).length > 0 ? (
            data.advisories
              .filter((advisory) => advisory.active)
              .slice(0, 2)
              .map((advisory) => (
                <div className="compliance-row amber" key={advisory.id}>
                  <span className="alert-round" aria-hidden>
                    !
                  </span>
                  <div>
                    <strong>
                      {advisory.policy}
                      {advisory.premiumPercent ? ` (+${Number(advisory.premiumPercent)}%)` : ""} active
                    </strong>
                    <p>
                      Applied automatically to {advisory.affectedUnit} and traced to advisory{" "}
                      <span className="mono">{advisory.advisoryNumber}</span> on the payslip.
                    </p>
                  </div>
                </div>
              ))
          ) : (
            <div className="compliance-row blue">
              <span className="check-round" style={{ background: "#c3ddf9", color: "var(--active)" }} aria-hidden>
                <Check size={13} />
              </span>
              <div>
                <strong>No active calamity or hazard advisory</strong>
                <p>Premiums apply only while an advisory covers the punch dates in the period.</p>
              </div>
            </div>
          )}
          <button className="card-action" onClick={() => onPage("Compliance")}>
            Open the compliance centre <ArrowUpRight size={15} />
          </button>
        </article>

        <article className="card audit-card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Audit trail</div>
              <h2>Recent recorded actions</h2>
            </div>
            <button className="link-button" onClick={() => onPage("Audit trail")}>
              Full trail
            </button>
          </div>
          <div className="audit-list">
            {data.auditEvents.slice(0, 5).map((event) => (
              <div className="audit-row" key={event.id}>
                <span className="audit-dot" aria-hidden />
                <div>
                  <strong>{event.action}</strong>
                  <p>
                    {event.actor} · <span className="mono">{event.resource}</span>
                  </p>
                </div>
                <time>{relativeTime(event.createdAt)}</time>
              </div>
            ))}
            {data.auditEvents.length === 0 && (
              <EmptyState icon={<ShieldCheck size={20} />} title="Nothing recorded yet">
                Every payroll, export and approval writes an immutable audit event here.
              </EmptyState>
            )}
          </div>
        </article>
      </section>
    </>
  );
}

function TrackStep({ label, value, state }: { label: string; value: string; state: "done" | "now" | "todo" }) {
  return (
    <div className={`track-step ${state === "done" ? "done" : state === "now" ? "now" : ""}`}>
      <span>
        {state === "done" && <Check size={10} />}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

/** "March 1–15, 2026" → "Mar 1–15" so a dozen bars still fit on a phone. */
function shortPeriod(label: string) {
  const cleaned = label.replace(/,?\s*\d{4}$/, "");
  return cleaned.length > 11 ? `${cleaned.slice(0, 3)} ${cleaned.replace(/^\D+/, "")}` : cleaned;
}

export { money };
