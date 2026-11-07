import assert from 'node:assert/strict';
export function assertOwnedSlaResult({cases,events,emails},subject){
  const own=cases.find(row=>row.id===subject.caseId);
  assert.equal(own?.organization_id,subject.orgId,"accepts another employer's data: case");
  assert.equal(own.escalation_level,1);assert.ok(own.escalated_at);
  assert.equal(events.length,1);assert.equal(emails.length,1);
  assert.equal(events[0].organization_id,subject.orgId,"accepts another employer's data: event");
  assert.equal(events[0].case_id,subject.caseId,"accepts another employer's data: event case");
  assert.equal(events[0].event_type,'sla_escalated');
  assert.equal(emails[0].organization_id,subject.orgId,"accepts another employer's data: outbox");
  assert.equal(emails[0].recipient,subject.email,"accepts another employer's data: recipient");
  assert.ok(emails[0].dedupe_key.startsWith('hcm-sla:'+subject.orgId+':'+subject.caseId+':'));
}
