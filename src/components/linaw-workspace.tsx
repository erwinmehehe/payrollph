"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clock, ShieldCheck, Sparkles } from "lucide-react";
import { AssetsPanel } from "@/components/assets-panel";
import { AutomationStudioPanel } from "@/components/automation-studio-panel";
import { BenefitsPanel } from "@/components/benefits-panel";
import { ContractorsPanel } from "@/components/contractors-panel";
import { CompensationPanel } from "@/components/compensation-panel";
import { HcmDocumentsPanel } from "@/components/hcm-documents-panel";
import { DeMinimisPanel } from "@/components/de-minimis-panel";
import { DemoSandboxBar } from "@/components/demo-sandbox-bar";
import { SaasOnboardingQuickstart } from "@/components/saas-onboarding-quickstart";
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
import { EwaPanel, ExpensesPanel } from "@/components/wallet-panel";
import { WebBundyModal } from "@/components/web-bundy-modal";
import { LaunchReadinessPanel } from "@/components/workspace/launch-readiness-panel";
import { AnalyticsView } from "@/components/workspace/analytics";
import { ApprovalsView } from "@/components/workspace/approvals";
import { CommandPalette, usePaletteShortcut, type PaletteAction } from "@/components/workspace/command-palette";
import { ExportsView } from "@/components/workspace/exports";
import { FirstPayrollReadinessCard } from "@/components/workspace/first-payroll-readiness";
import { ProductionPilotSignoffCard } from "@/components/workspace/production-pilot-signoff";
import { FREELANCER_HIDDEN, NAVIGATION } from "@/components/workspace/nav";
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
import { roleCanDecideApprovals, roleCanManageDelegations, roleCanManagePayroll, roleCanManagePeople, roleCanManageTime, workspacePagesForRole, workspacePrimaryPagesForRole } from "@/lib/workspace-role-ui";

export function LinawWorkspace({ initialData, isSelfServeCustomer = false }: { initialData: DashboardData; isSelfServeCustomer?: boolean }) {
  const searchParams = useSearchParams();
  const requestedDemoRole = searchParams.get("demoRole");
  const demoRole: DemoRoleId | null =
    requestedDemoRole &&
    isDemoRole(requestedDemoRole) &&
    initialData.user?.role === requestedDemoRole
      ? requestedDemoRole
      : null;
  const demoInfo = demoRoleInfo(demoRole);
  const initialPage = demoInfo?.landingPage ?? "Overview";
  const dashboardRole = normalizeDashboardRole(demoRole ?? initialData.access?.role ?? initialData.user?.role);

  const [data, setData] = useState(initialData);
  const [page, setPage] = useState(initialPage);
  const [busy, setBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"organization" | "team">("organization");
  const [focusEmployeeId, setFocusEmployeeId] = useState<number | null>(null);

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
  const primaryPages = workspacePrimaryPagesForRole(effectiveRole);
  const availablePages = useMemo(
    () =>
      NAVIGATION.flatMap((group) => group.items)
        .map((item) => item.name)
        .filter((name) => !(isFreelancer && FREELANCER_HIDDEN.has(name)))
        .filter((name) => !rolePages || rolePages.includes(name)),
    [isFreelancer, rolePages],
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
    [data.selectedOrganization.id],
  );


  async function changeOrganization(id: number) {
    try {
      await refresh(id);
      setPage("Overview");
      notify("Switched client. Every query is re-scoped server-side to that workspace.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not switch client.", "err");
    }
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
  }, [refresh, notify]);

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
  }, [availablePages, canManageDeliveryOutbox, canManageTime, canUsePayrollOps, canUsePeopleOps, currentRun, processRun]);

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
            {isSelfServeCustomer && data.payrollRuns.length === 0 && (
              <SaasOnboardingQuickstart
                companyName={data.selectedOrganization.name}
                employees={data.employees.length}
                runs={data.payrollRuns.length}
                onPage={setPage}
                onAddEmployee={() => setNewHireOpen(true)}
              />
            )}
            {dashboardRole ? (
              <RoleOverviewView
                data={data}
                currentRun={currentRun}
                role={dashboardRole}
                onNewRun={() => setNewPayrollOpen(true)}
                onPage={setPage}
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
                onPage={(targetPage) => {
                  if (targetPage === "Settings") setSettingsInitialTab("team");
                  setPage(targetPage);
                }}
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
        {page === "Expenses" && <ExpensesPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Earned wage" && <EwaPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Recruitment" && <RecruitmentPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Performance" && <PerformancePanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Discipline" && <DisciplinePanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Separation" && <SeparationPanel organizationId={data.selectedOrganization.id} setNotice={noticeAdapter} />}
        {page === "Contractors" && <ContractorsPanel organizationId={data.selectedOrganization.id} />}
        {page === "Assets" && <AssetsPanel organizationId={data.selectedOrganization.id} />}
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
