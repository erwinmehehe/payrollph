"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { buildPayrollAttention } from "@/lib/payroll-attention";

export type Notification = {
  id: string;
  title: string;
  detail: string;
  at?: string | Date;
  tone: "review" | "active" | "danger" | "success";
  page?: string;
  actionLabel?: string;
  employeeId?: number;
  timeFilter?: "incomplete";
};

export function WorkspaceShell({
  data,
  page,
  onPage,
  notifications,
  onOpenPalette,
  onOpenNotification,
  onOpenNotificationItem,
  onSwitchClient,
  onSwitchRole,
  onSignOut,
  visiblePages,
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
  onOpenNotificationItem?: (item: Notification) => void;
  onSwitchClient: (id: number) => void;
  onSwitchRole?: (role: DemoRoleId) => void;
  onSignOut: () => void;
  visiblePages?: readonly string[];
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

  const isFreelancer = data.selectedOrganization.accountType === "freelancer";
  const openApprovals = data.tasks.filter((task) => task.status === "Pending").length;
  const roleInfo = demoRoleInfo(displayRole);
  const userName = roleInfo?.person ?? data.user?.name ?? "Signed-in user";
  const roleLabel = roleInfo?.shortLabel ?? (data.user?.role === "employee" ? "Employee" : data.user?.role ?? "Member");
  const defaultPage = visiblePages?.[0] ?? "Overview";

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
    <div className={`app-shell ${rail ? "rail" : ""} ${drawer ? "drawer-open" : ""}`}>
      <button className="nav-scrim" aria-label="Close navigation" onClick={() => setDrawer(false)} tabIndex={drawer ? 0 : -1} />

      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            <span className="brand-bars">
              <i />
              <i />
              <i />
            </span>
          </span>
          <div>
            <strong>linaw</strong>
            <span className="brand-subtitle">HR &amp; Payroll</span>
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
          <span>{isFreelancer ? "Solo workspace" : `${roleLabel} workspace`}</span>
        </div>

        <nav className="side-navigation slim-scroll">
          {NAVIGATION.map((group) => {
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
                      onClick={() => go(item.name)}
                      aria-current={active ? "page" : undefined}
                      title={rail ? item.name : undefined}
                    >
                      <span className={`nav-icon t-${item.tone}`} aria-hidden>
                        <Icon size={14} strokeWidth={active ? 2.3 : 2} />
                      </span>
                      <span>{item.name}</span>
                      {badge && <b>{badge}</b>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" onClick={onSignOut}>
            <LogOut size={16} className="i-slate" />
            <span>Sign out</span>
          </button>
          <div className="side-profile">
            <Avatar initials={initialsOf(userName)} index={0} />
            <div>
              <strong>{userName}</strong>
              <span>{roleLabel}</span>
            </div>
            <MoreHorizontal size={16} />
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setDrawer(true)} aria-label="Open navigation">
              <Menu size={18} />
            </button>

            {/* Current-client indicator */}
            <div className="company-switcher-wrap">
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
              <span aria-current="page">{page}</span>
            </nav>
          </div>

          <div className="topbar-actions">
            <button className="palette-trigger" onClick={onOpenPalette} aria-label="Open command palette">
              <Search size={15} className="i-slate" />
              <span>Search…</span>
              <kbd>⌘K</kbd>
            </button>

            {headerExtras}

            {onSwitchRole && (
              <div className="company-switcher-wrap">
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

            <div className="company-switcher-wrap">
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
                            if (onOpenNotificationItem) {
                              onOpenNotificationItem(item);
                            } else if (item.page) {
                              onPage(item.page);
                            }
                          }}
                        >
                          <span className={`attention-icon ${item.tone === "review" || item.tone === "danger" ? "urgent" : ""}`} aria-hidden>
                            <ShieldCheck size={15} className="i-green" />
                          </span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                            {item.at && <time>{relativeTime(item.at)}</time>}
                            {item.actionLabel && <span className="tray-action">{item.actionLabel} <ChevronRight size={11} /></span>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              className="top-avatar"
              onClick={() => go(visiblePages?.includes("Settings") ? "Settings" : defaultPage)}
              title={visiblePages?.includes("Settings") ? "Account settings" : `Return to ${defaultPage}`}
              aria-label={visiblePages?.includes("Settings") ? "Account settings" : `Return to ${defaultPage}`}
            >
              {initialsOf(userName)}
            </button>
          </div>
        </header>

        <main className="content-area" id="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The tray is a live action queue, not a generic activity feed.
 * Items are derived from the current payroll lifecycle and disappear as soon
 * as the underlying blocker or handoff state changes.
 */
export function buildNotifications(
  data: DashboardData,
  role: string | null | undefined = data.access?.role ?? data.user?.role,
): Notification[] {
  return buildPayrollAttention(data, role);
}
