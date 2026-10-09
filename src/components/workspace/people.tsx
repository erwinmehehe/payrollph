"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  FileText,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { ImportPanel } from "@/components/import-panel";
import { HcmCapabilitiesPanel } from "@/components/hcm-capabilities-panel";
import { HcmBusinessProcessAdmin } from "@/components/hcm-business-process-admin";
import { HcmBusinessProcessInbox } from "@/components/hcm-business-process-inbox";
import { HcmEmploymentLifecycleActionCenter } from "@/components/hcm-employment-lifecycle-action-center";
import { HcmEmploymentLifecycleWorker } from "@/components/hcm-employment-lifecycle-worker";
import { HcmLifecycleNotificationInbox } from "@/components/hcm-lifecycle-notification-inbox";
import { HcmLifecyclePolicyPanel } from "@/components/hcm-lifecycle-policy-panel";
import type { DashboardData, Employee } from "./types";
import { REST_DAY_NAMES } from "@/lib/payroll-rules";
import { Avatar, EmptyState, PageHeading, Status, formatDate, formatTimeOnly, money } from "./ui";

type SortKey = "name" | "basicRate" | "status";

type PayoutDestinationChangeRequest = {
  id: number;
  employeeId: number;
  status: string;
  reason: string;
  originalSnapshot: unknown;
  proposedBankCode: string | null;
  proposedMobile: string | null;
  proposedMaskedAccount: string | null;
  requestedByUserId: number;
  requestedByName: string;
  requestedAt: string;
  decidedByUserId: number | null;
  decidedByName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
};

type ConnectedWorkerProfile = {
  position: null | {
    id: number;
    code: string;
    status: string;
    employmentType: string;
    assignmentType: string;
    fte: string;
    effectiveFrom: string;
    profile: null | { id: number; title: string; family: string; level: string; grade: string | null };
    orgUnit: null | { id: number; name: string; code: string; type: string };
    supervisoryOrg: null | { id: number; name: string; code: string; type: string };
    legalEntity: null | { id: number; code: string; displayName: string; legalName: string };
    costCenter: null | { id: number; code: string; name: string };
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
  documents: {
    policies: Array<{
      assignmentId: number;
      status: string;
      dueAt: string | null;
      acknowledgedAt: string | null;
      policyId: number;
      policyCode: string;
      title: string;
      version: string;
    }>;
    requirements: Array<{
      complianceId: number;
      status: string;
      dueAt: string | null;
      expiresAt: string | null;
      documentId: number | null;
      requirementId: number;
      code: string;
      name: string;
      kind: string;
    }>;
  };
  capabilities: {
    skills: Array<{
      id: number;
      skillId: number;
      skillName: string;
      skillCode: string;
      category: string;
      proficiency: number;
      status: string;
      effectiveFrom: string;
      effectiveUntil: string | null;
      verifiedAt: string | null;
      verifiedByName: string | null;
      notes: string | null;
    }>;
    jobSkillRequirements: Array<{
      id: number;
      skillId: number;
      skillName: string;
      skillCode: string;
      category: string;
      minimumProficiency: number;
      mandatory: boolean;
    }>;
    jobCredentialRequirements: Array<{
      id: number;
      documentRequirementId: number;
      name: string;
      code: string;
      kind: string;
      mandatory: boolean;
      blocksWorkforceEligibility: boolean;
    }>;
    workforceEligibility: null | {
      status: "eligible" | "warning" | "ineligible";
      eligible: boolean;
      blockers: string[];
      warnings: string[];
      evidence: {
        requiredSkills: number;
        satisfiedSkills: number;
        requiredCredentials: number;
        satisfiedCredentials: number;
      };
    };
  };
  worksiteGovernance: {
    arrangement: null | {
      id: number;
      mode: string;
      effectiveFrom: string;
      effectiveUntil: string | null;
      reason: string;
    };
    primaryWorksite: null | {
      id: number;
      worksiteId: number;
      effectiveFrom: string;
      effectiveUntil: string | null;
      worksite: null | {
        id: number;
        code: string;
        name: string;
        siteType: string;
        timezone: string;
        active: boolean;
      };
    };
    authorizations: Array<{
      id: number;
      worksiteId: number;
      decision: "allow" | "deny";
      effectiveFrom: string;
      effectiveUntil: string | null;
      reason: string;
      worksite: null | {
        id: number;
        code: string;
        name: string;
        siteType: string;
        timezone: string;
        active: boolean;
      };
    }>;
    currentEligibilitySummary: null | {
      eligible: boolean;
      status: "eligible" | "warning" | "ineligible";
      source: "primary" | "authorization" | "legacy" | "none";
      arrangement: string | null;
      findings: Array<{ code: string; severity: "warning" | "blocker"; message: string }>;
      blockers: string[];
      warnings: string[];
    };
  };
  history: {
    employmentEvents: Array<{
      id: number;
      effectiveDate: string;
      eventType: string;
      reason: string;
      actorName: string;
      fromStatus: string | null;
      toStatus: string | null;
      fromEmploymentType: string | null;
      toEmploymentType: string | null;
      fromPositionId: number | null;
      toPositionId: number | null;
      metadata: unknown;
    }>;
    positionAssignments: Array<{
      id: number;
      assignmentType: string;
      fte: string;
      effectiveFrom: string;
      effectiveUntil: string | null;
      reason: string;
      position: null | {
        id: number;
        code: string;
        status: string;
        employmentType: string;
        profile: null | { id: number; title: string; family: string; level: string; grade: string | null };
        orgUnit: null | { id: number; name: string; code: string; type: string };
        supervisoryOrg: null | { id: number; name: string; code: string; type: string };
        legalEntity: null | { id: number; code: string; displayName: string };
        costCenter: null | { id: number; code: string; name: string };
        manager: null | { id: number; employeeNo: string; firstName: string; lastName: string; title: string };
      };
    }>;
  };
  effectiveChanges: Array<{
    id: number;
    changeType: string;
    movementType: string;
    effectiveDate: string;
    status: string;
    targetPositionId: number | null;
    targetOrgUnitId: number | null;
    targetSupervisoryOrgUnitId: number | null;
    targetLegalEntityId: number | null;
    targetCostCenterId: number | null;
    targetManagerEmployeeId: number | null;
    targetEmploymentType: string | null;
    targetEmployeeStatus: string | null;
    targetFte: string | null;
    reason: string;
    requestedByUserId: number | null;
    requestedBy: string;
    approvedByUserId: number | null;
    approvedBy: string | null;
    approvedAt: string | null;
    appliedAt: string | null;
    cancelledBy: string | null;
    cancelledAt: string | null;
    failure: string | null;
    toSnapshot: unknown;
  }>;
  changeOptions: {
    canManage: boolean;
    positions: Array<{
      id: number;
      code: string;
      orgUnitId: number | null;
      supervisoryOrgUnitId: number | null;
      legalEntityId: number | null;
      costCenterId: number | null;
      managerEmployeeId: number | null;
      employmentType: string;
      status: string;
      profile: null | { id: number; title: string; family: string; level: string; grade: string | null };
    }>;
    orgUnits: Array<{ id: number; code: string; name: string; type: string; active: boolean }>;
    legalEntities: Array<{ id: number; code: string; displayName: string; legalName: string; active: boolean }>;
    costCenters: Array<{ id: number; code: string; name: string; active: boolean }>;
    managers: Array<{ id: number; employeeNo: string; firstName: string; lastName: string; title: string }>;
    employmentTypes: string[];
    employeeStatuses: string[];
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
    pendingPolicyAcknowledgements: number;
    documentComplianceRisks: number;
    verifiedSkills: number;
    workforceEligible: boolean | null;
    workforceEligibilityBlockers: number;
    separationOpen: boolean;
    pendingEffectiveChanges: number;
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
  const canManageLifecycle = Boolean(
    canManage
      && data.access?.companyWide
      && ["owner", "admin", "bookkeeper", "hr"].includes(data.access.role),
  );
  const canViewLifecycleNotifications = Boolean(
    data.access && ["owner", "admin", "bookkeeper", "hr", "manager"].includes(data.access.role),
  );

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
        title="Employees"
        copy="Manage employee records, employment details and pay profiles."
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
            and are outside your current access.
          </span>
        </div>
      )}

      {(canManage || canManageLifecycle || canViewLifecycleNotifications) && <details className="panel-disclosure"><summary>Employee administration <span>Import, lifecycle policies and notifications</span></summary>
      {canManage && <ImportPanel organizationId={data.selectedOrganization.id} onImported={onRefresh} />}

      {canManageLifecycle && (
        <HcmLifecyclePolicyPanel organizationId={data.selectedOrganization.id} />
      )}

      {canManageLifecycle && (
        <HcmBusinessProcessAdmin organizationId={data.selectedOrganization.id} />
      )}

      {canViewLifecycleNotifications && (
        <HcmBusinessProcessInbox
          organizationId={data.selectedOrganization.id}
          onChanged={onRefresh}
        />
      )}

      {canManageLifecycle && (
        <HcmEmploymentLifecycleActionCenter
          organizationId={data.selectedOrganization.id}
          onOpenEmployee={(employeeId) => {
            const worker = data.employees.find((employee) => employee.id === employeeId);
            if (worker) setPicked(worker);
          }}
          onOpenSeparation={() => onPage("separation")}
        />
      )}

      {canViewLifecycleNotifications && (
        <HcmLifecycleNotificationInbox
          organizationId={data.selectedOrganization.id}
          onOpenEmployee={(employeeId) => {
            const worker = data.employees.find((employee) => employee.id === employeeId);
            if (worker) setPicked(worker);
          }}
          onOpenSeparation={() => onPage("separation")}
        />
      )}
      </details>}

      {openOffboarding > 0 && (
        <div className="notice notice-blue">
          <ShieldCheck size={15} className="i-green" />
          <span>
            <strong>{openOffboarding} offboarding item{openOffboarding === 1 ? "" : "s"}</strong> are open. Completing one
            is recorded in the audit trail.
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
                  <th className="sortable" aria-sort={sort.key === "name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="table-sort" onClick={() => toggleSort("name")}>Person <ArrowUpDown size={12} /></button>
                  </th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="right sortable" aria-sort={sort.key === "basicRate" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="table-sort" onClick={() => toggleSort("basicRate")}>Pay rate <ArrowUpDown size={12} /></button>
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
            {filtered.length === 0 && (query || tab !== "all") && <div className="empty-state-action"><button type="button" className="secondary-button" onClick={() => { search(""); selectTab("all"); }}>Clear filters</button></div>}
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
              Employee visibility follows your assigned department and access permissions.
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
          onPage={onPage}
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
  onPage,
  onClose,
}: {
  data: DashboardData;
  employee: Employee;
  canManage: boolean;
  onRefresh: () => Promise<void>;
  onPage: (page: string) => void;
  onClose: () => void;
}) {
  const canManageEmploymentLifecycle = Boolean(
    canManage
      && data.access?.companyWide
      && ["owner", "admin", "bookkeeper", "hr"].includes(data.access.role),
  );
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
  const [payoutChangeReason, setPayoutChangeReason] = useState("");
  const [payoutError, setPayoutError] = useState("");
  const [payoutNotice, setPayoutNotice] = useState("");
  const [payoutChangeRequests, setPayoutChangeRequests] = useState<PayoutDestinationChangeRequest[]>([]);
  const [payoutDecisionBusy, setPayoutDecisionBusy] = useState(false);
  const [payoutDecisionNote, setPayoutDecisionNote] = useState("");
  const [connectedProfile, setConnectedProfile] = useState<ConnectedWorkerProfile | null>(null);
  const [connectedLoading, setConnectedLoading] = useState(false);
  const [connectedError, setConnectedError] = useState("");
  const [showEffectiveChange, setShowEffectiveChange] = useState(false);
  const [effectiveChangeBusy, setEffectiveChangeBusy] = useState(false);
  const [effectiveChangeError, setEffectiveChangeError] = useState("");
  const [changeEffectiveDate, setChangeEffectiveDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  });
  const [changeMovementType, setChangeMovementType] = useState("job_change");
  const [changePositionId, setChangePositionId] = useState("");
  const [changeFte, setChangeFte] = useState("1.0000");
  const [changeOrgUnitId, setChangeOrgUnitId] = useState("");
  const [changeSupervisoryOrgUnitId, setChangeSupervisoryOrgUnitId] = useState("");
  const [changeLegalEntityId, setChangeLegalEntityId] = useState("");
  const [changeCostCenterId, setChangeCostCenterId] = useState("");
  const [changeManagerEmployeeId, setChangeManagerEmployeeId] = useState("");
  const [changeEmploymentType, setChangeEmploymentType] = useState("");
  const [changeEmployeeStatus, setChangeEmployeeStatus] = useState("");
  const [changeReason, setChangeReason] = useState("");

  async function refreshPayoutChanges() {
    if (!canManage) {
      setPayoutChangeRequests([]);
      return;
    }
    try {
      const response = await fetch(
        `/api/payout-destination-changes?organizationId=${data.selectedOrganization.id}&employeeId=${employee.id}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load payout destination changes.");
      setPayoutChangeRequests(Array.isArray(payload.requests) ? payload.requests : []);
    } catch (error) {
      setPayoutError(error instanceof Error ? error.message : "Could not load payout destination changes.");
    }
  }

  useEffect(() => {
    void refreshPayoutChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.selectedOrganization.id, employee.id, canManage]);

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

  async function refreshConnectedProfile() {
    const response = await fetch(
      `/api/hcm/worker-profile?organizationId=${data.selectedOrganization.id}&employeeId=${employee.id}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not reload the connected worker profile.");
    setConnectedProfile(payload as ConnectedWorkerProfile);
    return payload as ConnectedWorkerProfile;
  }

  async function submitEffectiveChange(event: React.FormEvent) {
    event.preventDefault();
    setEffectiveChangeBusy(true);
    setEffectiveChangeError("");
    try {
      const body: Record<string, unknown> = {
        organizationId: data.selectedOrganization.id,
        employeeId: employee.id,
        effectiveDate: changeEffectiveDate,
        movementType: changeMovementType,
        reason: changeReason,
      };

      if (changePositionId) {
        body.targetPositionId = Number(changePositionId);
        body.targetFte = Number(changeFte);
      } else {
        if (changeOrgUnitId) body.targetOrgUnitId = Number(changeOrgUnitId);
        if (changeSupervisoryOrgUnitId) body.targetSupervisoryOrgUnitId = changeSupervisoryOrgUnitId === "__clear__" ? null : Number(changeSupervisoryOrgUnitId);
        if (changeLegalEntityId) body.targetLegalEntityId = Number(changeLegalEntityId);
        if (changeCostCenterId) body.targetCostCenterId = changeCostCenterId === "__clear__" ? null : Number(changeCostCenterId);
        if (changeManagerEmployeeId) body.targetManagerEmployeeId = changeManagerEmployeeId === "__clear__" ? null : Number(changeManagerEmployeeId);
        if (changeEmploymentType) body.targetEmploymentType = changeEmploymentType;
      }
      if (changeEmployeeStatus) body.targetEmployeeStatus = changeEmployeeStatus;

      const response = await fetch("/api/hcm/effective-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEffectiveChangeError(payload.error ?? "Could not request the HCM change.");
        return;
      }

      setShowEffectiveChange(false);
      setChangePositionId("");
      setChangeFte("1.0000");
      setChangeOrgUnitId("");
      setChangeSupervisoryOrgUnitId("");
      setChangeLegalEntityId("");
      setChangeCostCenterId("");
      setChangeManagerEmployeeId("");
      setChangeEmploymentType("");
      setChangeEmployeeStatus("");
      setChangeReason("");
      await refreshConnectedProfile();
    } catch (error) {
      setEffectiveChangeError(error instanceof Error ? error.message : "Could not request the HCM change.");
    } finally {
      setEffectiveChangeBusy(false);
    }
  }

  async function decideEffectiveChange(id: number, action: "approve" | "decline" | "cancel" | "retry") {
    setEffectiveChangeBusy(true);
    setEffectiveChangeError("");
    try {
      const response = await fetch("/api/hcm/effective-changes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEffectiveChangeError(payload.error ?? "Could not update the HCM change.");
        await refreshConnectedProfile().catch(() => undefined);
        return;
      }

      if (payload.applied && !payload.applied.skipped) {
        await onRefresh();
        onClose();
        return;
      }
      await refreshConnectedProfile();
    } catch (error) {
      setEffectiveChangeError(error instanceof Error ? error.message : "Could not update the HCM change.");
    } finally {
      setEffectiveChangeBusy(false);
    }
  }

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
    setPayoutNotice("");
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
          payoutChangeReason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPayoutError(payload.error ?? "Could not save payout details.");
        return;
      }
      setReplacementBankAccount("");
      setPayoutChangeReason("");
      if (payload.pendingApproval) {
        setPayoutNotice(`Payout destination change request #${payload.payoutChangeRequest?.id ?? ""} is pending treasury approval. The employee record has not changed yet.`);
        setEditingPayout(false);
        await refreshPayoutChanges();
        return;
      }
      await onRefresh();
      onClose();
    } finally {
      setSavingPayout(false);
    }
  }

  async function decidePayoutChange(requestId: number, decision: "approve" | "reject") {
    setPayoutDecisionBusy(true);
    setPayoutError("");
    setPayoutNotice("");
    try {
      const response = await fetch(`/api/payout-destination-changes/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          decision,
          decisionNote: payoutDecisionNote,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPayoutError(payload.error ?? "Could not decide payout destination change.");
        await refreshPayoutChanges();
        return;
      }
      setPayoutDecisionNote("");
      setPayoutNotice(decision === "approve"
        ? "Payout destination change approved and applied. Any earlier PayMongo preflight for an affected payroll must be rerun."
        : "Payout destination change rejected.");
      await refreshPayoutChanges();
      await onRefresh();
    } finally {
      setPayoutDecisionBusy(false);
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
                        ? `${connectedProfile.position.profile?.family ?? "Job family not set"} · ${connectedProfile.position.profile?.level ?? "Level not set"} · ${connectedProfile.position.assignmentType} · ${Number(connectedProfile.position.fte).toFixed(2)} FTE · effective ${formatDate(connectedProfile.position.effectiveFrom)}`
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
                    <small>
                      {connectedProfile.position?.orgUnit?.name ?? "No organization unit"}
                      {" · "}
                      {connectedProfile.position?.supervisoryOrg?.name ?? "No supervisory org"}
                      {" · "}
                      {connectedProfile.position?.legalEntity?.displayName ?? "Legal employer not assigned"}
                      {" · "}
                      {connectedProfile.position?.costCenter?.code ?? "No cost center"}
                    </small>
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
                  <div>
                    <span>Workforce eligibility</span>
                    <strong style={{ fontSize: 13 }}>
                      {connectedProfile.summary.workforceEligible == null
                        ? "No governed job profile"
                        : connectedProfile.summary.workforceEligible ? "Qualified" : "Blocked"}
                    </strong>
                    <small>
                      {connectedProfile.summary.verifiedSkills} verified skill{connectedProfile.summary.verifiedSkills === 1 ? "" : "s"}
                      {" · "}
                      {connectedProfile.summary.workforceEligibilityBlockers} blocking gap{connectedProfile.summary.workforceEligibilityBlockers === 1 ? "" : "s"}
                    </small>
                  </div>
                  <div>
                    <span>Work arrangement</span>
                    <strong style={{ fontSize: 13 }}>
                      {connectedProfile.worksiteGovernance.arrangement?.mode
                        ? connectedProfile.worksiteGovernance.arrangement.mode.replace("_", " ")
                        : "Not configured"}
                    </strong>
                    <small>
                      {connectedProfile.worksiteGovernance.arrangement
                        ? `Effective ${formatDate(connectedProfile.worksiteGovernance.arrangement.effectiveFrom)}${connectedProfile.worksiteGovernance.arrangement.effectiveUntil ? ` to ${formatDate(connectedProfile.worksiteGovernance.arrangement.effectiveUntil)}` : " onward"}`
                        : "Legacy worker location governance is not configured"}
                    </small>
                  </div>
                  <div>
                    <span>Worksite access</span>
                    <strong style={{ fontSize: 13 }}>
                      {connectedProfile.worksiteGovernance.primaryWorksite?.worksite?.name ?? "No effective primary worksite"}
                    </strong>
                    <small>
                      {connectedProfile.worksiteGovernance.authorizations.filter((row) => row.decision === "allow").length} allowed
                      {" · "}
                      {connectedProfile.worksiteGovernance.authorizations.filter((row) => row.decision === "deny").length} restricted
                    </small>
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div className="card-header" style={{ padding: 0, marginBottom: 8 }}>
                    <div>
                      <div className="card-kicker">EFFECTIVE-DATED EMPLOYMENT</div>
                      <h2 style={{ fontSize: 14 }}>Schedule worker changes without mutating today early</h2>
                      <p>Future changes require an independent People approver. Due changes apply through the worker scheduler and write immutable history evidence.</p>
                    </div>
                    {connectedProfile.changeOptions.canManage && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={connectedProfile.effectiveChanges.some((change) => ["pending_approval", "scheduled"].includes(change.status))}
                        onClick={() => setShowEffectiveChange((value) => !value)}
                      >
                        <CalendarDays size={14} /> {showEffectiveChange ? "Close" : "Schedule change"}
                      </button>
                    )}
                  </div>

                  {!connectedProfile.changeOptions.canManage && (
                    <div className="notice notice-slate" style={{ marginBottom: 10 }}>
                      <LockKeyhole size={15} />
                      <span>Scheduled job and organization changes require company-wide People access.</span>
                    </div>
                  )}

                  {effectiveChangeError && (
                    <div className="notice notice-amber" style={{ marginBottom: 10 }}>
                      <span>{effectiveChangeError}</span>
                    </div>
                  )}

                  {showEffectiveChange && connectedProfile.changeOptions.canManage && (
                    <form onSubmit={submitEffectiveChange} className="card" style={{ padding: 14, boxShadow: "none", marginBottom: 10 }}>
                      <div className="setting-form">
                        <label>Effective date
                          <input type="date" required value={changeEffectiveDate} onChange={(event) => setChangeEffectiveDate(event.target.value)} />
                        </label>
                        <label>Movement type
                          <select value={changeMovementType} onChange={(event) => setChangeMovementType(event.target.value)}>
                            <option value="job_change">Job change</option>
                            <option value="transfer">Transfer</option>
                            <option value="promotion">Promotion</option>
                            <option value="lateral">Lateral move</option>
                            <option value="manager_change">Manager change</option>
                            <option value="org_change">Organization change</option>
                            <option value="legal_employer_change">Legal employer change</option>
                            <option value="employment_type_change">Employment type change</option>
                            <option value="status_change">Status change</option>
                          </select>
                        </label>
                        <label>Target position
                          <select value={changePositionId} onChange={(event) => setChangePositionId(event.target.value)}>
                            <option value="">Keep current position</option>
                            {connectedProfile.changeOptions.positions.map((position) => (
                              <option key={position.id} value={position.id}>
                                {position.code} · {position.profile?.title ?? "Position"}
                              </option>
                            ))}
                          </select>
                        </label>
                        {changePositionId && (
                          <label>FTE
                            <input type="number" min="0.01" max="1" step="0.01" value={changeFte} onChange={(event) => setChangeFte(event.target.value)} />
                          </label>
                        )}
                        <label>Operating org
                          <select disabled={Boolean(changePositionId)} value={changeOrgUnitId} onChange={(event) => setChangeOrgUnitId(event.target.value)}>
                            <option value="">No change</option>
                            {connectedProfile.changeOptions.orgUnits.filter((unit) => unit.type !== "supervisory").map((unit) => (
                              <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>
                            ))}
                          </select>
                        </label>
                        <label>Supervisory org
                          <select disabled={Boolean(changePositionId)} value={changeSupervisoryOrgUnitId} onChange={(event) => setChangeSupervisoryOrgUnitId(event.target.value)}>
                            <option value="">No change</option>
                            <option value="__clear__">Clear supervisory org</option>
                            {connectedProfile.changeOptions.orgUnits.filter((unit) => unit.type === "supervisory").map((unit) => (
                              <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>
                            ))}
                          </select>
                        </label>
                        <label>Legal employer
                          <select disabled={Boolean(changePositionId)} value={changeLegalEntityId} onChange={(event) => setChangeLegalEntityId(event.target.value)}>
                            <option value="">No change</option>
                            {connectedProfile.changeOptions.legalEntities.map((entity) => (
                              <option key={entity.id} value={entity.id}>{entity.code} · {entity.displayName}</option>
                            ))}
                          </select>
                        </label>
                        <label>Cost center
                          <select disabled={Boolean(changePositionId)} value={changeCostCenterId} onChange={(event) => setChangeCostCenterId(event.target.value)}>
                            <option value="">No change</option>
                            <option value="__clear__">Clear cost center</option>
                            {connectedProfile.changeOptions.costCenters.map((center) => (
                              <option key={center.id} value={center.id}>{center.code} · {center.name}</option>
                            ))}
                          </select>
                        </label>
                        <label>Manager
                          <select disabled={Boolean(changePositionId)} value={changeManagerEmployeeId} onChange={(event) => setChangeManagerEmployeeId(event.target.value)}>
                            <option value="">No change</option>
                            <option value="__clear__">Clear manager</option>
                            {connectedProfile.changeOptions.managers.map((manager) => (
                              <option key={manager.id} value={manager.id}>{manager.firstName} {manager.lastName} · {manager.title}</option>
                            ))}
                          </select>
                        </label>
                        <label>Employment type
                          <select disabled={Boolean(changePositionId)} value={changeEmploymentType} onChange={(event) => setChangeEmploymentType(event.target.value)}>
                            <option value="">No change</option>
                            {connectedProfile.changeOptions.employmentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <label>Employee status
                          <select value={changeEmployeeStatus} onChange={(event) => setChangeEmployeeStatus(event.target.value)}>
                            <option value="">No change</option>
                            {connectedProfile.changeOptions.employeeStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </label>
                        <label>Reason
                          <input required minLength={3} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Approved promotion effective next month" />
                        </label>
                      </div>
                      <div className="modal-note" style={{ margin: "8px 0 10px" }}>
                        Position moves inherit org, supervisory org, legal employer, cost center, manager, and employment type from the approved position. Retroactive position moves are blocked; guarded retroactive corrections are allowed only when no later employment event would be invalidated.
                      </div>
                      <div className="run-actions">
                        <button type="button" className="secondary-button" onClick={() => setShowEffectiveChange(false)}>Cancel</button>
                        <button className="primary-button" disabled={effectiveChangeBusy || !changeReason.trim()}>
                          <CalendarDays size={14} /> {effectiveChangeBusy ? "Submitting…" : "Submit for approval"}
                        </button>
                      </div>
                    </form>
                  )}

                  {connectedProfile.effectiveChanges.length > 0 && (
                    <div>
                      {connectedProfile.effectiveChanges.slice(0, 6).map((change) => (
                        <div className="payslip-line" key={`effective-change-${change.id}`} style={{ gridTemplateColumns: "1fr auto" }}>
                          <span>
                            {change.movementType.replaceAll("_", " ")} · effective {formatDate(change.effectiveDate)}
                            <em>
                              {change.reason} · requested by {change.requestedBy}
                              {change.approvedBy ? ` · approved by ${change.approvedBy}` : ""}
                              {change.failure ? ` · failed: ${change.failure}` : ""}
                            </em>
                          </span>
                          <div className="run-actions" style={{ justifyContent: "flex-end" }}>
                            <span className={change.status === "applied" ? "status status-verified" : change.status === "failed" || change.status === "declined" ? "status status-rejected" : "status"}>
                              {change.status.replaceAll("_", " ")}
                            </span>
                            {change.status === "pending_approval" && change.requestedByUserId !== data.user?.id && (
                              <>
                                <button type="button" className="secondary-button" disabled={effectiveChangeBusy} onClick={() => void decideEffectiveChange(change.id, "decline")}>Decline</button>
                                <button type="button" className="primary-button" disabled={effectiveChangeBusy} onClick={() => void decideEffectiveChange(change.id, "approve")}>Approve</button>
                              </>
                            )}
                            {change.status === "pending_approval" && (
                              <button type="button" className="secondary-button" disabled={effectiveChangeBusy} onClick={() => void decideEffectiveChange(change.id, "cancel")}>Cancel</button>
                            )}
                            {change.status === "scheduled" && (
                              <button type="button" className="secondary-button" disabled={effectiveChangeBusy} onClick={() => void decideEffectiveChange(change.id, "cancel")}>Cancel</button>
                            )}
                            {change.status === "failed" && (
                              <>
                                <button type="button" className="secondary-button" disabled={effectiveChangeBusy} onClick={() => void decideEffectiveChange(change.id, "cancel")}>Cancel</button>
                                <button type="button" className="primary-button" disabled={effectiveChangeBusy} onClick={() => void decideEffectiveChange(change.id, "retry")}>Retry</button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {connectedProfile.effectiveChanges.length === 0 && (
                    <div className="empty-state">No scheduled or historical HCM employment changes yet.</div>
                  )}
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
                  <div className={connectedProfile.summary.pendingPolicyAcknowledgements ? "notice notice-amber" : "notice notice-slate"} style={{ margin: 0 }}>
                    <FileText size={15} className="i-purple" />
                    <span>
                      <strong>{connectedProfile.summary.pendingPolicyAcknowledgements} pending policy acknowledgement{connectedProfile.summary.pendingPolicyAcknowledgements === 1 ? "" : "s"}.</strong>{" "}
                      {connectedProfile.documents.policies.filter((item) => item.status === "assigned").slice(0, 2).map((item) => item.title).join(", ") || "Policy acknowledgements are current."}
                    </span>
                  </div>
                  <div className={connectedProfile.summary.documentComplianceRisks ? "notice notice-amber" : "notice notice-slate"} style={{ margin: 0 }}>
                    <ShieldCheck size={15} className="i-purple" />
                    <span>
                      <strong>{connectedProfile.summary.documentComplianceRisks} document item{connectedProfile.summary.documentComplianceRisks === 1 ? "" : "s"} need attention.</strong>{" "}
                      {connectedProfile.documents.requirements.filter((item) => ["missing", "submitted", "expiring", "expired"].includes(item.status)).slice(0, 2).map((item) => `${item.name}: ${item.status}`).join(", ") || "Required documents are current."}
                    </span>
                  </div>
                </div>

                {(connectedProfile.history.employmentEvents.length > 0 || connectedProfile.history.positionAssignments.length > 0) && (
                  <div style={{ marginTop: 14 }}>
                    <div className="card-kicker" style={{ marginBottom: 6 }}>WORKER HISTORY</div>
                    {connectedProfile.history.employmentEvents.slice(0, 6).map((event) => (
                      <div className="payslip-line" key={`employment-event-${event.id}`} style={{ gridTemplateColumns: "1fr auto" }}>
                        <span>
                          {event.eventType.replaceAll("_", " ")}
                          <em>{event.reason} · recorded by {event.actorName}</em>
                        </span>
                        <b>{formatDate(event.effectiveDate)}</b>
                      </div>
                    ))}
                    {connectedProfile.history.positionAssignments.slice(0, 4).map((assignment) => (
                      <div className="payslip-line" key={`position-history-${assignment.id}`} style={{ gridTemplateColumns: "1fr auto" }}>
                        <span>
                          {assignment.position
                            ? `${assignment.position.code} · ${assignment.position.profile?.title ?? "Position"}`
                            : `Position assignment #${assignment.id}`}
                          <em>
                            {assignment.assignmentType} · {Number(assignment.fte).toFixed(2)} FTE · {assignment.position?.orgUnit?.name ?? "No org unit"} · {assignment.position?.supervisoryOrg?.name ?? "No supervisory org"} · {assignment.position?.costCenter?.code ?? "No cost center"} · {assignment.reason}
                          </em>
                        </span>
                        <b>{formatDate(assignment.effectiveFrom)}{assignment.effectiveUntil ? ` → ${formatDate(assignment.effectiveUntil)}` : " → current"}</b>
                      </div>
                    ))}
                  </div>
                )}

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
                  This profile is an HCM control surface, not a second source of truth. Current position and employment state remain authoritative in their governed modules; the worker timeline preserves the effective-dated history of those changes.
                </div>
              </div>
            )}
          </section>
        )}

        {canManageEmploymentLifecycle && (
          <HcmEmploymentLifecycleWorker
            organizationId={data.selectedOrganization.id}
            employeeId={employee.id}
            currentEmploymentType={employee.employmentType}
            onChanged={refreshConnectedProfile}
            onOpenSeparation={() => onPage("separation")}
          />
        )}

        {canManage && connectedProfile?.position?.profile?.id && (
          <>
            {connectedProfile.capabilities.workforceEligibility && (
              <div
                className={`notice ${connectedProfile.capabilities.workforceEligibility.eligible ? "notice-green" : "notice-amber"}`}
                style={{ marginBottom: 16 }}
              >
                <ShieldCheck size={15} />
                <span>
                  <strong>
                    {connectedProfile.capabilities.workforceEligibility.eligible
                      ? "Qualified for role-based WFM coverage."
                      : "Blocked from qualified role coverage and role-specific open shifts."}
                  </strong>
                  {" "}
                  {connectedProfile.capabilities.workforceEligibility.blockers.join(" ")}
                  {connectedProfile.capabilities.workforceEligibility.warnings.length > 0
                    ? " " + connectedProfile.capabilities.workforceEligibility.warnings.join(" ")
                    : ""}
                </span>
              </div>
            )}
            <HcmCapabilitiesPanel
              organizationId={data.selectedOrganization.id}
              employeeId={employee.id}
              jobProfileId={connectedProfile.position.profile.id}
              canManage={canManage}
              onChanged={refreshConnectedProfile}
            />
          </>
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
                <label>Change reason
                  <input value={payoutChangeReason} onChange={(event) => setPayoutChangeReason(event.target.value)} placeholder="Why is this payout destination changing?" />
                </label>
              </div>
              <div className="modal-note" style={{ margin: "0 16px 10px" }}>
                Leave account number blank to keep the saved destination; newly supplied numbers are encrypted server-side and returned masked. Once this employee appears in any payroll register (including a calculated Draft), bank/mobile payout changes require enterprise Treasury Controls and a different assigned treasury approver. Without that policy, direct entry is available only before this worker's first payroll calculation to a company-wide owner/admin with MFA. Never bypass an approval by creating a replacement employee.
              </div>
              {payoutError && <div className="notice notice-amber" style={{ margin: "0 16px 10px" }}><span>{payoutError}</span></div>}
              {payoutNotice && <div className="notice notice-slate" style={{ margin: "0 16px 10px" }}><span>{payoutNotice}</span></div>}
              <div className="run-actions">
                <button className="primary-button" disabled={savingPayout || !bankCode.trim()} onClick={() => void savePayoutDetails()}>
                  <Check size={14} /> {savingPayout ? "Submitting…" : "Submit payout change"}
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
              {payoutNotice && <div className="notice notice-slate" style={{ marginTop: 12 }}><span>{payoutNotice}</span></div>}
              {payoutError && <div className="notice notice-amber" style={{ marginTop: 12 }}><span>{payoutError}</span></div>}
              {payoutChangeRequests.filter((row) => row.status === "pending").map((row) => {
                const canAttemptDecision = Boolean(
                  data.user
                  && data.access?.companyWide
                  && ["owner", "admin", "bookkeeper"].includes(data.access.role)
                  && row.requestedByUserId !== data.user.id,
                );
                return (
                  <div className="leave-request" key={row.id} style={{ marginTop: 12 }}>
                    <div className="inline-icon purple"><ShieldCheck size={15} /></div>
                    <div style={{ flex: 1 }}>
                      <strong>Pending payout change #{row.id}</strong>
                      <span>
                        {row.proposedMaskedAccount || "No bank account"} · {row.proposedBankCode || "No bank code"}
                        {row.proposedMobile ? ` · ${row.proposedMobile}` : ""}
                        {` · requested by ${row.requestedByName}`}
                      </span>
                      <small>{row.reason}</small>
                    </div>
                    {canAttemptDecision && (
                      <div style={{ minWidth: 240 }}>
                        <input
                          value={payoutDecisionNote}
                          onChange={(event) => setPayoutDecisionNote(event.target.value)}
                          placeholder="Decision note (optional)"
                          style={{ width: "100%", marginBottom: 6 }}
                        />
                        <div className="run-actions" style={{ margin: 0 }}>
                          <button className="secondary-button" disabled={payoutDecisionBusy} onClick={() => void decidePayoutChange(row.id, "reject")}><X size={14} /> Reject</button>
                          <button className="primary-button" disabled={payoutDecisionBusy} onClick={() => void decidePayoutChange(row.id, "approve")}><Check size={14} /> Approve</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
