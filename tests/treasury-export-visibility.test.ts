import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseTreasuryExportStatus,
  treasuryExportPermissions,
  treasuryExportScope,
  visibleTreasuryExportStatus,
  type ScopedTreasuryExportStatus,
} from "../src/lib/treasury-export-visibility";

const scope = (organizationId: number, userId: number, role = "owner") =>
  treasuryExportScope({ organizationId, userId, role, companyWide: true });

test("treasury status denies the previous employer, user, role and access scope", () => {
  const approved: ScopedTreasuryExportStatus = {
    scope: scope(11, 10),
    status: { enabled: true, assigned: true },
  };

  assert.deepEqual(visibleTreasuryExportStatus(scope(11, 10), true, approved), approved.status);
  for (const other of [
    scope(12, 10),
    scope(11, 99),
    scope(11, 10, "payroll"),
    treasuryExportScope({ organizationId: 11, userId: 10, role: "owner", companyWide: false }),
  ]) {
    assert.equal(visibleTreasuryExportStatus(other, true, approved), null, "stale approval must not render");
    assert.deepEqual(treasuryExportPermissions("owner", visibleTreasuryExportStatus(other, true, approved)), {
      canRecordManualPayout: false,
      canGenerateLiveBankFile: false,
    });
  }
  assert.equal(visibleTreasuryExportStatus(scope(11, 10), true, null), null);
  assert.deepEqual(visibleTreasuryExportStatus(scope(11, 10), false, approved), {
    enabled: false,
    assigned: false,
  });
});

test("unverified, malformed and legacy-looking responses never grant treasury UI controls", () => {
  for (const payload of [
    null, {}, { policy: {} }, { policy: { enabled: "false" }, currentUserAssigned: true },
    { policy: { enabled: true }, currentUserAssigned: 1 },
    { policy: { enabled: null }, currentUserAssigned: true },
    [], { policy: [], currentUserAssigned: true },
  ]) {
    assert.equal(parseTreasuryExportStatus(payload), null);
  }
  assert.deepEqual(parseTreasuryExportStatus({ policy: { enabled: true }, currentUserAssigned: false }), {
    enabled: true, assigned: false,
  });
  assert.deepEqual(parseTreasuryExportStatus({ policy: { enabled: false }, currentUserAssigned: false }), {
    enabled: false, assigned: false,
  });
});

test("unresolved status fails closed even for owners and payroll operators", () => {
  for (const role of ["owner", "admin", "bookkeeper", "payroll", "manager", null]) {
    assert.deepEqual(treasuryExportPermissions(role, null), {
      canRecordManualPayout: false,
      canGenerateLiveBankFile: false,
    });
  }
});

test("confirmed disabled policy retains legacy role grants while enabled policy requires assignment", () => {
  const disabled = { enabled: false, assigned: false };
  assert.deepEqual(treasuryExportPermissions("owner", disabled), {
    canRecordManualPayout: true,
    canGenerateLiveBankFile: true,
  });
  for (const role of ["admin", "bookkeeper", "payroll"]) {
    assert.deepEqual(treasuryExportPermissions(role, disabled), {
      canRecordManualPayout: false,
      canGenerateLiveBankFile: true,
    });
  }
  assert.deepEqual(treasuryExportPermissions("manager", disabled), {
    canRecordManualPayout: false,
    canGenerateLiveBankFile: false,
  });

  for (const role of ["owner", "admin", "bookkeeper", "payroll"]) {
    assert.deepEqual(treasuryExportPermissions(role, { enabled: true, assigned: false }), {
      canRecordManualPayout: false,
      canGenerateLiveBankFile: false,
    });
    assert.deepEqual(treasuryExportPermissions(role, { enabled: true, assigned: true }), {
      canRecordManualPayout: true,
      canGenerateLiveBankFile: true,
    });
  }
});

test("exports reads current-user treasury controls with abort and scoped callback guards", () => {
  const source = readFileSync("src/components/workspace/exports.tsx", "utf8");
  assert.match(source, /treasuryExportScope\(/);
  assert.match(source, /visibleTreasuryExportStatus\(/);
  assert.match(source, /treasuryExportPermissions\(/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /active = false; controller\.abort\(\)/);
  assert.match(source, /if \(active && status\) setTreasuryObservation\(\{ scope: treasuryScope, status \}\)/);
  assert.doesNotMatch(source, /setTreasuryStatus\(\{ enabled: false, assigned: false \}\)/);
});
