"use client";
import { MoreModules } from "@/components/workspace/more-modules";
import { CoreReports } from "@/components/workspace/core-reports";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { canOpenPeopleHome } from "@/lib/hcm-people-home-scope";
import { Clock, ShieldCheck, Sparkles } from "lucide-react";
import { ItOperationsPanel } from "@/components/it-operations-panel";
import { AutomationStudioPanel } from "@/components/automation-studio-panel";
import { BenefitsPanel } from "@/components/benefits-panel";
import { ContractorsPanel } from "@/components/contractors-panel";
import { CompensationPanel } from "@/components/compensation-panel";
import { HcmDocumentsPanel } from "@/components/hcm-documents-panel";
import { DeMinimisPanel } from "@/components/de-minimis-panel";
import { DemoSandboxBar } from "@/components/demo-sandbox-bar";
import { HrisHomeShortcuts } from "@/components/hris-home-shortcuts";
import { HrisOnboardingChecklist } from "@/components/hris-onboarding-checklist";
import { DisciplinePanel } from "@/components/discipline-panel";
import { LoansPanel } from "@/components/loans-panel";
import { LegalEntitiesPanel } from "@/components/legal-entities-panel";
import { PayoutProfilesPanel } from "@/components/payout-profiles-panel";
import { MigrationCenter } from "@/components/migration-center";
import { NewHireModal } from "@/components/new-hire-modal";
import { RecruitmentPanel } from "@/components/recruitment-panel";
import { PerformancePanel } from "@/components/performance-panel";
import { EnterpriseControlsPanel } from "@/components/enterprise-controls-panel";
import { SeparationPanel } from "@/components/separation-panel";
import { EwaPanel } from "@/components/wallet-panel";
import { SpendOperationsPanel } from "@/components/spend-operations-panel";
import { WebBundyModal } from "@/components/web-bundy-modal";
import { LaunchReadinessPanel } from "@/components/workspace/launch-readiness-panel";
import { AnalyticsView } from "@/components/workspace/analytics";
import { ApprovalsView } from "@/components/workspace/approvals";
import { CommandPalette, usePaletteShortcut, type PaletteAction } from "@/components/workspace/command-palette";
import { ExportsView } from "@/components/workspace/exports";
import { FirstPayrollReadinessCard } from "@/components/workspace/first-payroll-readiness";
import { OfflinePunchReviewQueue } from "@/components/workspace/offline-punch-review";
import { useWorkflowUi } from "@/components/workspace/workflow-ui-context";
import { ProductionPilotSignoffCard } from "@/components/workspace/production-pilot-signoff";
import { tenantNavigationPages } from "@/components/workspace/nav";
import { OverviewView } from "@/components/workspace/overview";
import { RoleOverviewView, type WorkspaceDashboardRole } from "@/components/workspace/role-overview";
import {
  AuditPage,
  CheckoutModal,
  CompliancePage,
  DeveloperPage,
  FreelancerPage,
  GovValidationModal,
  IntegrationsPage,
  LeavePage,
  NewPayrollModal,
  OutboxModal,
  PricingPage,
  SettingsPage,
} from "@/components/workspace/panels";
import { PayrollRunView } from "@/components/workspace/payroll-run";
import { PeopleView } from "@/components/workspace/people";
import { WorkspaceShell, buildNotifications } from "@/components/workspace/shell";
import {
  EntityBadge, EntitySwitcher, EntityFilter, EntitySettingsView, EntityTransferInbox,
  useMultiEntityRequestHeaders,
} from "@/components/workspace/multi-entity-ui";
import { TimeView } from "@/components/workspace/time";
import { WorkforcePlanner } from "@/components/workspace/workforce-planner";
import { WorkforcePlanningPanel } from "@/components/workforce-planning-panel";
import type { DashboardData, PayrollReleaseReceipt, PricingPlan } from "@/components/workspace/types";
import { ToastStack, useToasts } from "@/components/workspace/ui";
import { demoRoleInfo, demoRolePages, demoRolePath, isDemoRole, type DemoRoleId } from "@/lib/demo-roles";
import { roleCanDecideApprovals, roleCanManageDelegations, roleCanManagePayroll, roleCanManagePeople, roleCanManageTime, roleHasPeopleWorkspace, workspacePagesForRole, workspacePrimaryPagesForRole } from "@/lib/workspace-role-ui";
import { hrisHomeShortcutsForRole } from "@/lib/hris-home-shortcuts";
import { requestedMyTeamWorkspacePage } from "@/lib/hcm-my-team-navigation";
import { resolvePeopleEmployeeFocus } from "@/lib/hcm-people-employee-focus";
import { useDashboardReadRecovery } from "@/lib/use-dashboard-read-recovery";
import { resolveFirstPayrollRunFocus } from "@/lib/first-payroll-run-navigation";
import { EmployerSetupHelp } from "@/components/workspace/employer-setup-help";
import { payrollEmployerSetupDestination } from "@/lib/payroll-employer-options";

export function LinawWorkspace({ initialData, isSelfServeCustomer = false, inlineFirstPayrollEnabled = false, pilotFocusEnabled = false, allowPeopleFocus = false, allowHirePayrollReview = false, reviewTeamHref = null, optionalUiCapabilities = { overpaymentPreview: false, overpaymentInvestigation: false, tenantReportBuilder: false } }: { initialData: DashboardData; isSelfServeCustomer?: boolean; inlineFirstPayrollEnabled?: boolean; pilotFocusEnabled?: boolean; allowPeopleFocus?: boolean; allowHirePayrollReview?: boolean; reviewTeamHref?: string | null; optionalUiCapabilities?: { overpaymentPreview: boolean; overpaymentInvestigation: boolean; tenantReportBuilder: boolean } }) {
  const searchParams = useSearchParams();
  const workflowUi = useWorkflowUi();
  const requestedDemoRole = searchParams.get("demoRole");
  const demoRole: DemoRoleId | null =
    requestedDemoRole &&
    isDemoRole(requestedDemoRole) &&
    initialData.user?.role === requestedDemoRole
      ? requestedDemoRole
      : null;
  const demoInfo = demoRoleInfo(demoRole);
  const requestedWorkspacePage = searchParams.get("workspacePage");
  const focusedPayrollRunId = resolveFirstPayrollRunFocus({
    enabled: initialData.firstPayrollConnectedEnabled === true,
    demoMode: Boolean(demoRole), requestedPage: requestedWorkspacePage,
    requestedOrganizationId: searchParams.get("organizationId"),
    requestedRunId: searchParams.get("focusPayrollRunId"),
    organizationId: initialData.selectedOrganization.id,
    access: initialData.access, authorizedRuns: initialData.payrollRuns,
  });
  const linkedTeamWorkflowPage = requestedMyTeamWorkspacePage({
    requestedPage: requestedWorkspacePage,
    role: initialData.access?.role ?? initialData.user?.role,
    companyWide: initialData.access?.companyWide,
    accountType: initialData.selectedOrganization.accountType,
    rolePages: workspacePagesForRole(initialData.access?.role ?? initialData.user?.role),
    pilotFocusEnabled,
    demoMode: Boolean(demoRole),
  });
  // Only company-wide People operators can return from the read-only
  // payroll input review; managers and demo users retain their own routes.
  const reviewPages = workspacePagesForRole(initialData.access?.role);
  const linkedHirePayrollPage =
    allowHirePayrollReview && !pilotFocusEnabled && !demoRole &&
    initialData.access?.companyWide &&
    ["owner", "admin", "hr"].includes(initialData.access.role) &&
    initialData.selectedOrganization.accountType !== "freelancer" &&
    (requestedWorkspacePage === "Recruitment" ||
      requestedWorkspacePage === "Time & attendance") &&
    (!reviewPages || reviewPages.includes(requestedWorkspacePage))
      ? requestedWorkspacePage : null;
  const initialPage = demoInfo?.landingPage ??
    (searchParams.get("workspacePage") === "People" &&
      canOpenPeopleHome(initialData.access) &&
      roleHasPeopleWorkspace(initialData.access?.role)
      ? "People" : focusedPayrollRunId !== null ? "Payroll" : linkedTeamWorkflowPage ?? linkedHirePayrollPage ?? "Overview");
  const dashboardRole = normalizeDashboardRole(demoRole ?? initialData.access?.role ?? initialData.user?.role);

  const [data, setData] = useState(initialData);
  const { refresh, refreshIssue, refreshLoading } = useDashboardReadRecovery(
    data.selectedOrganization.id, setData,
  );
  useMultiEntityRequestHeaders(data.multiEntity);
  const [page, updatePage] = useState(initialPage);
  const [busy, setBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"organization" | "team">("organization");
  // Reset the settings entry tab at the navigation boundary, not in an effect.
  // Keep this callback stable for the command palette's memoized actions.
  const setPage = useCallback((next: typeof initialPage) => {
    if (next !== "Settings") setSettingsInitialTab("organization");
    updatePage(next);
  }, [setSettingsInitialTab]);
  // A source-link can focus only a worker already in this selected employer's
  // authorized People snapshot. A stale or cross-employer URL opens no drawer.
  const [focusEmployeeId, setFocusEmployeeId] = useState<number | null>(() =>
    resolvePeopleEmployeeFocus({
      requestedPage: requestedWorkspacePage,
      requestedOrganizationId: searchParams.get("organizationId"),
      requestedEmployeeId: searchParams.get("focusEmployeeId"),
      selectedOrganizationId: initialData.selectedOrganization.id,
      access: initialData.access,
      authorizedEmployees: initialData.employees,
      serverAuthorized: allowPeopleFocus,
      demoMode: Boolean(demoRole),
    }));

  // Modals kept from the original build, all still server-authorised.
  const [newPayrollOpen, setNewPayrollOpen] = useState(false);
  const [outboxOpen, setOutboxOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<PricingPlan | null>(null);
  const [govModalOpen, setGovModalOpen] = useState(false);
  const [newHireOpen, setNewHireOpen] = useState(false);
  const [webBundyOpen, setWebBundyOpen] = useState(false);
  const [demoSwitching, setDemoSwitching] = useState<DemoRoleId | null>(null);

  const { toasts, notify, dismiss } = useToasts();
  const noticeAdapter = useCallback((message: string) => notify(message, "info"), [notify]);

  const isFreelancer = data.selectedOrganization.accountType === "freelancer";
  const currentRun = data.payrollRuns.find((run) => run.status !== "Released") ?? data.payrollRuns[0];

  const effectiveRole = demoRole ?? data.access?.role ?? data.user?.role ?? null;
  const rolePages = demoRole ? demoRolePages(demoRole) : workspacePagesForRole(effectiveRole);
  const coreModules = data.coreModuleNavigationEnabled === true && data.selectedOrganization.moduleNavigationMode === "core" && !isFreelancer;
  const primaryPages = coreModules ? ["Overview", "People", "Time & attendance", "Payroll", "Approvals", "Reports", "More modules"] : workspacePrimaryPagesForRole(effectiveRole);
  const entityVisible = data.multiEntity?.enabled && !demoRole && !isFreelancer
    && data.access?.companyWide === true
    && ["owner", "admin", "bookkeeper", "hr", "group_hr"].includes(effectiveRole ?? "");
  const availablePages = useMemo(() => {
    const pages = tenantNavigationPages({ enabled: data.coreModuleNavigationEnabled === true, mode: data.selectedOrganization.moduleNavigationMode, enabledModules: data.selectedOrganization.enabledModules, isFreelancer, rolePages, companyWide: data.access?.companyWide, canManageModules: ["owner", "admin", "bookkeeper"].includes(effectiveRole ?? "") }, pilotFocusEnabled && !demoRole);
    // The server-derived selected-employer plan is a UI hint only.
    // All premium API endpoints independently re-check billing/authorization.
    if (data.advancedPlanningAllowed === false) {
      const index = pages.indexOf("Planning");
      if (index >= 0) pages.splice(index, 1);
    }
    if (entityVisible && !pages.includes("Entities")) pages.push("Entities");
    return pages;
  }, [data.access?.companyWide, data.coreModuleNavigationEnabled, data.selectedOrganization.moduleNavigationMode, data.selectedOrganization.enabledModules, effectiveRole, isFreelancer, rolePages, pilotFocusEnabled, demoRole, entityVisible, data.advancedPlanningAllowed]);

  // Only surface existing HR modules that this role, plan and pilot menu permit.
  const hrisShortcuts = useMemo(
    () => hrisHomeShortcutsForRole(effectiveRole, availablePages),
    [effectiveRole, availablePages],
  );

  const notifications = useMemo(
    () => buildNotifications(data, effectiveRole).filter((item) => !item.page || availablePages.includes(item.page)),
    [data, effectiveRole, availablePages],
  );

  const allowClientSwitch = !demoRole;
  const canManagePayroll = roleCanManagePayroll(effectiveRole);
  const canManagePeople = roleCanManagePeople(effectiveRole);
  const canManageTime = roleCanManageTime(effectiveRole);
  const canDecideApprovals = roleCanDecideApprovals(effectiveRole);
  const canManageDelegations = roleCanManageDelegations(effectiveRole);
  // Remount role/tenant-sensitive payroll-adjacent panels on employer, actor
  // or permissions changes so old records and draft inputs cannot render even
  // for a single paint before their next async read resolves.
  const sourceBoundModuleKey = [
    data.user?.id, data.selectedOrganization.id, effectiveRole,
    data.access?.companyWide, data.access?.orgUnitName,
  ].join(":");
  const canManageDeliveryOutbox = effectiveRole === "owner" || effectiveRole === "admin";
  const canUsePayrollOps = canManagePayroll && availablePages.includes("Payroll");
  const employerSetupDestination = payrollEmployerSetupDestination({
    role: effectiveRole, companyWide: data.access?.companyWide === true,
    demo: Boolean(demoRole), multiEntity: data.multiEntity?.enabled === true, pages: availablePages,
  });
  const canUsePeopleOps = canManagePeople && availablePages.includes("People");

  function openHrEmployee(employeeId: number) {
    // The dashboard can only focus a worker already present in the current
    // authorized employer snapshot; it cannot query or guess another worker.
    if (!canUsePeopleOps || !Number.isSafeInteger(employeeId) || employeeId <= 0 ||
        !data.employees.some((employee) => employee.id === employeeId)) return;
    setFocusEmployeeId(employeeId);
    setPage("People");
  }

  usePaletteShortcut(() => setPaletteOpen(true));

  /* ------------------------------------------------------------- data ops */

  function changeOrganization(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0 || id === data.selectedOrganization.id) return;
    // Always re-evaluate server-side access when changing employer.
    window.location.assign("/app?organizationId=" + id);
  }

  async function switchDemoRole(role: DemoRoleId) {
    setDemoSwitching(role);
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        notify("Role switch failed.", "err");
        return;
      }
      await response.json().catch(() => ({}));
      window.location.assign(demoRolePath(role));
    } catch {
      notify("Role switch failed.", "err");
    } finally {
      setDemoSwitching(null);
    }
  }

  async function decideTask(id: number, status: "Approved" | "Declined") {
    let confirmed: string | undefined;
    if (data.multiEntity?.enabled && status === "Approved") {
      const task = data.tasks.find(row => row.id === id);
      const linkedRunId = task?.payrollRunId
        ?? Number(/Payroll run #(\d+)/.exec(task?.detail ?? "")?.[1] ?? 0);
      const linkedRun = data.payrollRuns.find(run => run.id === linkedRunId);
      if (linkedRun) {
        const entity = data.multiEntity.entities.find(e => e.id === linkedRun.legalEntityId);
        if (!entity) { notify("Legal employer is not available for this approval.", "err"); return; }
        confirmed = window.prompt(`To approve this payroll, type the legal employer name exactly: ${entity.legalName}`) ?? "";
        if (confirmed.trim() !== entity.legalName.trim()) {
          notify("Entity name did not match; payroll approval was not sent.", "err");
          return;
        }
      }
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(confirmed === undefined ? {} : { confirmLegalEntityName: confirmed }) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // 403 here is the delegation gate doing its job, surface it verbatim.
        notify(payload.error ?? "That decision could not be saved.", "err");
        return;
      }
      await refresh();
      notify(
        payload.decidedOnBehalfOf
          ? `Approval ${status.toLowerCase()} on behalf of ${payload.decidedOnBehalfOf}, the delegation chain is in the audit trail.`
          : `Approval ${status.toLowerCase()} and recorded in the audit trail.`,
      );
    } catch {
      notify("Could not reach the approvals service.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function createPayroll(input: {
    periodStart: string;
    periodEnd: string;
    payDate: string;
    scopeOrgUnitId: number | null;
    legalEntityId: number;
    confirmLegalEntityName?: string;
  }) {
    setBusy(true);
    try {
      const response = await fetch("/api/payroll-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, organizationId: data.selectedOrganization.id, processNow: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "The payroll run could not be created.", "err");
        return;
      }
      await refresh();
      setNewPayrollOpen(false);
      setPage("Payroll");
      notify("Run created and queued through the chunked background worker.");
    } catch {
      notify("Could not reach the payroll service.", "err");
    } finally {
      setBusy(false);
    }
  }

  const processRun = useCallback(async (runId: number) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${runId}/process`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Payroll processing failed.", "err");
        return;
      }
      await refresh();
      notify("Calculation finished. The register, payslips and exception flags are up to date.");
    } catch {
      notify("Could not reach the payroll worker.", "err");
    } finally {
      setBusy(false);
    }
  }, [refresh, notify, setBusy]);

  async function releaseRun(
    runId: number,
    acknowledgeExceptions: boolean,
  ): Promise<{ receipt?: PayrollReleaseReceipt; error?: string }> {
    let confirmed: string | undefined;
    if (data.multiEntity?.enabled) {
      const target = data.payrollRuns.find(run => run.id === runId);
      const entity = data.multiEntity.entities.find(row => row.id === target?.legalEntityId);
      if (!entity) return { error: "Legal employer is missing from this payroll run." };
      confirmed = window.prompt(`To release this payroll, type the legal employer name exactly: ${entity.legalName}`) ?? "";
      if (confirmed.trim() !== entity.legalName.trim()) {
        return { error: "Entity name confirmation did not match; release cancelled." };
      }
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${runId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeExceptions, ...(confirmed === undefined ? {} : { confirmLegalEntityName: confirmed }) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = payload.error ?? "Release failed.";
        notify(error, "err");
        return { error };
      }
      await refresh();
      const emailDelivery = payload.emailDelivery as { sent?: number; queued?: number; failed?: number; missingEmail?: number } | undefined;
      const emailSummary = emailDelivery
        ? `${emailDelivery.sent ?? 0} sent, ${emailDelivery.queued ?? 0} queued, ${emailDelivery.failed ?? 0} failed`
        : `${payload.employeesNotified ?? 0} notice(s) recorded`;
      notify(
        `Payroll released. Payslip notices: ${emailSummary}${
          payload.webhookDeliveries ? `; ${payload.webhookDeliveries} webhook delivery attempt(s) logged` : ""
        }.`,
        emailDelivery?.failed ? "err" : "info",
      );
      return { receipt: payload.receipt as PayrollReleaseReceipt | undefined };
    } catch {
      const error = "Could not reach the release endpoint.";
      notify(error, "err");
      return { error };
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  /* ---------------------------------------------------------- palette ops */

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [];
    if (canUsePayrollOps) {
      actions.push({ id: "new-payroll", label: "New payroll run", hint: "Create and queue a run for this client", run: () => setNewPayrollOpen(true) });
      if (currentRun) {
        actions.push({
          id: "recalculate",
          label: `Re-calculate ${currentRun.periodLabel}`,
          hint: "Re-run the chunked queue for the live run",
          run: () => void processRun(currentRun.id),
        });
      }
    }
    if (canUsePeopleOps) {
      actions.push({ id: "new-hire", label: "Add employee", hint: "Create a record with its onboarding checklist", run: () => setNewHireOpen(true) });
      if (availablePages.includes("Migration")) {
        actions.push({ id: "migration", label: "Open migration center", hint: "Switch from another payroll or HRIS", run: () => setPage("Migration") });
      }
    }
    if (canManageTime && availablePages.includes("Time & attendance")) {
      actions.push({ id: "bundy", label: "Open web bundy", hint: "Record an attendance punch", run: () => setWebBundyOpen(true) });
    }
    if (canManageDeliveryOutbox && availablePages.includes("Exports")) {
      actions.push({ id: "outbox", label: "Email outbox", hint: "See what was queued and whether it was really sent", run: () => setOutboxOpen(true) });
    }
    if (availablePages.includes("Compliance")) {
      actions.push({ id: "gov", label: "Government validation status", hint: "Which agency outputs are still labelled DRAFT", run: () => setGovModalOpen(true) });
    }
    return actions;
  }, [availablePages, canManageDeliveryOutbox, canManageTime, canUsePayrollOps, canUsePeopleOps, currentRun, processRun, setNewPayrollOpen, setNewHireOpen, setPage, setWebBundyOpen, setOutboxOpen, setGovModalOpen]);

  /* --------------------------------------------------------------- render */

  // Do not keep showing previously authorized employee/payroll panels after a
  // session, employer-scope, or permissions read failure. Full reload rechecks RBAC.
  if (refreshIssue && (refreshIssue.kind === "session" ||
      refreshIssue.kind === "forbidden" || refreshIssue.kind === "scope")) {
    return (
      <main role="alert" className="mx-auto mt-16 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-slate-900">
        <h1 className="text-xl font-semibold">Workspace access needs to be checked</h1>
        <p className="mt-2 text-sm leading-6">{refreshIssue.message}</p>
        <a className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-emerald-900 px-4 py-2 font-semibold text-white"
          href={"/app?organizationId=" + data.selectedOrganization.id}>Reload the secure workspace</a>
      </main>
    );
  }

  return (
    <>
      <WorkspaceShell
        data={data}
        page={page}
        onPage={setPage}
        notifications={notifications}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenNotification={canManageDeliveryOutbox && availablePages.includes("Exports") ? () => setOutboxOpen(true) : undefined}
        onSwitchClient={(id) => void changeOrganization(id)}
        onSwitchRole={demoRole ? (role) => void switchDemoRole(role) : undefined}
        onSignOut={() => void signOut()}
        visiblePages={availablePages}
        primaryPages={primaryPages ?? undefined}
        workspaceRole={effectiveRole}
        displayRole={demoRole}
        allowClientSwitch={allowClientSwitch}
        headerExtras={
          <>
            {data.multiEntity?.enabled && <EntitySwitcher
              context={data.multiEntity} organizationId={data.selectedOrganization.id}
            />}
            {availablePages.includes("Compliance") && (
              <button className="topbar-link" onClick={() => setGovModalOpen(true)}>
                <ShieldCheck size={13} style={{ color: "var(--brand)" }} /> Gov status
              </button>
            )}
            {canManageTime && availablePages.includes("Time & attendance") && (
              <button className="topbar-link" onClick={() => setWebBundyOpen(true)}>
                <Clock size={13} style={{ color: "var(--brand)" }} /> Web bundy
              </button>
            )}
            {!demoRole && (
              <button
                className="topbar-link"
                onClick={() => setCheckoutPlan(data.plans.find((plan) => plan.name === "Scale") ?? data.plans[0] ?? null)}
              >
                <Sparkles size={13} style={{ color: "var(--brand)" }} /> Upgrade
              </button>
            )}
          </>
        }
      >
        {refreshLoading && (
          <p role="status" aria-live="polite" className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
            Refreshing this employer&apos;s workspace. The previous snapshot may still be visible.
          </p>
        )}
        {refreshIssue && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>{refreshIssue.message} This is not an empty employee or payroll result.</p>
            <button type="button" disabled={refreshLoading}
              onClick={() => { void refresh().catch(() => undefined); }}
              className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-amber-800 px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              Retry read-only workspace refresh
            </button>
          </div>
        )}
        {demoRole && demoInfo && page !== "Overview" && (
          <DemoSandboxBar
            role={demoRole}
            busyRole={demoSwitching}
            onSwitch={(role) => void switchDemoRole(role)}
            onTask={(_taskId, targetPage) => {
              if (availablePages.includes(targetPage)) setPage(targetPage);
            }}
          />
        )}

        {page === "Overview" && (
          <>
            {hrisShortcuts.length > 0 && (
              <HrisHomeShortcuts
                key={data.selectedOrganization.id}
                actions={hrisShortcuts}
                reviewTeamHref={reviewTeamHref}
                onPage={setPage}
                employees={canUsePeopleOps ? data.employees : []}
                provisioning={canUsePeopleOps ? data.provisioning : undefined}
                approvalTasks={data.tasks}
                onOpenEmployee={canUsePeopleOps ? openHrEmployee : undefined}
              />
            )}
            {dashboardRole ? (
              <RoleOverviewView
                data={data}
                currentRun={currentRun}
                role={dashboardRole}
                onNewRun={() => setNewPayrollOpen(true)}
                onPage={setPage}
                onFocusEmployee={openHrEmployee}
              />
            ) : (
              <OverviewView
                data={data}
                currentRun={currentRun}
                onNewRun={() => setNewPayrollOpen(true)}
                onPage={setPage}
                onDecide={(id, status) => void decideTask(id, status)}
              />
            )}
            {data.firstPayrollReadiness && (
              <FirstPayrollReadinessCard
                key={data.selectedOrganization.id}
                readiness={data.firstPayrollReadiness}
                inlineEnabled={inlineFirstPayrollEnabled}
                guided={isSelfServeCustomer}
                data={data}
                onRefresh={refresh}
                onDecide={decideTask}
                canDecide={canDecideApprovals}
                canManageDelegations={canManageDelegations}
                notify={notify}
                allowedPages={availablePages}
                onSettings={setSettingsInitialTab}
                onPage={setPage}
                onNewRun={() => setNewPayrollOpen(true)}
              />
            )}
            {!demoRole && effectiveRole === "owner" && (
              <ProductionPilotSignoffCard
                data={data}
                notify={notify}
                onRefresh={async () => {
                  await refresh();
                }}
              />
            )}
          </>
        )}

        {page === "Payroll" && data.multiEntity?.enabled && <EntityFilter context={data.multiEntity}
          organizationId={data.selectedOrganization.id} title="Payroll by entity" />}
        {page === "Payroll" && (
          <PayrollRunView
            key={data.firstPayrollConnectedEnabled ? `${data.selectedOrganization.id}:${focusedPayrollRunId ?? "default"}` : undefined}
            initialRunId={focusedPayrollRunId ?? undefined}
            data={data}
            availablePages={availablePages}
            busy={busy}
            onNewRun={() => setNewPayrollOpen(true)}
            onProcess={processRun}
            onRelease={releaseRun}
            onDecide={decideTask}
            onPage={setPage}
            onRefresh={async () => {
              await refresh();
            }}
            notify={notify}
          />
        )}

        {page === "People" && data.multiEntity?.enabled && <EntityFilter context={data.multiEntity}
          organizationId={data.selectedOrganization.id} title="People by entity" />}
        {page === "People" && (
          <PeopleView
            data={data}
            onRefresh={async () => {
              await refresh();
            }}
            onAddEmployee={() => setNewHireOpen(true)}
            onPage={setPage}
            canManage={canManagePeople}
            expandHcmInbox={searchParams.get("hcmPanel") === "bp"}
            focusEmployeeId={focusEmployeeId}
            onClearFocus={() => setFocusEmployeeId(null)}
          />
        )}

        {page === "Migration" && (
          <MigrationCenter
            organizationId={data.selectedOrganization.id}
            onImported={async () => {
              await refresh();
            }}
          />
        )}

        {page === "Planning" && <WorkforcePlanningPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} onPage={setPage} />}
        {page === "Compensation" && <CompensationPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} canViewPayrollEvidence={data.access?.companyWide === true && ["owner", "admin", "bookkeeper", "payroll", "checker"].includes(effectiveRole ?? "")} previewEnabled={optionalUiCapabilities.overpaymentPreview && ["owner", "admin", "checker"].includes(effectiveRole ?? "")} investigationEnabled={optionalUiCapabilities.overpaymentInvestigation} />}
        {page === "Workforce" && (
          <WorkforcePlanner
            key={[data.user?.id, data.selectedOrganization.id, data.access?.role, data.access?.companyWide, data.access?.orgUnitName].join(":")}
            data={data}
            notify={notify}
            canManage={canManageTime}
            onOpenAttendance={() => setPage("Time & attendance")}
          />
        )}

        {page === "Time & attendance" && data.multiEntity?.enabled && <EntityFilter context={data.multiEntity}
          organizationId={data.selectedOrganization.id} title="Time by entity" />}
        {page === "Time & attendance" && workflowUi.faceOfflinePunch && !data.multiEntity?.enabled && !demoRole && data.access?.companyWide === true && ["owner","admin","hr"].includes(effectiveRole ?? "") && <OfflinePunchReviewQueue organizationId={data.selectedOrganization.id} />}
        {page === "Time & attendance" && (
          <TimeView
            data={data}
            onOpenBundy={() => setWebBundyOpen(true)}
            notify={notify}
            canManage={canManageTime}
          />
        )}

        {page === "Leave" && (
          <LeavePage
            data={data}
            setNotice={noticeAdapter}
            readFailed={refreshIssue !== null}
            readLoading={refreshLoading}
            onRefresh={async () => {
              await refresh();
            }}
          />
        )}

        {page === "Approvals" && (
          <ApprovalsView
            data={data}
            busy={busy}
            canDecide={canDecideApprovals}
            canManageDelegations={canManageDelegations}
            onDecide={decideTask}
            onRefresh={async () => {
              await refresh();
            }}
            notify={notify}
          />
        )}

        {page === "More modules" && availablePages.includes("More modules") && <MoreModules key={data.selectedOrganization.id} organizationId={data.selectedOrganization.id} enabledModules={data.selectedOrganization.enabledModules ?? []} onRefresh={async () => { await refresh(); }} notify={notify} />}
        {page === "Reports" && data.multiEntity?.enabled && <EntityFilter context={data.multiEntity} organizationId={data.selectedOrganization.id} title="Reports by entity" />}
        {page === "Reports" && availablePages.includes("Reports") && <CoreReports
          analytics={(!rolePages || rolePages.includes("Analytics")) ? <AnalyticsView data={data} notify={notify} tenantReportBuilderEnabled={optionalUiCapabilities.tenantReportBuilder} /> : undefined}
          exports={(!rolePages || rolePages.includes("Exports")) ? <ExportsView data={data} notify={notify} onRefresh={async () => { await refresh(); }} /> : undefined}
        />}

        {page === "Analytics" && data.multiEntity?.enabled && <EntityFilter context={data.multiEntity}
          organizationId={data.selectedOrganization.id} title="Reports by entity" />}
        {page === "Analytics" && <AnalyticsView data={data} notify={notify} tenantReportBuilderEnabled={optionalUiCapabilities.tenantReportBuilder} />}
        {page === "Exports" && data.multiEntity?.enabled && <div style={{ marginBottom: 12 }}>
          <EntityBadge context={data.multiEntity} legalEntityId={data.multiEntity.legalEntityId}
            label={data.multiEntity.legalEntityId === null ? "All legal entities — select a payer for each export" : undefined} />
        </div>}
        {page === "Exports" && (
          <ExportsView
            data={data}
            notify={notify}
            onRefresh={async () => {
              await refresh();
            }}
          />
        )}

        {page === "Compliance" && (
          <CompliancePage data={data} setNotice={noticeAdapter} onOpenGovModal={() => setGovModalOpen(true)} />
        )}
        {page === "Loans" && <LoansPanel key={sourceBoundModuleKey} organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} canLoadEmployeeDirectory={roleCanManagePeople(effectiveRole)} canManageGovRemittance={data.access?.companyWide === true && ["owner", "admin", "bookkeeper", "payroll"].includes(effectiveRole ?? "")} />}
        {page === "Benefits" && <BenefitsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Documents" && <HcmDocumentsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "De minimis" && <DeMinimisPanel key={sourceBoundModuleKey} organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} canLoadEmployeeDirectory={roleCanManagePeople(effectiveRole)} />}
        {page === "Expenses" && <SpendOperationsPanel key={sourceBoundModuleKey} organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} canLoadEmployeeDirectory={roleCanManagePeople(effectiveRole)} />}
        {page === "Earned wage" && <EwaPanel key={sourceBoundModuleKey} organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} canLoadEmployeeDirectory={roleCanManagePeople(effectiveRole)} />}
        {page === "Recruitment" && (
          <>
            {availablePages.includes("Recruitment") &&
              ["owner", "admin", "hr"].includes(effectiveRole ?? "") && (
                <HrisOnboardingChecklist
                  key={data.selectedOrganization.id}
                  organizationId={data.selectedOrganization.id}
                  employees={data.employees}
                  provisioning={data.provisioning}
                  onRefresh={async () => { await refresh(data.selectedOrganization.id); }}
                  onOpenEmployee={openHrEmployee}
                  onAddEmployee={data.everydayHrHireEnabled === true && canUsePeopleOps && !demoRole ? () => setNewHireOpen(true) : undefined}
                  allowHirePayrollReview={allowHirePayrollReview && !demoRole}
                  onOpenDocuments={availablePages.includes("Documents") ? () => setPage("Documents") : undefined}
                />
              )}
            <RecruitmentPanel
              everydayHrHireEnabled={data.everydayHrHireEnabled}
              key={data.selectedOrganization.id}
              organizationId={data.selectedOrganization.id}
              setNotice={noticeAdapter}
              onHired={async () => { await refresh(data.selectedOrganization.id); }}
            />
          </>
        )}
        {page === "Performance" && <PerformancePanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Discipline" && <DisciplinePanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Separation" && <SeparationPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Contractors" && <ContractorsPanel organizationId={data.selectedOrganization.id} />}
        {page === "Assets" && <ItOperationsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Freelancer hub" && <FreelancerPage data={data} setNotice={noticeAdapter} />}

        {page === "Integrations" && <IntegrationsPage onOpenOutbox={canManageDeliveryOutbox ? () => setOutboxOpen(true) : undefined} />}
        {page === "Developer" && <DeveloperPage organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Automation" && <AutomationStudioPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Entities" && data.multiEntity?.enabled && <>
          <EntitySettingsView context={data.multiEntity} organizationId={data.selectedOrganization.id} />
          <EntityTransferInbox context={data.multiEntity} organizationId={data.selectedOrganization.id}
            onRefresh={async () => { await refresh(); }} />
        </>}
        {page === "Entities" && !data.multiEntity?.enabled && data.payrollEmployerSetupNavigationEnabled &&
          <EmployerSetupHelp entitiesPage onOpen={employerSetupDestination ? () => setPage(employerSetupDestination) : undefined} />}
        {page === "Enterprise" && (
          <>
            <LegalEntitiesPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />
            <PayoutProfilesPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />
            <EnterpriseControlsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />
          </>
        )}
        {page === "Readiness" && <LaunchReadinessPanel organizationId={data.selectedOrganization.id} />}
        {page === "Pricing" && <PricingPage plans={data.plans} onSelectPlan={(plan) => setCheckoutPlan(plan)} />}
        {page === "Audit trail" && <AuditPage events={data.auditEvents} organizationId={data.selectedOrganization.id} />}
        {page === "Settings" && <SettingsPage data={data} setNotice={noticeAdapter} initialTab={settingsInitialTab} />}
      </WorkspaceShell>

      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pages={availablePages}
        organizations={allowClientSwitch ? data.organizations : [data.selectedOrganization]}
        employees={data.employees}
        actions={paletteActions}
        onNavigate={setPage}
        onSwitchClient={(id) => void changeOrganization(id)}
        onOpenPerson={(employee) => {
          setFocusEmployeeId(employee.id);
          setPage("People");
        }}
      />

      {newPayrollOpen && (
        <NewPayrollModal
          key={data.payrollEmployerSetupNavigationEnabled ? sourceBoundModuleKey : undefined}
          organizationId={data.selectedOrganization.id}
          onClose={() => setNewPayrollOpen(false)}
          onCreate={createPayroll}
          busy={busy}
          orgUnits={data.orgUnits ?? []}
          multiEntity={data.multiEntity}
          employerSetupNavigationEnabled={data.payrollEmployerSetupNavigationEnabled}
          onOpenEmployerSetup={employerSetupDestination ? () => {
            setNewPayrollOpen(false);
            setPage(employerSetupDestination);
          } : undefined}
        />
      )}
      {outboxOpen && canManageDeliveryOutbox && (
        <OutboxModal organizationId={data.selectedOrganization.id} onClose={() => setOutboxOpen(false)} setNotice={noticeAdapter} />
      )}
      {checkoutPlan && (
        <CheckoutModal
          organizationId={data.selectedOrganization.id}
          plan={checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onUpgraded={async () => {
            await refresh();
            notify(`Plan upgraded to ${checkoutPlan.name}. Entitlements follow the subscription row.`);
            setCheckoutPlan(null);
          }}
        />
      )}
      {govModalOpen && (
        <GovValidationModal organizationId={data.selectedOrganization.id} onClose={() => setGovModalOpen(false)} setNotice={noticeAdapter} />
      )}
      {newHireOpen && (
        <NewHireModal
          everydayHrHireEnabled={data.everydayHrHireEnabled}
          organizationId={data.selectedOrganization.id}
          multiEntity={data.multiEntity}
          onClose={() => setNewHireOpen(false)}
          onCreated={async () => {
            await refresh();
            notify("Employee created with an onboarding checklist.");
          }}
        />
      )}
      {webBundyOpen && (
        <WebBundyModal
          organizationId={data.selectedOrganization.id}
          employeeName={data.user?.name ?? "Signed-in user"}
          employees={data.employees}
          onClose={() => setWebBundyOpen(false)}
          onPunchSuccess={() => {
            void refresh();
            notify("Punch recorded. Payroll will derive hours from it on the next calculation.");
          }}
        />
      )}
    </>
  );
}


function normalizeDashboardRole(role: string | null | undefined): WorkspaceDashboardRole | null {
  if (role === "owner" || role === "hr" || role === "payroll" || role === "checker") return role;
  if (role === "admin" || role === "bookkeeper") return "bookkeeper";
  return null;
}
