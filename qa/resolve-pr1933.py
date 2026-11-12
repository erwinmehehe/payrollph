#!/usr/bin/env python3
"""Strict semantic fix for -X ours PR1933 merge into main f359902.
The parent and manifest invariants intentionally fail closed if inputs drift.
"""
import json
from pathlib import Path
import subprocess
P='0a56aeb2721b46ccaf7a160e05d3c5090dadd69f'
M='f359902ee3aa39079cebafaa1ba6573e646049da'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==P
assert subprocess.check_output(['git','rev-parse','MERGE_HEAD'],text=True).strip()==M

def swap(s,old,new):
 assert s.count(old)==1,(old,s.count(old))
 return s.replace(old,new,1)
def edit(file,changes):
 p=Path(file);s=p.read_text()
 for old,new in changes:s=swap(s,old,new)
 p.write_text(s)

closure='docs/engineering/tenant-isolation-closure-plan.md'
old='498 methods = 454 COVERED + 23 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 9 GAP'
new='498 methods = 456 COVERED + 23 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 7 GAP'
p=Path(closure);ct=p.read_text()
assert ct.count(old)==2,ct.count(old)
p.write_text(ct.replace(old,new))
edit(closure,[
 ('Latest 498 methods = 454 COVERED + 23 PUBLIC-BY-DESIGN + 12 TOKEN-ONLY + 9 GAP','Latest 498 methods = 456 COVERED + 23 PUBLIC-BY-DESIGN + 12 TOKEN-ONLY + 7 GAP'),
 ('**370 COVERED + 15 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 9 GAP = 406**','**372 COVERED + 15 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 7 GAP = 406**')])

inventory='docs/engineering/tenant-isolation-coverage-inventory.md'
edit(inventory,[
 ('498 methods = 454 COVERED + 23 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 9 GAP','498 methods = 456 COVERED + 23 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 7 GAP'),
 ('**RELEASE BLOCKER:** 9 API methods and 17 business-ID page entries','**RELEASE BLOCKER:** 7 API methods and 17 business-ID page entries'),
 ('**NOT ACCEPTED**: 9 method gaps and 17 page/action gaps remain.','**NOT ACCEPTED**: 7 method gaps and 17 page/action gaps remain.'),
 ('| coveredAfter | 454 |','| coveredAfter | 456 |'),
 ('| gap | 9 |','| gap | 7 |'),
 ('**Year-end GET and POST credit renewed (provisional, NOT ACCEPTED):** 457 COVERED / 23 PUBLIC-BY-DESIGN / 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY / 6 GAP.',
  '**Year-end GET and POST credit renewed (provisional, NOT ACCEPTED):** 456 COVERED / 23 PUBLIC-BY-DESIGN / 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY / 7 GAP (Worker 360 GET remains GAP).')])

path='scripts/qa/tenant-isolation-coverage-manifest.json'
p=Path(path);m=json.loads(p.read_text())
route='src/app/api/year-end/route.ts'
w='src/app/api/hcm/worker-360/route.ts'
assert [x['status'] for x in m['allApiRouteFiles'][route]['methods']]==['COVERED','COVERED'],'Renewed year-end proof from main must be present'
assert m['allApiRouteFiles'][w]['methods'][0]['status']=='GAP','Worker 360 source hold must remain'
assert m['allApiRouteFiles'][w]['methods'][0]['testedBy'] is None
assert m['scopedPages'][16]['status']=='GAP'
assert m['metrics']['coveredAfter']==454 and m['metrics']['gap']==9
m['metrics']['coveredAfter']=456;m['metrics']['gap']=7
s=m['acceptanceStatus']
s=swap(s,'NOT ACCEPTED: 9 API methods and 17 page/action GAPs remain.','NOT ACCEPTED: 7 API methods and 17 page/action GAPs remain.')
s=swap(s,'GET and POST /api/year-end are held at zero credit because their annualization source moved (imported de minimis); a fresh exact-head PG16 proof on main renews them.',
         'GET and POST /api/year-end have renewed provisional source-matched fictional PG16 evidence on main (run 43178709246, job 131049135150); independent payroll/security review remains pending.')
s+=' Updated Worker 360 source-supersession and year-end renewal totals: 456 COVERED / 7 GAP, 17 page/action GAPs; zero new Worker 360 credits, no independent security or production acceptance.'
s+=' SOLO_VERIFIED_DEV_RECOVERY Studio POST credit: 456 COVERED / 7 GAP; complete current-source action cohort, no production acceptance.'
m['acceptanceStatus']=s
p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')

edit('tests/helpers/tenant-architectural-classification-delta.mjs',[
 ('import { isYearEndHeld, verifyYearEndHold } from "../../scripts/qa/tenant-year-end-credit.mjs";',
  'import { isYearEndHeld, verifyYearEndCredits, verifyYearEndHold } from "../../scripts/qa/tenant-year-end-credit.mjs";')])
assert Path('tests/helpers/tenant-architectural-classification-delta.mjs').read_text().count('export function yearEndRenewalDelta(')==1
for test in ['tests/tenant-billing-post-credit.test.mjs','tests/tenant-workspace-readiness-credit.test.mjs']:
 edit(test,[
  ("import { verifyArchitecturalRelabelDelta, yearEndHoldDelta } from './helpers/tenant-architectural-classification-delta.mjs';",
   "import { verifyArchitecturalRelabelDelta, yearEndHoldDelta, yearEndRenewalDelta } from './helpers/tenant-architectural-classification-delta.mjs';"),
  (('const yearEndHold = yearEndHoldDelta(base.manifest, m);' if 'billing-' in test else 'const yearEndHold=yearEndHoldDelta(base.manifest,m);'),
   ('const yearEndHold = yearEndHoldDelta(base.manifest, m) - yearEndRenewalDelta(base.manifest, m);' if 'billing-' in test else 'const yearEndHold=yearEndHoldDelta(base.manifest,m)-yearEndRenewalDelta(base.manifest,m);'))])
assert m['metrics']['coveredAfter']+m['metrics']['gap']+m['metrics']['publicByDesign']+m['metrics']['privilegedOperationsTokenOnly']==m['metrics']['methods']==498
print('PR1933 verified conflict synthesis: 456 covered/7 API gaps; 17 page gaps; no Worker 360 credit; renewed year-end source-proof retained')
