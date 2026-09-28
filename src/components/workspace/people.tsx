"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { ImportPanel } from "@/components/import-panel";
import type { DashboardData, Employee } from "./types";
import { Avatar, EmptyState, PageHeading, Status, formatDate, formatTimeOnly, money } from "./ui";

type SortKey = "name" | "basicRate" | "status";
const PAGE_SIZE = 12;

const TABS = [
  { key: "all", label: "All people" },
  { key: "Active", label: "Active" },
  { key: "On leave", label: "On leave" },
  { key: "Separating", label: "Separation" },
] as const;

export function PeopleView({
  data,
  onRefresh,
  onAddEmployee,
  onPage,
  canManage = true,
  focusEmployeeId,
  onClearFocus,
}: {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  onAddEmployee: () => void;
  onPage: (page: string) => void;
  canManage?: boolean;
  focusEmployeeId?: number | null;
  onClearFocus?: () => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Employee | null>(null);

  // The drawer subject is derived: either a row the user clicked, or the person
  // the command palette handed us. No effect copies one into the other.
  const selected = picked ?? data.employees.find((employee) => employee.id === focusEmployeeId) ?? null;

  function closeDrawer() {
    setPicked(null);
    onClearFocus?.();
  }

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const employee of data.employees) map.set(employee.status, (map.get(employee.status) ?? 0) + 1);
    return map;
  }, [data.employees]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = data.employees.filter((employee) => {
      if (tab !== "all" && employee.status !== tab) return false;
      if (!needle) return true;
      return `${employee.firstName} ${employee.lastName} ${employee.employeeNo} ${employee.title} ${employee.employmentType}`
        .toLowerCase()
        .includes(needle);
    });

    const direction = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "basicRate") return (Number(a.basicRate) - Number(b.basicRate)) * direction;
      if (sort.key === "status") return a.status.localeCompare(b.status) * direction;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`) * direction;
    });
  }, [data.employees, tab, query, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const openOffboarding = (data.provisioning ?? []).filter((item) => item.kind === "offboarding" && !item.done).length;

  // Every filter change returns to page one, so the visible slice is never empty.
  function toggleSort(key: SortKey) {
    setPage(1);
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  }

  function search(value: string) {
    setPage(1);
    setQuery(value);
  }

  function selectTab(next: (typeof TABS)[number]["key"]) {
    setPage(1);
    setTab(next);
  }

  return (
    <>
      <PageHeading
        eyebrow="People"
        title="Your people, in context."
        copy="Department and branch structure stay optional for small teams and are ready when a client grows into them."
        actions={
          canManage ? (
            <button className="primary-button brand" onClick={onAddEmployee}>
              <Plus size={16} className="i-green" /> Add employee
            </button>
          ) : undefined
        }
      />

      {data.access && !data.access.companyWide && (
        <div className="notice notice-amber">
          <LockKeyhole size={15} className="i-amber" />
          <span>
            Your role is scoped to <strong>{data.access.orgUnitName}</strong>. Employees outside that unit are not loaded,
            this is enforced in the query, not hidden in the UI.
          </span>
        </div>
      )}

      {canManage && <ImportPanel organizationId={data.selectedOrganization.id} onImported={onRefresh} />}

      {openOffboarding > 0 && (
        <div className="notice notice-blue">
          <ShieldCheck size={15} className="i-green" />
          <span>
            <strong>{openOffboarding} offboarding item{openOffboarding === 1 ? "" : "s"}</strong> are open. Completing one
            is audit-logged through <span className="mono">PATCH /api/provisioning</span>.
          </span>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="People status">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            className={`tab ${tab === item.key ? "active" : ""}`}
            onClick={() => selectTab(item.key)}
          >
            {item.label}
            <b>{item.key === "all" ? data.employees.length : counts.get(item.key) ?? 0}</b>
          </button>
        ))}
      </div>

      <section className="people-layout">
        <article className="card table-card">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={15} className="i-slate" />
              <input
                value={query}
                onChange={(event) => search(event.target.value)}
                placeholder="Search name, number, role"
                aria-label="Search people"
              />
            </div>
            <button className="filter-button" onClick={() => toggleSort("basicRate")}>
              <ArrowUpDown size={13} /> Monthly basic
            </button>
            <button className="filter-button" onClick={() => toggleSort("status")}>
              <ArrowUpDown size={13} /> Status
            </button>
          </div>

          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort("name")} aria-sort={sort.key === "name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    Person
                  </th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="right sortable" onClick={() => toggleSort("basicRate")} aria-sort={sort.key === "basicRate" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    Monthly basic
                  </th>
                  <th className="right">Region</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((employee) => (
                  <tr
                    key={employee.id}
                    onClick={() => setPicked(employee)}
                    style={{ cursor: "pointer" }}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPicked(employee);
                      }
                    }}
                  >
                    <td>
                      <div className="person-cell">
                        <Avatar initials={employee.avatarInitials} index={employee.id} />
                        <div>
                          <strong>
                            {employee.firstName} {employee.lastName}
                          </strong>
                          <span>
                            <span className="id">{employee.employeeNo}</span> · {employee.title}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>{employee.employmentType}</td>
                    <td>
                      <Status value={employee.status} />
                    </td>
                    <td className="right num">
                      {money(employee.basicRate)}
                      {employee.mwe && <small className="mwe-tag">MWE</small>}
                    </td>
                    <td className="right mono" style={{ color: "var(--muted)" }}>
                      {employee.region ?? "NCR"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <EmptyState icon={<Search size={20} className="i-slate" />} title="No people match">
                {query ? `Nothing matches “${query}”.` : "This status has no employees on this client yet."}
              </EmptyState>
            )}
          </div>

          <div className="pagination">
            <span>
              Showing <span className="mono">{visible.length}</span> of <span className="mono">{filtered.length}</span>
              {filtered.length !== data.employees.length && <> (filtered from {data.employees.length})</>}
            </span>
            <div>
              <button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page">
                ‹
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1)
                .filter((number) => Math.abs(number - currentPage) < 3 || number === 1 || number === pageCount)
                .map((number) => (
                  <button
                    key={number}
                    className={number === currentPage ? "current" : ""}
                    onClick={() => setPage(number)}
                    aria-current={number === currentPage ? "page" : undefined}
                  >
                    {number}
                  </button>
                ))}
              <button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount} aria-label="Next page">
                ›
              </button>
            </div>
          </div>
        </article>

        <aside className="card org-card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Structure</div>
              <h2>Organization map</h2>
            </div>
          </div>
          <div className="org-tree">
            <div className="tree-root">
              <Building2 size={15} className="i-purple" />
              <span>{data.selectedOrganization.name}</span>
            </div>
            {(data.orgUnits ?? []).length === 0 ? (
              <p className="tree-leaf">No org units defined, this client is flat.</p>
            ) : (
              (data.orgUnits ?? []).map((unit) => {
                const headcount = data.employees.filter((employee) => employee.orgUnitId === unit.id).length;
                return (
                  <div className="tree-branch" key={unit.id}>
                    <div>
                      <span className="tree-line" aria-hidden />
                      <BriefcaseBusiness size={14} className="i-purple" />
                      <strong>{unit.name}</strong>
                      <b>{headcount}</b>
                    </div>
                    <div className="tree-leaf">{unit.type}</div>
                  </div>
                );
              })
            )}
          </div>
          <div className="notice notice-green" style={{ margin: "0 18px 14px" }}>
            <ShieldCheck size={15} className="i-green" />
            <span>
              Department-scoped access is stored on the membership row, so a scoped user&apos;s queries are narrowed on the
              server.
            </span>
          </div>
          {canManage && (
            <button className="card-action" onClick={() => onPage("Settings")}>
              Manage structure
            </button>
          )}
        </aside>
      </section>

      {selected && (
        <PersonDrawer
          data={data}
          employee={selected}
          canManage={canManage}
          onRefresh={onRefresh}
          onClose={closeDrawer}
        />
      )}
    </>
  );
}

function PersonDrawer({
  data,
  employee,
  canManage,
  onRefresh,
  onClose,
}: {
  data: DashboardData;
  employee: Employee;
  canManage: boolean;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [editingGovernment, setEditingGovernment] = useState(false);
  const [savingGovernment, setSavingGovernment] = useState(false);
  const [middleName, setMiddleName] = useState(employee.middleName ?? "");
  const [tin, setTin] = useState(employee.tin ?? "");
  const [sssNo, setSssNo] = useState(employee.sssNo ?? "");
  const [philHealthNo, setPhilHealthNo] = useState(employee.philHealthNo ?? "");
  const [pagIbigNo, setPagIbigNo] = useState(employee.pagIbigNo ?? "");
  const [nationality, setNationality] = useState(employee.nationality ?? "Filipino");
  const [governmentError, setGovernmentError] = useState("");

  async function saveGovernmentIdentity() {
    setSavingGovernment(true);
    setGovernmentError("");
    try {
      const response = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          employeeId: employee.id,
          middleName,
          tin,
          sssNo,
          philHealthNo,
          pagIbigNo,
          nationality,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGovernmentError(payload.error ?? "Could not save government IDs.");
        return;
      }
      await onRefresh();
      onClose();
    } finally {
      setSavingGovernment(false);
    }
  }

  const punches = (data.punches ?? []).filter((punch) => punch.employeeId === employee.id).slice(0, 6);
  const leave = (data.leaveRequests ?? []).filter((request) => request.employeeId === employee.id);
  const checklist = (data.provisioning ?? []).filter((item) => item.employeeId === employee.id);
  const entry = data.payrollEntries.find((item) => item.employeeId === employee.id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${employee.firstName} ${employee.lastName}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal large">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <Avatar initials={employee.avatarInitials} index={employee.id} />
          <div>
            <h2 style={{ fontSize: 18 }}>
              {employee.firstName} {employee.lastName}
            </h2>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 12 }}>
              <span className="mono">{employee.employeeNo}</span> · {employee.title} · {employee.employmentType}
            </p>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <Status value={employee.status} />
          </div>
        </div>

        <div className="run-stats" style={{ margin: "16px 0" }}>
          <div>
            <span>Monthly basic</span>
            <strong>{money(employee.basicRate)}</strong>
            <small>{employee.mwe ? "minimum-wage earner, tax exempt" : `region ${employee.region ?? "NCR"}`}</small>
          </div>
          <div>
            <span>This run gross</span>
            <strong>{entry ? money(entry.grossPay) : "-"}</strong>
            <small>{entry ? entry.status.toLowerCase() : "not in the live run"}</small>
          </div>
          <div>
            <span>This run net</span>
            <strong className="green-number">{entry ? money(entry.netPay) : "-"}</strong>
            <small>{entry ? `after ${money(entry.deductions)} deductions` : "-"}</small>
          </div>
        </div>

        <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">GOVERNMENT IDENTITY</div>
              <h2 style={{ fontSize: 14 }}>Filing identifiers</h2>
              <p>BIR, SSS, PhilHealth and Pag-IBIG exports fail closed rather than substituting the internal employee number.</p>
            </div>
            {canManage && (
              <button className="secondary-button" onClick={() => setEditingGovernment((value) => !value)}>
                {editingGovernment ? "Cancel" : "Edit IDs"}
              </button>
            )}
          </div>

          {editingGovernment ? (
            <>
              <div className="setting-form">
                <label>Middle name<input value={middleName} onChange={(event) => setMiddleName(event.target.value)} /></label>
                <label>BIR TIN<input value={tin} onChange={(event) => setTin(event.target.value)} placeholder="9-digit employee TIN" /></label>
                <label>SSS number<input value={sssNo} onChange={(event) => setSssNo(event.target.value)} /></label>
                <label>PhilHealth PIN<input value={philHealthNo} onChange={(event) => setPhilHealthNo(event.target.value)} /></label>
                <label>Pag-IBIG MID<input value={pagIbigNo} onChange={(event) => setPagIbigNo(event.target.value)} /></label>
                <label>Nationality<input value={nationality} onChange={(event) => setNationality(event.target.value)} /></label>
              </div>
              {governmentError && <div className="notice notice-amber" style={{ margin: "0 16px 10px" }}><span>{governmentError}</span></div>}
              <div className="run-actions">
                <button className="primary-button" disabled={savingGovernment} onClick={() => void saveGovernmentIdentity()}>
                  <Check size={14} /> {savingGovernment ? "Saving…" : "Save government IDs"}
                </button>
              </div>
            </>
          ) : (
            <div className="card-body">
              <div className="run-stats" style={{ margin: 0 }}>
                <div><span>BIR TIN</span><strong style={{ fontSize: 12 }}>{employee.tin || "Missing"}</strong><small>{employee.middleName ? `middle: ${employee.middleName}` : "middle name not recorded"}</small></div>
                <div><span>SSS</span><strong style={{ fontSize: 12 }}>{employee.sssNo || "Missing"}</strong><small>R-3 member number</small></div>
                <div><span>PhilHealth</span><strong style={{ fontSize: 12 }}>{employee.philHealthNo || "Missing"}</strong><small>EPRS / RF-1 PIN</small></div>
                <div><span>Pag-IBIG</span><strong style={{ fontSize: 12 }}>{employee.pagIbigNo || "Missing"}</strong><small>MID for remittance</small></div>
              </div>
            </div>
          )}
        </section>

        <div className="payslip-grid">
          <div>
            <p className="card-kicker">Recent punches</p>
            {punches.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 11.5 }}>No punches recorded for this employee.</p>
            ) : (
              punches.map((punch) => (
                <div className="payslip-line" key={punch.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <span>
                    {formatDate(punch.workDate)}
                    <em>{punch.status}</em>
                  </span>
                  <b>{formatTimeOnly(punch.timeIn)}</b>
                  <b>{formatTimeOnly(punch.timeOut)}</b>
                </div>
              ))
            )}
          </div>

          <div>
            <p className="card-kicker">Leave &amp; lifecycle</p>
            {leave.length === 0 && checklist.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 11.5 }}>No leave requests or open checklist items.</p>
            )}
            {leave.map((request) => (
              <div className="payslip-line" key={`leave-${request.id}`} style={{ gridTemplateColumns: "18px 1fr auto" }}>
                <CalendarDays size={14} style={{ color: "var(--muted-light)" }} />
                <span>
                  {request.leaveType}
                  <em>
                    {formatDate(request.startDate)} – {formatDate(request.endDate)} · {request.days} day(s)
                  </em>
                </span>
                <Status value={request.status} />
              </div>
            ))}
            {checklist.map((item) => (
              <div className="payslip-line" key={`task-${item.id}`} style={{ gridTemplateColumns: "18px 1fr auto" }}>
                {item.done ? (
                  <Check size={14} style={{ color: "var(--success)" }} />
                ) : (
                  <Clock3 size={14} style={{ color: "var(--review)" }} />
                )}
                <span>
                  {item.title}
                  <em>
                    {item.kind} · owner {item.owner}
                  </em>
                </span>
                <Status value={item.done ? "Complete" : "Open"} />
              </div>
            ))}
          </div>
        </div>

        <div className="modal-note" style={{ marginTop: 18 }}>
          <UsersRound size={14} className="i-purple" />
          <span>
            Everything shown here is scoped to this workspace by the same server-side membership gate that protects the
            API. Editing an employee record is a separate, audited action.
          </span>
        </div>
      </div>
    </div>
  );
}
