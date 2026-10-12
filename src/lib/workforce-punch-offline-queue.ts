"use client";
export type QueuedWebPunch={id:string;organizationId:number;employeeId:number;actionType:string;deviceOccurredAt:string;deviceId:string;createdAt:string};
const DB_NAME="payrollph-wfm-punch-queue-v1", STORE="punches";
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined")return reject(Error("Offline storage unavailable on this device."));
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function withObjectStore<T>(mode:IDBTransactionMode, fn:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await database();
  return new Promise((resolve,reject)=> {
    let settled=false;
    const fail=(reason:unknown)=>{
      if(settled)return;
      settled=true;
      db.close();
      reject(reason instanceof Error?reason:new Error("Offline punch storage transaction failed."));
    };
    try{
      const transaction=db.transaction(STORE,mode);
      let requestResult:T;
      transaction.oncomplete=()=>{
        if(settled)return;
        settled=true;
        db.close();
        // A successful request is not durable until this transaction commits.
        resolve(requestResult);
      };
      transaction.onabort=()=>fail(transaction.error);
      transaction.onerror=()=>fail(transaction.error);
      const req=fn(transaction.objectStore(STORE));
      req.onsuccess=()=>{requestResult=req.result;};
      req.onerror=()=>fail(req.error);
    }catch(error){fail(error);}
  });
}
export async function queueWebPunch(punch:QueuedWebPunch) {await withObjectStore("readwrite",store=>store.put(punch));}
export async function pendingWebPunches(org:number,employee:number):Promise<QueuedWebPunch[]> {
  const all=await withObjectStore<QueuedWebPunch[]>("readonly",store=>store.getAll());
  return all.filter(p=>p.organizationId===org&&p.employeeId===employee).sort((a,b)=>a.deviceOccurredAt.localeCompare(b.deviceOccurredAt));
}
export async function deleteQueuedPunch(id:string){await withObjectStore("readwrite",store=>store.delete(id));}
export async function syncQueuedWebPunches(organizationId:number,employeeId:number, signal?:AbortSignal) {
  const results:{id:string;status:"synced"|"failed";message:string}[]=[];
  for(const item of await pendingWebPunches(organizationId,employeeId)){
    if(signal?.aborted)break;
    const body=new FormData();
    for(const [key,value] of Object.entries(item))if(key!=="id"||value) body.set(key==="id"?"clientPunchId":key,String(value));
    body.set("source","offline");
    try {
      const res=await fetch("/api/web-bundy/evidence",{method:"POST",body,signal});
      const response=await res.json().catch(()=>({}));
      if(res.ok) {
        await deleteQueuedPunch(item.id);
        results.push({id:item.id,status:"synced",message:"Queued for human review"});
      } else {
        results.push({id:item.id,status:"failed",message:typeof response.error==="string"?response.error:"Sync rejected"});
      }
    }catch{
      results.push({id:item.id,status:"failed",message:"Still offline or server unreachable"});
      break;
    }
  }
  return results;
}
export function offlineQueueSupported(){return typeof indexedDB!=="undefined";}
