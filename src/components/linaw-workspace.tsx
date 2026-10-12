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

export function LinawWorkspace({ initialData, isSelfServeCustomer = false, pilotFocusEnabled = false, allowPeopleFocus = false, allowHirePayrollReview = false, reviewTeamHref = null }: { initialData: DashboardData; isSelfServeCustomer?: boolean; pilotFocusEnabled?: boolean; allowPeopleFocus?: boolean; allowHirePayrollReview?: boolean; reviewTeamHref?: string | null }) {
  const searchParams = useSearchParams();
  const requestedDemoRole = searchParams.get("demoRole");
  const demoRole: DemoRoleId | null =
    requestedDemoRole &&
    isDemoRole(requestedDemoRole) &&
    initialData.user?.role === requestedDemoRole
      ? requestedDemoRole
      : null;
  const demoInfo = demoRoleInfo(demoRole);
  const requestedWorkspacePage = searchParams.get("workspacePage");
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
      ? "People" : linkedTeamWorkflowPage ?? linkedHirePayrollPage ?? "Overview");
  const dashboardRole = normalizeDashboardRole(demoRole ?? initialData.access?.role ?? initialData.user?.role);

  const [data, setData] = useState(initialData);
  const [page, setPage] = useState(initialPage);
  const [busy, setBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"organization" | "team">("organization");
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
  const availablePages = useMemo(() => {
    return tenantNavigationPages({ enabled: data.coreModuleNavigationEnabled === true, mode: data.selectedOrganization.moduleNavigationMode, enabledModules: data.selectedOrganization.enabledModules, isFreelancer, rolePages, companyWide: data.access?.companyWide, canManageModules: ["owner", "admin", "bookkeeper"].includes(effectiveRole ?? "") }, pilotFocusEnabled && !demoRole);
  }, [data.access?.companyWide, data.coreModuleNavigationEnabled, data.selectedOrganization.moduleNavigationMode, data.selectedOrganization.enabledModules, effectiveRole, isFreelancer, rolePages, pilotFocusEnabled, demoRole]);

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
  const canManageDeliveryOutbox = effectiveRole === "owner" || effectiveRole === "admin";
  const canUsePayrollOps = canManagePayroll && availablePages.includes("Payroll");
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

  useEffect(() => {
    if (page !== "Settings") setSettingsInitialTab("organization");
  }, [page]);

  /* ------------------------------------------------------------- data ops */

  const refresh = useCallback(
    async (organizationId = data.selectedOrganization.id) => {
      const response = await fetch(`/api/dashboard?organizationId=${organizationId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `The workspace could not be reloaded (${response.status}).`);
      }
      setData((await response.json()) as DashboardData);
    },
    [data.selectedOrganization.id, setData],
  );


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
    setBusy(true);
    try {
      const response = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
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
    setBusy(true);
    try {
      const response = await fetch(`/api/payroll-runs/${runId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeExceptions }),
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
                readiness={data.firstPayrollReadiness}
                guided={isSelfServeCustomer}
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

        {page === "Payroll" && (
          <PayrollRunView
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
        {page === "Compensation" && <CompensationPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Workforce" && (
          <WorkforcePlanner
            key={[data.user?.id, data.selectedOrganization.id, data.access?.role, data.access?.companyWide, data.access?.orgUnitName].join(":")}
            data={data}
            notify={notify}
            canManage={canManageTime}
            onOpenAttendance={() => setPage("Time & attendance")}
          />
        )}

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
        {page === "Reports" && availablePages.includes("Reports") && <CoreReports
          analytics={(!rolePages || rolePages.includes("Analytics")) ? <AnalyticsView data={data} notify={notify} /> : undefined}
          exports={(!rolePages || rolePages.includes("Exports")) ? <ExportsView data={data} notify={notify} onRefresh={async () => { await refresh(); }} /> : undefined}
        />}

        {page === "Analytics" && <AnalyticsView data={data} notify={notify} />}
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
        {page === "Loans" && <LoansPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Benefits" && <BenefitsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Documents" && <HcmDocumentsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "De minimis" && <DeMinimisPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Expenses" && <SpendOperationsPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Earned wage" && <EwaPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
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
                  allowHirePayrollReview={allowHirePayrollReview && !demoRole}
                  onOpenDocuments={availablePages.includes("Documents") ? () => setPage("Documents") : undefined}
                />
              )}
            <RecruitmentPanel
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
          organizationId={data.selectedOrganization.id}
          onClose={() => setNewPayrollOpen(false)}
          onCreate={createPayroll}
          busy={busy}
          orgUnits={data.orgUnits ?? []}
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
          organizationId={data.selectedOrganization.id}
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
