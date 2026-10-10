"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LinawMark } from "@/components/linaw-mark";
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Building2,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { FREELANCER_HIDDEN, NAVIGATION, groupOf } from "./nav";
import type { DashboardData, Organization } from "./types";
import { Avatar, initialsOf, relativeTime } from "./ui";
import { DEMO_ROLES, demoRoleInfo, type DemoRoleId } from "@/lib/demo-roles";
import { payrollHandoffRank } from "@/lib/payroll-handoff";
import { taskFirstUiEnabled } from "@/lib/task-first-ui";

export type Notification = {
  id: string;
  title: string;
  detail: string;
  at?: string | Date;
  tone: "review" | "active" | "danger" | "success";
  page?: string;
};

const WORKSPACE_LABELS: Record<string, string> = {
  Overview: "Home",
  People: "Employees",
  Analytics: "Reports",
};

function workspaceLabel(page: string, role?: string | null) {
  if (role === "owner" && page === "Analytics") return "Reports";
  if (role === "owner" && page === "People") return "Team";
  if (role === "payroll" && page === "Overview") return "Home";
  if (role === "payroll" && page === "Time & attendance") return "Attendance";
  if (role === "checker" && page === "Overview") return "Reviews";
  if (role === "checker" && page === "Audit trail") return "Payroll history";
  if (role === "hr" && page === "Overview") return "Today";
  if (role === "hr" && page === "Time & attendance") return "Time";
  if (role === "hr" && page === "Recruitment") return "Onboarding";
  if (role === "bookkeeper" && page === "Overview") return "Close";
  if (role === "bookkeeper" && page === "Analytics") return "Reports";
  if (role === "admin" && page === "Exports") return "Accounting";
  return WORKSPACE_LABELS[page] ?? page;
}

export function WorkspaceShell({
  data,
  page,
  onPage,
  notifications,
  onOpenPalette,
  onOpenNotification,
  onSwitchClient,
  onSwitchRole,
  onSignOut,
  visiblePages,
  primaryPages,
  workspaceRole,
  displayRole,
  allowClientSwitch = true,
  headerExtras,
  children,
}: {
  data: DashboardData;
  page: string;
  onPage: (page: string) => void;
  notifications: Notification[];
  onOpenPalette: () => void;
  onOpenNotification?: () => void;
  onSwitchClient: (id: number) => void;
  onSwitchRole?: (role: DemoRoleId) => void;
  onSignOut: () => void;
  visiblePages?: readonly string[];
  primaryPages?: readonly string[];
  workspaceRole?: string | null;
  displayRole?: DemoRoleId | null;
  allowClientSwitch?: boolean;
  headerExtras?: ReactNode;
  children: ReactNode;
}) {
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isFreelancer = data.selectedOrganization.accountType === "freelancer";
  const polishedPayrollNavigation = taskFirstUiEnabled() && workspaceRole === "payroll";
  const openApprovals = data.tasks.filter((task) => task.status === "Pending").length;
  const roleInfo = demoRoleInfo(displayRole);
  const userName = roleInfo?.person ?? data.user?.name ?? "Signed-in user";
  const roleLabel = roleInfo?.shortLabel ?? (data.user?.role === "employee" ? "Employee" : data.user?.role ?? "Member");
  const avatarRole = displayRole ?? data.user?.role ?? "member";
  const profileAvatarIndex = ({ owner: 0, admin: 0, hr: 1, payroll: 2, checker: 3, bookkeeper: 4, employee: 5 } as Record<string, number>)[avatarRole] ?? 0;
  const defaultPage = visiblePages?.[0] ?? "Overview";
  const allowedItems = NAVIGATION
    .flatMap((group) => group.items)
    .filter((item) => !(isFreelancer && FREELANCER_HIDDEN.has(item.name)))
    .filter((item) => !visiblePages || visiblePages.includes(item.name));
  const primarySet = new Set(primaryPages ?? allowedItems.map((item) => item.name));
  const primaryItems = allowedItems.filter((item) => primarySet.has(item.name));
  const secondaryItems = allowedItems.filter((item) => !primarySet.has(item.name));
  const navigationGroups = [{ label: "", items: primaryItems }];
  const secondaryGroups = NAVIGATION
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => secondaryItems.some((secondary) => secondary.name === item.name)),
    }))
    .filter((group) => group.items.length > 0);
  const secondaryHasCurrent = secondaryItems.some((item) => item.name === page);

  function closeOverlays() {
    setDrawer(false);
    setClientOpen(false);
    setRoleOpen(false);
    setTrayOpen(false);
  }

  /** Navigating always dismisses the drawer and every open popover. */
  function go(next: string) {
    closeOverlays();
    onPage(next);
  }

  // One Escape handler for all three popovers.
  useEffect(() => {
    if (!clientOpen && !roleOpen && !trayOpen && !drawer) return;
    function handler(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setClientOpen(false);
      setRoleOpen(false);
      setTrayOpen(false);
      setDrawer(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clientOpen, roleOpen, trayOpen, drawer]);

  function badgeFor(kind?: string) {
    if (kind === "approvals") return openApprovals ? String(openApprovals) : null;
    if (kind === "people") return data.employees.length ? String(data.employees.length) : null;
    if (kind === "runs") {
      const live = data.payrollRuns.filter((run) => run.status !== "Released").length;
      return live ? String(live) : null;
    }
    if (kind === "api") return "API";
    return null;
  }

  return (
    <div
      className={`app-shell clean-shell ${polishedPayrollNavigation ? "tf-shell" : ""} ${rail ? "rail" : ""} ${drawer ? "drawer-open" : ""}`}
      data-workspace-page={page}
      data-workspace-role={workspaceRole ?? undefined}
      data-demo-role={displayRole ?? undefined}
    >
      <button className="nav-scrim" aria-label="Close navigation" onClick={() => setDrawer(false)} tabIndex={drawer ? 0 : -1} />

      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            <LinawMark />
          </span>
          <div>
            <strong>Linaw</strong>
            <span className="brand-subtitle">PayrollPH</span>
          </div>
          <button
            className="sidebar-collapse"
            onClick={() => setRail((current) => !current)}
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            title={rail ? "Expand sidebar" : "Collapse sidebar"}
          >
            {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <div className="workspace-label">
          <span className="pulse-dot" aria-hidden />
          <span>{polishedPayrollNavigation ? "Payroll officer" : isFreelancer ? "Solo workspace" : `${roleLabel} workspace`}</span>
        </div>

        <nav className="side-navigation slim-scroll">
          {navigationGroups.map((group) => {
            const items = group.items
              .filter((item) => !(isFreelancer && FREELANCER_HIDDEN.has(item.name)))
              .filter((item) => !visiblePages || visiblePages.includes(item.name));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = page === item.name;
                  const badge = badgeFor(item.badge);
                  return (
                    <button
                      key={item.name}
                      className={`nav-item ${active ? "active" : ""}`}
                      data-tone={item.tone}
                      data-nav-name={item.name}
                      onClick={() => go(item.name)}
                      aria-current={active ? "page" : undefined}
                      title={rail ? item.name : undefined}
                    >
                      <span className={`nav-icon t-${item.tone}`} aria-hidden>
                        <Icon size={polishedPayrollNavigation ? 18 : 14} strokeWidth={polishedPayrollNavigation ? (active ? 2.2 : 1.9) : (active ? 2.3 : 2)} />
                      </span>
                      <span>{workspaceLabel(item.name, workspaceRole)}</span>
                      {badge && <b>{badge}</b>}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {secondaryItems.length > 0 && (
            <div className="nav-group nav-more-group">
              <button
                type="button"
                className={`nav-item nav-more-toggle ${secondaryHasCurrent ? "active" : ""}`}
                onClick={() => setMoreOpen((current) => !current)}
                aria-expanded={moreOpen || secondaryHasCurrent}
              >
                <span className="nav-icon t-slate" aria-hidden>
                  <MoreHorizontal size={polishedPayrollNavigation ? 18 : 14} strokeWidth={polishedPayrollNavigation ? 1.9 : 2} />
                </span>
                <span>More</span>
                <ChevronDown className="nav-more-chevron" size={13} />
              </button>

              {(moreOpen || secondaryHasCurrent) && (
                <div className="nav-more-items">
                  {secondaryGroups.map((group) => (
                    <div className="nav-more-section" key={group.label}>
                      <p>{group.label}</p>
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = page === item.name;
                        const badge = badgeFor(item.badge);
                        return (
                          <button
                            key={item.name}
                            className={`nav-item ${active ? "active" : ""}`}
                            data-tone={item.tone}
                            data-nav-name={item.name}
                            onClick={() => go(item.name)}
                            aria-current={active ? "page" : undefined}
                            title={rail ? item.name : undefined}
                          >
                            <span className={`nav-icon t-${item.tone}`} aria-hidden>
                              <Icon size={polishedPayrollNavigation ? 18 : 14} strokeWidth={polishedPayrollNavigation ? (active ? 2.2 : 1.9) : (active ? 2.3 : 2)} />
                            </span>
                            <span>{workspaceLabel(item.name, workspaceRole)}</span>
                            {badge && <b>{badge}</b>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" onClick={onSignOut}>
            <LogOut size={16} className="i-slate" />
            <span>Sign out</span>
          </button>
          <button
            type="button"
            className="side-profile"
            onClick={() => go(visiblePages?.includes("Settings") ? "Settings" : defaultPage)}
            aria-label={visiblePages?.includes("Settings") ? "Open account settings" : `Return to ${defaultPage}`}
          >
            <span className="side-profile-avatar">
              <Avatar initials={initialsOf(userName)} index={profileAvatarIndex} />
              <i aria-hidden />
            </span>
            <div>
              <strong>{userName}</strong>
              <span>{roleLabel}</span>
            </div>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setDrawer(true)} aria-label="Open navigation">
              <Menu size={18} />
            </button>

            {/* Current-client indicator */}
            <div className="company-switcher-wrap client-switcher-wrap">
              <button
                className="company-switcher"
                onClick={() => allowClientSwitch && setClientOpen((current) => !current)}
                aria-expanded={allowClientSwitch ? clientOpen : false}
                aria-haspopup={allowClientSwitch ? "menu" : undefined}
                disabled={!allowClientSwitch}
              >
                <span className="company-logo" style={{ backgroundColor: data.selectedOrganization.color }} aria-hidden>
                  {data.selectedOrganization.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{data.selectedOrganization.name}</strong>
                  <small>
                    {data.selectedOrganization.plan} ·{" "}
                    {isFreelancer ? "self-employed" : `${data.employees.length} people`}
                  </small>
                </span>
                {allowClientSwitch && <ChevronDown size={15} />}
              </button>
              {clientOpen && allowClientSwitch && (
                <div className="company-popover" role="menu">
                  <p>
                    Client portfolio <span>{data.organizations.length} accounts</span>
                  </p>
                  {data.organizations.map((organization: Organization) => (
                    <button
                      key={organization.id}
                      role="menuitemradio"
                      aria-checked={organization.id === data.selectedOrganization.id}
                      className={organization.id === data.selectedOrganization.id ? "selected" : ""}
                      onClick={() => {
                        closeOverlays();
                        onSwitchClient(organization.id);
                      }}
                    >
                      <span className="company-logo small" style={{ backgroundColor: organization.color }} aria-hidden>
                        {organization.name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{organization.name}</strong>
                        <small>
                          {organization.accountType === "freelancer"
                            ? "Self-employed"
                            : `${organization.employeeCount} people · ${organization.plan}`}
                        </small>
                      </span>
                      {organization.id === data.selectedOrganization.id && <Check size={15} className="i-green" />}
                    </button>
                  ))}
                  <button className="popover-footer" onClick={() => go("Settings")}>
                    <Building2 size={14} className="i-purple" /> Manage client access
                  </button>
                </div>
              )}
            </div>

            {/* Breadcrumbs */}
            <nav className="crumbs" aria-label="Breadcrumb">
              <ChevronRight size={14} />
              <button onClick={() => go(defaultPage)}>{groupOf(page)}</button>
              <ChevronRight size={14} />
              <span aria-current="page">{workspaceLabel(page, workspaceRole)}</span>
            </nav>
          </div>

          <div className="topbar-actions">
            <button className="palette-trigger" onClick={onOpenPalette} aria-label="Open command palette">
              <Search size={15} className="i-slate" />
              <span>Search employees, payroll, reports...</span>
              <kbd>⌘K</kbd>
            </button>

            {headerExtras}

            {onSwitchRole && (
              <div className="company-switcher-wrap role-switcher-wrap">
                <button className="role-pill-btn" onClick={() => setRoleOpen((current) => !current)} aria-expanded={roleOpen} aria-haspopup="menu">
                  <UserCheck size={14} style={{ color: "var(--brand)" }} />
                  <span>{displayRole ? `Demo: ${roleLabel}` : roleLabel}</span>
                  <ChevronDown size={13} />
                </button>
                {roleOpen && (
                  <div className="company-popover" role="menu" style={{ width: 300, right: 0, left: "auto" }}>
                    <p>
                      Switch demo role <span>sample workspace</span>
                    </p>
                    {DEMO_ROLES.map((role, index) => (
                      <button
                        key={role.id}
                        role="menuitem"
                        onClick={() => {
                          setRoleOpen(false);
                          onSwitchRole(role.id);
                        }}
                      >
                        <span className={`avatar avatar-${index % 5}`}>{role.person.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                        <span>
                          <strong>{role.label}</strong>
                          <small>{role.description}</small>
                        </span>
                      </button>
                    ))}
                    <a className="popover-footer" href="/demo">
                      <UserCheck size={14} className="i-purple" /> View all demo roles
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className="company-switcher-wrap notification-switcher-wrap">
              <button
                className="icon-button relative"
                onClick={() => setTrayOpen((current) => !current)}
                aria-expanded={trayOpen}
                aria-label={`Notifications${notifications.length ? ` (${notifications.length} unread)` : ""}`}
              >
                <Bell size={17} className="i-pink" />
                {notifications.length > 0 && <span className="notification-dot">{notifications.length > 9 ? "9+" : notifications.length}</span>}
              </button>
              {trayOpen && (
                <div className="company-popover tray" role="dialog" aria-label="Notifications">
                  <div className="tray-head">
                    <strong>Notifications</strong>
                    {onOpenNotification && (
                      <button
                        className="link-button"
                        onClick={() => {
                          setTrayOpen(false);
                          onOpenNotification();
                        }}
                      >
                        Email outbox
                      </button>
                    )}
                  </div>
                  <div className="tray-list slim-scroll">
                    {notifications.length === 0 ? (
                      <div className="empty-state small">
                        <Check size={17} style={{ color: "var(--success)" }} />
                        Nothing needs your attention.
                      </div>
                    ) : (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          className="tray-item"
                          onClick={() => {
                            setTrayOpen(false);
                            if (item.page) onPage(item.page);
                          }}
                        >
                          <span className={`attention-icon ${item.tone === "review" || item.tone === "danger" ? "urgent" : ""}`} aria-hidden>
                            <ShieldCheck size={15} className="i-green" />
                          </span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                            {item.at && <time>{relativeTime(item.at)}</time>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              className="top-profile-button"
              onClick={() => go(visiblePages?.includes("Settings") ? "Settings" : defaultPage)}
              title={visiblePages?.includes("Settings") ? "Account settings" : `Return to ${defaultPage}`}
              aria-label={visiblePages?.includes("Settings") ? "Account settings" : `Return to ${defaultPage}`}
            >
              <span className={`top-avatar avatar-${profileAvatarIndex}`}>{initialsOf(userName)}</span>
              <span className="top-profile-copy">
                <strong>{userName}</strong>
                <small>{roleLabel}</small>
              </span>
            </button>
          </div>
        </header>

        <main className="content-area" id="workspace-main">
          {children}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile workspace navigation">
        {primaryItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = page === item.name;
          return (
            <button
              key={item.name}
              type="button"
              className={active ? "active" : ""}
              data-tone={item.tone}
              onClick={() => go(item.name)}
              aria-current={active ? "page" : undefined}
            >
              <span className={`nav-icon t-${item.tone}`} aria-hidden>
                <Icon size={polishedPayrollNavigation ? 18 : 16} strokeWidth={polishedPayrollNavigation ? (active ? 2.2 : 1.9) : (active ? 2.3 : 2)} />
              </span>
              <span>{workspaceLabel(item.name, workspaceRole)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Derives the notification tray from real workspace rows. Nothing here is
 * invented, each entry points at a record the user can open.
 */
export function buildNotifications(data: DashboardData, role?: string | null): Notification[] {
  const items: Notification[] = [];
  const effectiveRole = role ?? data.access?.role ?? data.user?.role ?? null;
  const liveRuns = data.payrollRuns.filter((run) => run.status !== "Released");

  const latestMailStateByOutbox = new Map<number, { status: string; purpose: string }>();
  for (const event of data.auditEvents) {
    if (event.action !== "Outbox delivery attempted" && event.action !== "Outbox delivery retried") continue;
    if (!event.metadata || typeof event.metadata !== "object") continue;
    const meta = event.metadata as Record<string, unknown>;
    const outboxId = Number(meta.outboxId);
    if (!Number.isInteger(outboxId) || latestMailStateByOutbox.has(outboxId)) continue;
    latestMailStateByOutbox.set(outboxId, {
      status: typeof meta.status === "string" ? meta.status : "unknown",
      purpose: typeof meta.purpose === "string" ? meta.purpose : "",
    });
  }
  const failedPayslipNotices = [...latestMailStateByOutbox.values()]
    .filter((item) => item.purpose === "payslip-ready" && item.status === "failed")
    .length;

  const addMailFailureNotification = () => {
    if (failedPayslipNotices === 0) return;
    items.push({
      id: "payslip-email-delivery-failures",
      title: `${failedPayslipNotices} payslip email${failedPayslipNotices === 1 ? "" : "s"} need delivery attention`,
      detail: "Automatic retries are bounded. Open the Email outbox from Search to inspect or retry delivery.",
      tone: "danger",
      page: "Exports",
    });
  };

  const addComplianceActionNotifications = () => {
    if (!["owner", "admin", "bookkeeper", "payroll"].includes(effectiveRole ?? "")) return;
    const rank: Record<string, number> = { danger: 0, warning: 1, info: 2 };
    const actions = [...(data.complianceActions ?? [])]
      .filter((task) => task.status !== "resolved")
      .sort((a, b) =>
        (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
        || String(a.dueDate ?? "9999-99-99").localeCompare(String(b.dueDate ?? "9999-99-99"))
        || a.id - b.id,
      )
      .slice(0, 3);

    for (const task of actions) {
      const unassigned = task.assignedToUserId == null;
      const critical = task.severity === "danger";
      items.push({
        id: `compliance-action-${task.id}`,
        title: critical && unassigned ? `Unassigned critical: ${task.title}` : task.title,
        detail: `${task.detail} · ${task.assignedToName ? `Owner: ${task.assignedToName}` : "Unassigned"}`,
        tone: critical ? "danger" : task.severity === "warning" ? "review" : "active",
        page: "Payroll",
      });
    }
  };

  addComplianceActionNotifications();

  if (effectiveRole === "hr") {
    const handoffRun = data.payrollHandoffRun;
    if (handoffRun && payrollHandoffRank(handoffRun.status) === 0) {
      const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending").length;
      const attendanceIssues = (data.punches ?? []).filter((punch) => {
        const status = punch.status.toLowerCase();
        return !["complete", "present", "ok", "approved"].includes(status);
      }).length;
      const missingIds = data.employees.filter(
        (employee) =>
          employee.status === "Active" &&
          (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
      ).length;

      if (pendingLeave > 0) {
        items.push({
          id: "handoff-hr-leave",
          title: `${pendingLeave} leave request${pendingLeave === 1 ? "" : "s"} need HR review`,
          detail: `Clear leave inputs before ${handoffRun.periodLabel} moves to Payroll.`,
          tone: "review",
          page: "Leave",
        });
      }
      if (attendanceIssues > 0) {
        items.push({
          id: "handoff-hr-time",
          title: `${attendanceIssues} attendance issue${attendanceIssues === 1 ? "" : "s"} need context`,
          detail: `Resolve time inputs before ${handoffRun.periodLabel} moves to Payroll.`,
          tone: "review",
          page: "Time & attendance",
        });
      }
      if (missingIds > 0) {
        items.push({
          id: "handoff-hr-people",
          title: `${missingIds} employee record${missingIds === 1 ? "" : "s"} need filing IDs`,
          detail: "Complete the employee records that can block payroll filings.",
          tone: "review",
          page: "People",
        });
      }
    }
    return items;
  }

  if (effectiveRole === "payroll") {
    addMailFailureNotification();
    const run = liveRuns.find((item) => payrollHandoffRank(item.status) === 1);
    if (run) {
      items.push({
        id: `handoff-payroll-${run.id}`,
        title: run.exceptions > 0
          ? `Resolve ${run.exceptions} payroll exception${run.exceptions === 1 ? "" : "s"}`
          : `${run.periodLabel} is ready for checker handoff`,
        detail: run.exceptions > 0
          ? `${run.periodLabel} cannot move to Checker until the register is reviewed.`
          : "Open Payroll and submit the calculated run to an independent checker.",
        tone: run.exceptions > 0 ? "danger" : "review",
        page: "Payroll",
      });
    }
    return items;
  }

  if (effectiveRole === "checker") {
    const run = liveRuns.find((item) => payrollHandoffRank(item.status) === 2);
    if (run) {
      const task = data.tasks
        .filter((item) => item.status === "Pending" && item.detail.includes(`Payroll run #${run.id}`))
        .sort((a, b) => b.id - a.id)[0];
      if (task) {
        items.push({
          id: `handoff-checker-${task.id}`,
          title: `Review ${run.periodLabel} payroll`,
          detail: `${task.detail} · an independent decision is required before release.`,
          tone: task.priority === "High" ? "danger" : "review",
          page: "Approvals",
        });
      }
    }
    return items;
  }

  if (effectiveRole === "owner") {
    addMailFailureNotification();
    const run = liveRuns.find((item) => payrollHandoffRank(item.status) === 3);
    if (run) {
      items.push({
        id: `handoff-owner-${run.id}`,
        title: `${run.periodLabel} is approved and ready to release`,
        detail: "Open Payroll to run the final release checklist and release employee payslips.",
        tone: "success",
        page: "Payroll",
      });
    }
    return items;
  }

  if (["admin", "bookkeeper"].includes(effectiveRole ?? "")) {
    addMailFailureNotification();
  }

  for (const task of data.tasks.filter((task) => task.status === "Pending").slice(0, 5)) {
    items.push({
      id: `task-${task.id}`,
      title: task.title,
      detail: `${task.detail} · ${task.dueLabel}`,
      tone: task.priority === "High" ? "danger" : "review",
      page: "Approvals",
    });
  }

  for (const run of liveRuns.filter((run) => run.exceptions > 0).slice(0, 3)) {
    items.push({
      id: `run-${run.id}`,
      title: `${run.exceptions} timekeeping exception${run.exceptions === 1 ? "" : "s"} on ${run.periodLabel}`,
      detail: "Incomplete punches derive zero hours and need sign-off before release.",
      tone: "review",
      page: "Payroll",
    });
  }

  return items;
}
