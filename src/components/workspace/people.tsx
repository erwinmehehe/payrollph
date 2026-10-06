"use client";

import { useEffect, useMemo, useState } from "react";
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
import { REST_DAY_NAMES } from "@/lib/payroll-rules";
import { Avatar, EmptyState, PageHeading, Status, formatDate, formatTimeOnly, money } from "./ui";

type SortKey = "name" | "basicRate" | "status";

type ConnectedWorkerProfile = {
  position: null | {
    id: number;
    code: string;
    status: string;
    employmentType: string;
    effectiveFrom: string;
    profile: null | { id: number; title: string; family: string; level: string; grade: string | null };
    orgUnit: null | { id: number; name: string; code: string; type: string };
    manager: null | { id: number; employeeNo: string; firstName: string; lastName: string; title: string };
  };
  benefits: Array<{
    id: number;
    status: string;
    endedOn: string | null;
    planName: string;
    category: string;
    provider: string | null;
  }>;
  assets: Array<{
    id: number;
    type: string;
    name: string;
    serialNumber: string | null;
    status: string;
    returnedOn: string | null;
  }>;
  lifecycle: {
    tasks: Array<{ id: number; kind: string; title: string; owner: string; done: boolean }>;
    automations: Array<{ id: number; trigger: string; status: string; ruleName: string; createdAt: string }>;
    separation: null | {
      id: number;
      separationType: string;
      noticeDate: string;
      lastDay: string;
      clearanceStatus: string;
      status: string;
      coeIssued: boolean;
    };
  };
  identities: Array<{
    user: {
      id: number;
      email: string;
      name: string;
      active: boolean;
      localPasswordEnabled: boolean;
    };
    membership: null | { id: number; role: string; orgUnitId: number | null; active: boolean };
    permissionSet: null | { id: number; name: string };
    scim: null | { id: number; externalId: string; active: boolean; lastSyncedAt: string };
    externalIdentities: Array<{ id: number; email: string; lastLoginAt: string | null }>;
  }>;
  summary: {
    authoritativePosition: boolean;
    linkedLogin: boolean;
    scimManaged: boolean;
    activeBenefits: number;
    assignedAssets: number;
    openLifecycleTasks: number;
    separationOpen: boolean;
  };
};

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
  const hrMode = data.access?.role === "hr";

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
      if (sort.key === "basicRate") return (Number(a.payRate ?? a.basicRate) - Number(b.payRate ?? b.basicRate)) * direction;
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
        eyebrow={hrMode ? `${data.selectedOrganization.legalName} · HR Admin` : "People"}
        title={hrMode ? "People." : "Your people, in context."}
        copy={
          hrMode
            ? "Manage employee records, pay profiles, employment status and organizational structure without duplicating the payroll-readiness dashboard."
            : "Department and branch structure stay optional for small teams and are ready when a client grows into them."
        }
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
              <ArrowUpDown size={13} /> Pay rate
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
                    Pay rate
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
                      {money(employee.payRate ?? employee.basicRate)}
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {employee.payBasis === "daily" ? "daily" : employee.payBasis === "hourly" ? "hourly" : "monthly"}
                      </small>
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
  const [editingEmployment, setEditingEmployment] = useState(false);
  const [savingEmployment, setSavingEmployment] = useState(false);
  const [startDate, setStartDate] = useState(employee.startDate ?? "");
  const [employmentError, setEmploymentError] = useState("");
  const [editingPay, setEditingPay] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [payBasis, setPayBasis] = useState(employee.payBasis ?? "monthly");
  const [payRate, setPayRate] = useState(employee.payRate ?? employee.basicRate);
  const [standardWorkDaysPerMonth, setStandardWorkDaysPerMonth] = useState(employee.standardWorkDaysPerMonth ?? "22");
  const [standardHoursPerDay, setStandardHoursPerDay] = useState(employee.standardHoursPerDay ?? "8");
  const [payEffectiveDate, setPayEffectiveDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  });
  const [payChangeReason, setPayChangeReason] = useState("Salary adjustment");
  const [payError, setPayError] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [restDay, setRestDay] = useState(employee.restDay ?? "");
  const [restDayEffectiveDate, setRestDayEffectiveDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  });
  const [restDayChangeReason, setRestDayChangeReason] = useState("Work schedule change");
  const [scheduleError, setScheduleError] = useState("");
  const [editingGovernment, setEditingGovernment] = useState(false);
  const [savingGovernment, setSavingGovernment] = useState(false);
  const [middleName, setMiddleName] = useState(employee.middleName ?? "");
  const [tin, setTin] = useState(employee.tin ?? "");
  const [tinBranchCode, setTinBranchCode] = useState(employee.tinBranchCode ?? "");
  const [sssNo, setSssNo] = useState(employee.sssNo ?? "");
  const [philHealthNo, setPhilHealthNo] = useState(employee.philHealthNo ?? "");
  const [pagIbigNo, setPagIbigNo] = useState(employee.pagIbigNo ?? "");
  const [nationality, setNationality] = useState(employee.nationality ?? "Filipino");
  const [governmentError, setGovernmentError] = useState("");
  const [editingPayout, setEditingPayout] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [replacementBankAccount, setReplacementBankAccount] = useState("");
  const [bankCode, setBankCode] = useState(employee.bankCode ?? "");
  const [mobile, setMobile] = useState(employee.mobile ?? "");
  const [payoutError, setPayoutError] = useState("");
  const [connectedProfile, setConnectedProfile] = useState<ConnectedWorkerProfile | null>(null);
  const [connectedLoading, setConnectedLoading] = useState(false);
  const [connectedError, setConnectedError] = useState("");

  useEffect(() => {
    if (!canManage) {
      setConnectedProfile(null);
      setConnectedError("");
      return;
    }

    let cancelled = false;
    async function loadConnectedProfile() {
      setConnectedLoading(true);
      setConnectedError("");
      try {
        const response = await fetch(
          `/api/hcm/worker-profile?organizationId=${data.selectedOrganization.id}&employeeId=${employee.id}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Could not load the connected worker profile.");
        if (!cancelled) setConnectedProfile(payload as ConnectedWorkerProfile);
      } catch (error) {
        if (!cancelled) {
          setConnectedProfile(null);
          setConnectedError(error instanceof Error ? error.message : "Could not load the connected worker profile.");
        }
      } finally {
        if (!cancelled) setConnectedLoading(false);
      }
    }
    void loadConnectedProfile();
    return () => { cancelled = true; };
  }, [canManage, data.selectedOrganization.id, employee.id]);

  async function saveEmploymentDate() {
    setSavingEmployment(true);
    setEmploymentError("");
    try {
      const response = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          employeeId: employee.id,
          startDate,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEmploymentError(payload.error ?? "Could not save the employment start date.");
        return;
      }
      await onRefresh();
      onClose();
    } finally {
      setSavingEmployment(false);
    }
  }

  async function savePayProfile() {
    setSavingPay(true);
    setPayError("");
    try {
      const response = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          employeeId: employee.id,
          payBasis,
          rateAmount: Number(payRate),
          standardWorkDaysPerMonth: Number(standardWorkDaysPerMonth),
          standardHoursPerDay: Number(standardHoursPerDay),
          payEffectiveDate,
          payChangeReason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPayError(payload.error ?? "Could not save the pay profile.");
        return;
      }
      await onRefresh();
      onClose();
    } finally {
      setSavingPay(false);
    }
  }

  async function saveWorkSchedule() {
    setSavingSchedule(true);
    setScheduleError("");
    try {
      const response = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          employeeId: employee.id,
          restDay,
          restDayEffectiveDate,
          restDayChangeReason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setScheduleError(payload.error ?? "Could not save the work schedule.");
        return;
      }
      await onRefresh();
      onClose();
    } finally {
      setSavingSchedule(false);
    }
  }

  async function savePayoutDetails() {
    setSavingPayout(true);
    setPayoutError("");
    try {
      const response = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          employeeId: employee.id,
          ...(replacementBankAccount.trim() ? { bankAccount: replacementBankAccount.trim() } : {}),
          bankCode,
          mobile,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPayoutError(payload.error ?? "Could not save payout details.");
        return;
      }
      setReplacementBankAccount("");
      await onRefresh();
      onClose();
    } finally {
      setSavingPayout(false);
    }
  }

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
          tinBranchCode,
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
  const payRevisions = (data.payRevisions ?? []).filter((revision) => revision.employeeId === employee.id).slice(0, 5);
  const restDayRevisions = (data.restDayRevisions ?? []).filter((revision) => revision.employeeId === employee.id).slice(0, 5);
  const retroAdjustments = (data.retroAdjustments ?? []).filter((retro) => retro.employeeId === employee.id);
  const pendingRetro = retroAdjustments.filter((retro) => retro.status === "pending");
  const pendingRetroTotal = pendingRetro.reduce((sum, retro) => sum + Number(retro.amount), 0);
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
            <span>{employee.payBasis === "daily" ? "Daily rate" : employee.payBasis === "hourly" ? "Hourly rate" : "Monthly rate"}</span>
            <strong>{money(employee.payRate ?? employee.basicRate)}</strong>
            <small>{employee.payBasis === "daily" ? "daily paid" : employee.payBasis === "hourly" ? "hourly paid" : "monthly salaried"} · {employee.mwe ? "MWE" : `region ${employee.region ?? "NCR"}`}</small>
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
              <div className="card-kicker">EMPLOYMENT DATES</div>
              <h2 style={{ fontSize: 14 }}>Payroll eligibility timeline</h2>
              <p>The start date controls payroll proration and prevents pay or schedule changes from being applied before employment begins.</p>
            </div>
            {canManage && (
              <button className="secondary-button" onClick={() => setEditingEmployment((value) => !value)}>
                {editingEmployment ? "Cancel" : "Edit start date"}
              </button>
            )}
          </div>
          {editingEmployment ? (
            <>
              <div className="setting-form">
                <label>Employment start date
                  <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
              </div>
              <div className="modal-note" style={{ margin: "0 16px 10px" }}>
                A correction cannot move the start date after released payroll history or before an existing effective-dated pay/schedule chain. Those protections are enforced on the server.
              </div>
              {employmentError && <div className="notice notice-amber" style={{ margin: "0 16px 10px" }}><span>{employmentError}</span></div>}
              <div className="run-actions">
                <button
                  className="primary-button"
                  disabled={savingEmployment || !startDate || startDate === (employee.startDate ?? "")}
                  onClick={() => void saveEmploymentDate()}
                >
                  <Check size={14} /> {savingEmployment ? "Saving…" : "Save start date"}
                </button>
              </div>
            </>
          ) : (
            <div className="card-body">
              <div className="run-stats" style={{ margin: 0 }}>
                <div>
                  <span>Start date</span>
                  <strong style={{ fontSize: 13 }}>{employee.startDate ? formatDate(employee.startDate) : "Missing"}</strong>
                  <small>used for mid-cutoff hire proration</small>
                </div>
                <div>
                  <span>Employment status</span>
                  <strong style={{ fontSize: 13 }}>{employee.status}</strong>
                  <small>{employee.status === "Separating" ? "open Separation to confirm notice and last day" : "current people record"}</small>
                </div>
              </div>
            </div>
          )}
        </section>

        {canManage && (
          <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
            <div className="card-header">
              <div>
                <div className="card-kicker">CONNECTED WORKER PROFILE</div>
                <h2 style={{ fontSize: 14 }}>People, position, access and lifecycle in one record</h2>
                <p>One worker record connects authoritative position data to benefits, equipment, identity access and joiner/mover/leaver workflow evidence.</p>
              </div>
              <ShieldCheck size={17} className="i-purple" />
            </div>

            {connectedLoading && <div className="empty-state">Loading connected HCM context…</div>}
            {connectedError && <div className="notice notice-amber" style={{ margin: "0 16px 14px" }}><span>{connectedError}</span></div>}

            {connectedProfile && (
              <div className="card-body">
                <div className="run-stats" style={{ margin: 0 }}>
                  <div>
                    <span>Authoritative position</span>
                    <strong style={{ fontSize: 13 }}>
                      {connectedProfile.position
                        ? `${connectedProfile.position.code} · ${connectedProfile.position.profile?.title ?? employee.title}`
                        : "Not assigned"}
                    </strong>
                    <small>
                      {connectedProfile.position
                        ? `${connectedProfile.position.profile?.family ?? "Job family not set"} · ${connectedProfile.position.profile?.level ?? "Level not set"} · effective ${formatDate(connectedProfile.position.effectiveFrom)}`
                        : "Create or fill an approved position to make headcount authoritative"}
                    </small>
                  </div>
                  <div>
                    <span>Manager &amp; org</span>
                    <strong style={{ fontSize: 13 }}>
                      {connectedProfile.position?.manager
                        ? `${connectedProfile.position.manager.firstName} ${connectedProfile.position.manager.lastName}`
                        : "No manager"}
                    </strong>
                    <small>{connectedProfile.position?.orgUnit?.name ?? "No organization unit"}</small>
                  </div>
                  <div>
                    <span>System access</span>
                    <strong style={{ fontSize: 13 }}>
                      {connectedProfile.summary.linkedLogin
                        ? connectedProfile.summary.scimManaged ? "SCIM managed" : "Linked login"
                        : "No linked login"}
                    </strong>
                    <small>
                      {connectedProfile.identities[0]?.membership
                        ? `${connectedProfile.identities[0].membership.role} · ${connectedProfile.identities[0].permissionSet?.name ?? "default role permissions"}`
                        : "No active workspace membership is linked"}
                    </small>
                  </div>
                  <div>
                    <span>Lifecycle readiness</span>
                    <strong style={{ fontSize: 13 }}>{connectedProfile.summary.openLifecycleTasks} open task{connectedProfile.summary.openLifecycleTasks === 1 ? "" : "s"}</strong>
                    <small>{connectedProfile.lifecycle.automations.length} recent automation execution{connectedProfile.lifecycle.automations.length === 1 ? "" : "s"}</small>
                  </div>
                </div>

                <div className="module-grid two" style={{ marginTop: 14 }}>
                  <div className="notice notice-slate" style={{ margin: 0 }}>
                    <BriefcaseBusiness size={15} className="i-purple" />
                    <span>
                      <strong>{connectedProfile.summary.activeBenefits} active benefit enrollment{connectedProfile.summary.activeBenefits === 1 ? "" : "s"}.</strong>{" "}
                      {connectedProfile.benefits.filter((item) => item.status === "active" && !item.endedOn).slice(0, 3).map((item) => item.planName).join(", ") || "No active plans recorded."}
                    </span>
                  </div>
                  <div className="notice notice-slate" style={{ margin: 0 }}>
                    <Building2 size={15} className="i-purple" />
                    <span>
                      <strong>{connectedProfile.summary.assignedAssets} assigned asset{connectedProfile.summary.assignedAssets === 1 ? "" : "s"}.</strong>{" "}
                      {connectedProfile.assets.filter((item) => item.status === "assigned" && !item.returnedOn).slice(0, 3).map((item) => item.name).join(", ") || "No equipment currently assigned."}
                    </span>
                  </div>
                </div>

                {connectedProfile.identities.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="card-kicker" style={{ marginBottom: 6 }}>ACCESS &amp; IDENTITY</div>
                    {connectedProfile.identities.map((identity) => (
                      <div className="payslip-line" key={identity.user.id} style={{ gridTemplateColumns: "1fr auto" }}>
                        <span>
                          {identity.user.email}
                          <em>
                            {identity.user.active ? "account active" : "account inactive"} · {identity.scim?.active ? "SCIM provisioned" : identity.externalIdentities.length ? "SSO linked" : identity.user.localPasswordEnabled ? "local sign-in" : "no local password"} · {identity.permissionSet?.name ?? "role permissions"}
                          </em>
                        </span>
                        <b>{identity.membership?.active ? identity.membership.role : "inactive"}</b>
                      </div>
                    ))}
                  </div>
                )}

                {connectedProfile.lifecycle.tasks.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="card-kicker" style={{ marginBottom: 6 }}>LIFECYCLE TASKS</div>
                    {connectedProfile.lifecycle.tasks.slice(0, 5).map((task) => (
                      <div className="payslip-line" key={task.id} style={{ gridTemplateColumns: "1fr auto" }}>
                        <span>
                          {task.title}
                          <em>{task.kind} · owner {task.owner}</em>
                        </span>
                        <b>{task.done ? "Complete" : "Open"}</b>
                      </div>
                    ))}
                  </div>
                )}

                {connectedProfile.lifecycle.separation && (
                  <div className="notice notice-amber" style={{ marginTop: 14 }}>
                    <ShieldCheck size={15} />
                    <span>
                      <strong>Separation in progress.</strong> {connectedProfile.lifecycle.separation.separationType} · last day {formatDate(connectedProfile.lifecycle.separation.lastDay)} · clearance {connectedProfile.lifecycle.separation.clearanceStatus}.
                    </span>
                  </div>
                )}

                <div className="modal-note" style={{ marginTop: 14 }}>
                  This profile is an HCM control surface, not a second source of truth. Position, benefits, identity, assets and lifecycle states remain owned by their governed modules and are only assembled here.
                </div>
              </div>
            )}
          </section>
        )}

        <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">PAYROLL PROFILE</div>
              <h2 style={{ fontSize: 14 }}>Explicit pay basis</h2>
              <p>Payroll uses an effective-dated pay history. Mid-cutoff changes preserve the old rate before the effective date and use the new rate after it.</p>
            </div>
            {canManage && (
              <button className="secondary-button" onClick={() => setEditingPay((value) => !value)}>
                {editingPay ? "Cancel" : "Edit pay"}
              </button>
            )}
          </div>
          {editingPay ? (
            <>
              <div className="setting-form">
                <label>Pay basis
                  <select value={payBasis} onChange={(event) => setPayBasis(event.target.value)}>
                    <option value="monthly">Monthly salaried</option>
                    <option value="daily">Daily paid</option>
                    <option value="hourly">Hourly paid</option>
                  </select>
                </label>
                <label>{payBasis === "daily" ? "Daily rate" : payBasis === "hourly" ? "Hourly rate" : "Monthly rate"}
                  <input type="number" min="0.01" step="0.01" value={payRate} onChange={(event) => setPayRate(event.target.value)} />
                </label>
                <label>Standard work days / month
                  <input type="number" min="1" max="31" step="0.5" value={standardWorkDaysPerMonth} onChange={(event) => setStandardWorkDaysPerMonth(event.target.value)} />
                </label>
                <label>Standard hours / day
                  <input type="number" min="1" max="24" step="0.25" value={standardHoursPerDay} onChange={(event) => setStandardHoursPerDay(event.target.value)} />
                </label>
                <label>Effective date
                  <input type="date" required value={payEffectiveDate} onChange={(event) => setPayEffectiveDate(event.target.value)} />
                </label>
                <label>Reason
                  <input value={payChangeReason} onChange={(event) => setPayChangeReason(event.target.value)} placeholder="Promotion, annual increase, correction…" />
                </label>
              </div>
              <div className="modal-note" style={{ margin: "0 16px 10px" }}>
                Effective-dated changes are applied inside an open cutoff. If a monthly salary change reaches a cutoff that was already released, Linaw creates a one-time retro-pay line for the next payroll instead of rewriting the released register.
              </div>
              {payError && <div className="notice notice-amber" style={{ margin: "0 16px 10px" }}><span>{payError}</span></div>}
              <div className="run-actions">
                <button className="primary-button" disabled={savingPay} onClick={() => void savePayProfile()}>
                  <Check size={14} /> {savingPay ? "Saving…" : "Save pay profile"}
                </button>
              </div>
            </>
          ) : (
            <div className="card-body">
              <div className="run-stats" style={{ margin: 0 }}>
                <div>
                  <span>Basis</span>
                  <strong style={{ fontSize: 13 }}>{employee.payBasis === "daily" ? "Daily paid" : employee.payBasis === "hourly" ? "Hourly paid" : "Monthly salaried"}</strong>
                  <small>explicit payroll behavior</small>
                </div>
                <div>
                  <span>Configured rate</span>
                  <strong style={{ fontSize: 13 }}>{money(employee.payRate ?? employee.basicRate)}</strong>
                  <small>per {employee.payBasis === "daily" ? "day" : employee.payBasis === "hourly" ? "hour" : "month"}</small>
                </div>
                <div>
                  <span>Work pattern</span>
                  <strong style={{ fontSize: 13 }}>{employee.standardWorkDaysPerMonth ?? "22"} d · {employee.standardHoursPerDay ?? "8"} h</strong>
                  <small>monthly days · daily hours</small>
                </div>
                <div>
                  <span>Monthly equivalent</span>
                  <strong style={{ fontSize: 13 }}>{money(employee.basicRate)}</strong>
                  <small>used by existing monthly statutory engines</small>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">PAY HISTORY</div>
              <h2 style={{ fontSize: 14 }}>Effective changes &amp; retro</h2>
              <p>Released payroll is never rewritten. Backdated monthly corrections are carried forward as explicit retro-pay lines.</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong style={{ display: "block", fontSize: 14 }}>{money(pendingRetroTotal)}</strong>
              <small style={{ color: "var(--muted)" }}>{pendingRetro.length} pending retro item{pendingRetro.length === 1 ? "" : "s"}</small>
            </div>
          </div>
          <div className="card-body">
            {payRevisions.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 11.5, margin: 0 }}>No effective-dated pay changes yet.</p>
            ) : (
              payRevisions.map((revision) => (
                <div className="payslip-line" key={revision.id} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>
                    {revision.reason}
                    <em>
                      effective {formatDate(revision.effectiveDate)} · {revision.previousPayBasis} {money(revision.previousRateAmount)} → {revision.newPayBasis} {money(revision.newRateAmount)}
                    </em>
                  </span>
                  <b>{revision.createdBy}</b>
                </div>
              ))
            )}
            {pendingRetro.length > 0 && (
              <div className="notice notice-amber" style={{ marginTop: 12 }}>
                <span>
                  Pending retro will be included in the next payroll calculation and marked settled only when that payroll is released.
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">WORK SCHEDULE</div>
              <h2 style={{ fontSize: 14 }}>Weekly rest day</h2>
              <p>Payroll uses this day when pricing rest-day work, overtime, and holiday/rest-day stacking. Released payroll is never rewritten.</p>
            </div>
            {canManage && (
              <button className="secondary-button" onClick={() => setEditingSchedule((value) => !value)}>
                {editingSchedule ? "Cancel" : "Edit schedule"}
              </button>
            )}
          </div>
          {editingSchedule ? (
            <>
              <div className="setting-form">
                <label>Rest day
                  <select value={restDay} onChange={(event) => setRestDay(event.target.value)}>
                    <option value="">Not set</option>
                    {REST_DAY_NAMES.map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </label>
                <label>Effective date
                  <input type="date" value={restDayEffectiveDate} onChange={(event) => setRestDayEffectiveDate(event.target.value)} />
                </label>
                <label>Reason
                  <input value={restDayChangeReason} onChange={(event) => setRestDayChangeReason(event.target.value)} placeholder="e.g. Team schedule change" />
                </label>
              </div>
              <div className="modal-note" style={{ margin: "0 16px 10px" }}>
                The effective date preserves the previous weekly rest day for older work dates, so recalculating historical payroll uses the schedule that was actually in force. Released payroll stays immutable.
              </div>
              {scheduleError && <div className="notice notice-amber" style={{ margin: "0 16px 10px" }}><span>{scheduleError}</span></div>}
              <div className="run-actions">
                <button
                  className="primary-button"
                  disabled={savingSchedule || restDay === (employee.restDay ?? "") || !restDayEffectiveDate || !restDayChangeReason.trim()}
                  onClick={() => void saveWorkSchedule()}
                >
                  <Check size={14} /> {savingSchedule ? "Saving…" : "Save work schedule"}
                </button>
              </div>
            </>
          ) : (
            <div className="card-body">
              <div className="run-stats" style={{ margin: 0 }}>
                <div>
                  <span>Rest day</span>
                  <strong style={{ fontSize: 13 }}>{employee.restDay || "Not set"}</strong>
                  <small>{employee.restDay ? "used for rest-day premium calculations" : "rest-day premium cannot be inferred"}</small>
                </div>
              </div>
              {restDayRevisions.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="card-kicker" style={{ marginBottom: 6 }}>SCHEDULE HISTORY</div>
                  {restDayRevisions.map((revision) => (
                    <div className="payslip-line" key={revision.id} style={{ gridTemplateColumns: "1fr auto" }}>
                      <span>
                        {revision.previousRestDay || "Not set"} → {revision.newRestDay || "Not set"}
                        <em>effective {formatDate(revision.effectiveDate)} · {revision.reason}</em>
                      </span>
                      <b>{revision.createdBy}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card" style={{ margin: "0 0 16px", boxShadow: "none" }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">PAYOUT DETAILS</div>
              <h2 style={{ fontSize: 14 }}>Payroll destination</h2>
              <p>Release is blocked until every positive-net employee has a complete payout destination.</p>
            </div>
            {canManage && (
              <button className="secondary-button" onClick={() => setEditingPayout((value) => !value)}>
                {editingPayout ? "Cancel" : "Edit payout"}
              </button>
            )}
          </div>
          {editingPayout ? (
            <>
              <div className="setting-form">
                <label>Bank / payout code
                  <input value={bankCode} onChange={(event) => setBankCode(event.target.value.toUpperCase())} placeholder="BDO / BPI / UB / ..." />
                </label>
                <label>New account number
                  <input
                    value={replacementBankAccount}
                    onChange={(event) => setReplacementBankAccount(event.target.value)}
                    placeholder={employee.bankAccount ? `Replace ${employee.bankAccount}` : "Enter account number"}
                    autoComplete="off"
                  />
                </label>
                <label>Mobile payout number
                  <input value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="optional" />
                </label>
              </div>
              <div className="modal-note" style={{ margin: "0 16px 10px" }}>
                Leave account number blank to keep the saved destination. New account numbers are encrypted server-side; only a masked value returns to the browser and final payout exports decrypt on the server.
              </div>
              {payoutError && <div className="notice notice-amber" style={{ margin: "0 16px 10px" }}><span>{payoutError}</span></div>}
              <div className="run-actions">
                <button className="primary-button" disabled={savingPayout || !bankCode.trim()} onClick={() => void savePayoutDetails()}>
                  <Check size={14} /> {savingPayout ? "Saving…" : "Save payout details"}
                </button>
              </div>
            </>
          ) : (
            <div className="card-body">
              <div className="run-stats" style={{ margin: 0 }}>
                <div><span>Destination</span><strong style={{ fontSize: 12 }}>{employee.bankAccount || "Missing"}</strong><small>masked account</small></div>
                <div><span>Bank / payout code</span><strong style={{ fontSize: 12 }}>{employee.bankCode || "Missing"}</strong><small>used by final export mapping</small></div>
                <div><span>Mobile</span><strong style={{ fontSize: 12 }}>{employee.mobile || "Not set"}</strong><small>used only for supported mobile payout rails</small></div>
              </div>
            </div>
          )}
        </section>

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
                <label>BIR branch code<input value={tinBranchCode} onChange={(event) => setTinBranchCode(event.target.value)} placeholder="0000" /></label>
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
                <div><span>BIR TIN</span><strong style={{ fontSize: 12 }}>{employee.tin ? `${employee.tin}-${employee.tinBranchCode || "0000"}` : "Missing"}</strong><small>{employee.middleName ? `middle: ${employee.middleName}` : "middle name not recorded"}</small></div>
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
