import assert from "node:assert/strict";
import test from "node:test";
import { approvalSourceLinksOwned } from "../src/lib/approval-source-tenant-boundary";

test("approval reverse links cannot cross employers or ambiguously advance two sources", () => {
  assert.equal(approvalSourceLinksOwned(7, [], []), true);
  assert.equal(approvalSourceLinksOwned(7, [{ organizationId: 7, instanceOrganizationId: 7 }], [{ organizationId: 7 }]), true);
  for (const rows of [
    [{ organizationId: 19, instanceOrganizationId: 19 }],
    [{ organizationId: 7, instanceOrganizationId: 19 }],
    [{ organizationId: 7, instanceOrganizationId: null }],
    [{ organizationId: 7, instanceOrganizationId: 7 }, { organizationId: 7, instanceOrganizationId: 7 }],
  ]) assert.equal(approvalSourceLinksOwned(7, rows, []), false);
  assert.equal(approvalSourceLinksOwned(7, [], [{ organizationId: 19 }]), false);
  assert.equal(approvalSourceLinksOwned(7, [], [{ organizationId: 7 }, { organizationId: 7 }]), false);
  for (const id of [0, -1, NaN, 1.5]) assert.equal(approvalSourceLinksOwned(id, [], []), false);
});
