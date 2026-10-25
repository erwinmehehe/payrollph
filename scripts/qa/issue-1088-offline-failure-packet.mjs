#!/usr/bin/env node
/** Operator-only, offline first step of #1088. No model, API, git, shell, or payroll access. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {CHECKS} from './exact-sha-triage.mjs';

const shaPattern=/^[0-9a-f]{40}$/;
const testPattern=/^tests\/[a-z0-9][a-z0-9._-]*\.test\.(mjs|ts)$/;
const runPattern=/^https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/[1-9][0-9]{0,14}$/;
const errorCodes={
 ASSERTION_MISMATCH:'test-failure-suspected',
 HTTP_STATUS_MISMATCH:'test-failure-suspected',
 DATABASE_FIXTURE_MISSING:'setup-failure-suspected',
 ENVIRONMENT_UNAVAILABLE:'setup-failure-suspected',
 SOURCE_SCHEMA_MISMATCH:'cause-unverified',
 UNKNOWN:'cause-unverified'
};
const caseKeys=['sourceSha','workflow','runUrl','jobUrl','testPath','reproduction','errorCode','evidenceBoundary'];
const knownWorkflows=new Set(CHECKS.map(([name])=>name));

function exactKeys(value,allowed) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==allowed.length||
   Object.keys(value).some(key=>!allowed.includes(key)))throw Error('Invalid sanitized input fields');
}

export function createOfflineFailurePacket(triage,selection) {
 exactKeys(selection,caseKeys);
 if(!triage||triage.schema!=='payrollph-qa-triage-v1'||!shaPattern.test(triage.sourceSha||'')||
   !Array.isArray(triage.entries))throw Error('Invalid exact-SHA triage report');
 if(selection.sourceSha!==triage.sourceSha)throw Error('Stale or mismatched SHA');
 if(selection.evidenceBoundary!=='fictional-only-sanitized')throw Error('Unapproved evidence boundary');
 if(!knownWorkflows.has(selection.workflow))throw Error('Unrecognized exact-SHA workflow');
 if(typeof selection.testPath!=='string'||!testPattern.test(selection.testPath)||selection.testPath.includes('..'))
   throw Error('Test path not allowlisted');
 const expectedReproduction=(selection.testPath.endsWith('.mjs')?'node --test ':'npx --no-install tsx --test ')+selection.testPath;
 if(selection.reproduction!==expectedReproduction)throw Error('Reproduction must be exact allowlisted command');
 if(!Object.hasOwn(errorCodes,selection.errorCode))throw Error('Unapproved error code');
 if(typeof selection.runUrl!=='string'||!runPattern.test(selection.runUrl)||
   typeof selection.jobUrl!=='string'||!selection.jobUrl.startsWith(selection.runUrl+'/job/')||
   !/^https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/[1-9][0-9]{0,14}\/job\/[1-9][0-9]{0,14}$/.test(selection.jobUrl))
   throw Error('Invalid run/job URL');
 const matched=triage.entries.filter(entry=>entry.name===selection.workflow&&entry.status==='FAILED'&&
   entry.runUrl===selection.runUrl&&entry.jobUrl===selection.jobUrl);
 if(matched.length!==1)throw Error('No matching exact-SHA failed job');
 return {
  schema:'payrollph-qa-failure-packet-v1',sourceSha:triage.sourceSha,
  workflow:selection.workflow,runUrl:selection.runUrl,jobUrl:selection.jobUrl,
  testPath:selection.testPath,reproduction:expectedReproduction,
  errorCode:selection.errorCode,hypothesis:errorCodes[selection.errorCode],
  rootCause:'UNVERIFIED',reproductionObserved:'NOT_RUN',humanAcceptance:'NOT_RUN_EXTERNAL',
  proposedPatch:'NONE',modelCalled:false,branchMutation:false,
  evidenceBoundary:'fictional-only-sanitized',releaseAuthorization:'NO_GO_NOT_EVALUATED'
 };
}

function main() {
 const args=process.argv.slice(2);
 if(args.length!==2)throw Error('Use two local JSON files');
 const triage=JSON.parse(readFileSync(args[0],'utf8'));
 const selection=JSON.parse(readFileSync(args[1],'utf8'));
 const packet=createOfflineFailurePacket(triage,selection);
 mkdirSync('qa-artifacts',{recursive:true});
 writeFileSync('qa-artifacts/qa-failure-packet.json',JSON.stringify(packet,null,2)+'\n',{mode:0o600});
 console.log('QA_FAILURE_PACKET_WRITTEN_OFFLINE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{main();}catch{console.error('QA_FAILURE_PACKET_REJECTED');process.exitCode=1;}
}
