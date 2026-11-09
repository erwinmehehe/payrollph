import assert from 'node:assert/strict';
export const ENTERPRISE_PROOF_MODE='fictional-disposable-pg16-only';
export const ENTERPRISE_OFF_FLAGS=['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED','PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','XENDIT_BILLING_ENABLED','XENDIT_PAYOUTS_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED'];
export function requireEnterpriseProofEnvironment(env=process.env){
 assert.equal(env.TENANT_ENTERPRISE_ADMIN_PROOF,ENTERPRISE_PROOF_MODE,'ENTERPRISE_PROOF_REFUSED: explicit fictional mode required');
 assert.equal(env.DATABASE_URL,'postgresql://postgres:postgres@127.0.0.1:5432/app_db','ENTERPRISE_PROOF_REFUSED: disposable loopback DB only');
 assert.equal(env.SECURITY_SMOKE_URL,'http://127.0.0.1:3000','ENTERPRISE_PROOF_REFUSED: loopback HTTP only');
 assert.equal(env.NODE_ENV,'production');assert.equal(env.DEMO_MODE,'false');assert.equal(env.REQUIRE_PRIVILEGED_MFA,'true');
 for(const flag of ENTERPRISE_OFF_FLAGS)assert.equal(env[flag],'false','ENTERPRISE_PROOF_REFUSED: '+flag+' must remain OFF');
 for(const name of ['RESEND_API_KEY','OPENAI_API_KEY','XENDIT_SECRET_KEY','PAYMONGO_SECRET_KEY','NEON_API_KEY'])assert.ok(!env[name],'ENTERPRISE_PROOF_REFUSED: external credential configured');
}
