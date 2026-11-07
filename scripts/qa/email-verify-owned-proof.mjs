import assert from "node:assert/strict";

export function assertOwnedEmailVerification(actual, expected) {
  const {account,worker,token,session}=actual;
  assert.equal(account.id,expected.userId,"accepts another employer's data: account");
  assert.equal(worker.id,expected.workerId,"accepts another employer's data: worker");
  assert.equal(worker.organizationId,expected.organizationId,"accepts another employer's data: employer");
  assert.equal(account.email,expected.email,"own login email must persist");
  assert.equal(worker.email,expected.email,"own worker email must persist");
  assert.equal(token.userId,expected.userId,"token belongs to the same account");
  assert.equal(token.id,expected.tokenId,"exact single-use token");
  assert.ok(token.usedAt instanceof Date && Number.isFinite(token.usedAt.getTime()),"token must be consumed");
  assert.equal(session.userId,expected.userId,"session belongs to the same account");
  assert.equal(session.id,expected.sessionId,"exact owned session");
  assert.ok(session.revokedAt instanceof Date && Number.isFinite(session.revokedAt.getTime()),"session must be revoked");
}
