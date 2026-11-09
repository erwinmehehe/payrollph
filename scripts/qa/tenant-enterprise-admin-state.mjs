import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
/** Pure acceptance oracle: an audit-only change or another employer's result cannot pass. */
export function assertEnterpriseMutation(before,after,body,value,actorUserId){
 const org=body.organizationId;
 const rows=table=>(after[table]??[]).map(x=>x.row);
 const own=(table,id)=>{const row=rows(table).find(x=>x.organization_id===org&&x.id===id);assert.ok(row,'persisted own-employer row required: '+table);return row;};
 const business=snapshot=>Object.fromEntries(Object.entries(snapshot).filter(([name])=>!['audit_events','head','sessions'].includes(name)));
 assert.notDeepEqual(business(after),business(before),'business state must change, not just audit metadata');
 assert.equal(typeof org,'number');
 let row;
 switch(body.action){
  case 'save-security-policy':
   row=rows('organization_security_policies').find(x=>x.organization_id===org);assert.ok(row,'own policy required');
   for(const [column,input] of [['session_idle_minutes','sessionIdleMinutes'],['session_max_hours','sessionMaxHours'],['max_active_sessions','maxActiveSessions'],['require_mfa','requireMfa'],['sso_mode','ssoMode']])assert.equal(row[column],body[input],column);
   assert.equal(row.updated_by_user_id,actorUserId);break;
  case 'create-oidc-provider':
  case 'create-saml-provider':
   row=own('identity_providers',value.provider.id);assert.equal(row.enabled,false);assert.equal(row.created_by_user_id,actorUserId);
   if(body.action==='create-oidc-provider'){assert.equal(row.protocol,'oidc');assert.equal(row.issuer,body.issuer);assert.equal(row.client_id,body.clientId);assert.ok(row.client_secret_encrypted?.startsWith('enc:v1:'));assert.ok(!row.client_secret_encrypted.includes(body.clientSecret));}
   else{assert.equal(row.protocol,'saml');assert.equal(row.saml_entity_id,body.entityId);assert.equal(row.saml_sso_url,body.ssoUrl);assert.equal(row.saml_email_attribute,body.emailAttribute);assert.equal(value.runtimeReady,false);}
   {const domain=own('identity_domains',value.domain.id);assert.equal(domain.provider_id,row.id);assert.equal(domain.domain,body.domain);assert.equal(domain.verified,false);assert.equal(domain.verification_token_hash,createHash('sha256').update(value.dnsTxtRecord).digest('hex'));}break;
  case 'verify-domain':row=own('identity_domains',body.domainId);assert.equal(row.verified,true);assert.ok(row.verified_at);break;
  case 'set-provider-enabled':row=own('identity_providers',body.providerId);assert.equal(row.enabled,body.enabled);break;
  case 'create-scim-token':row=own('scim_tokens',value.id);assert.equal(row.name,body.name);assert.equal(row.created_by_user_id,actorUserId);assert.equal(row.token_hash,createHash('sha256').update(value.token).digest('hex'));assert.equal(row.revoked_at,null);break;
  case 'revoke-scim-token':row=own('scim_tokens',body.tokenId);assert.ok(row.revoked_at);break;
  case 'save-permission-set':row=own('permission_sets',body.id??value.id);assert.equal(row.name,body.name);assert.deepEqual(row.permissions,[...new Set(body.permissions)]);assert.equal(row.active,body.active??true);break;
  case 'link-membership-worker':row=own('user_organizations',body.membershipId);assert.equal(row.worker_employee_id,body.employeeId??null);break;
  case 'assign-permission-set':
   own('user_organizations',body.membershipId);
   row=rows('user_permission_assignments').find(x=>x.user_organization_id===body.membershipId);
   if(body.permissionSetId==null)assert.equal(row,undefined,'assignment must actually be removed');
   else{assert.ok(row);assert.equal(row.organization_id,org);assert.equal(row.permission_set_id,body.permissionSetId);assert.equal(row.dynamic_group_id,body.dynamicGroupId??null);assert.equal(row.assigned_by_user_id,actorUserId);if(body.dynamicGroupId!=null){const group=own('dynamic_worker_groups',body.dynamicGroupId);assert.equal(row.dynamic_group_version,group.version);}}break;
  case 'save-automation-rule':row=own('automation_rules',body.id??value.id);assert.equal(row.name,body.name);assert.equal(row.trigger,body.trigger);assert.deepEqual(row.conditions,body.conditions);assert.equal(row.actions.length,body.actions.length);for(let i=0;i<body.actions.length;i++){assert.equal(row.actions[i].type,body.actions[i].type);assert.equal(row.actions[i].title,body.actions[i].title);}break;
  case 'set-automation-active':row=own('automation_rules',body.ruleId);assert.equal(row.active,body.active);break;
  default:assert.fail('Unreviewed enterprise action cannot receive method credit');
 }
}
