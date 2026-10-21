/** Employer setup may only use an employer-scoped and complete legal entity list. */
export type FirstPayrollLegalEmployer = {
  id:number;organizationId:number;primaryEntity:boolean;active:boolean;
  legalName:string;payrollCalendarMode:string;
  birTin:string|null;sssEmployerNo:string|null;
  philHealthEmployerNo:string|null;pagIbigEmployerNo:string|null;
};
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const nilText=(v:unknown)=>v===null||typeof v==="string";
function entity(v:unknown,org:number):v is FirstPayrollLegalEmployer {
  return rec(v)&&id(v.id)&&v.organizationId===org&&
    typeof v.primaryEntity==="boolean"&&typeof v.active==="boolean"&&
    typeof v.legalName==="string"&&v.legalName.trim().length>0&&
    (v.payrollCalendarMode==="ph_semi_monthly"||v.payrollCalendarMode==="flexible")&&
    nilText(v.birTin)&&nilText(v.sssEmployerNo)&&
    nilText(v.philHealthEmployerNo)&&nilText(v.pagIbigEmployerNo);
}
export function parseFirstPayrollLegalEmployerRead(body:unknown,organizationId:number):FirstPayrollLegalEmployer[] {
  if(!id(organizationId)||!rec(body)||body.organizationId!==organizationId||
    !Array.isArray(body.legalEntities)||body.legalEntities.length>1000||
    !body.legalEntities.every((row:unknown)=>entity(row,organizationId))) {
    throw Error("Legal employer data unavailable or not verified for this employer.");
  }
  const rows:FirstPayrollLegalEmployer[]=body.legalEntities;
  if(new Set(rows.map(row=>row.id)).size!==rows.length||
    rows.filter(row=>row.active&&row.primaryEntity).length>1) {
    throw Error("Legal employer data incomplete or inconsistent.");
  }
  return rows;
}
export async function readVerifiedFirstPayrollLegalEmployer(
  organizationId:number,fetcher:typeof fetch=fetch,signal?:AbortSignal,
):Promise<FirstPayrollLegalEmployer[]> {
  if(!id(organizationId))throw Error("Legal employer data unavailable.");
  const response=await fetcher("/api/legal-entities?organizationId="+organizationId,{cache:"no-store",signal});
  if(!response.ok)throw Error("Legal employer data unavailable.");
  let payload:unknown;
  try{payload=await response.json();}catch{throw Error("Legal employer data unreadable.");}
  return parseFirstPayrollLegalEmployerRead(payload,organizationId);
}
