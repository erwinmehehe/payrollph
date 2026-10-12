"use client";
export type QueuedWebPunch={id:string;organizationId:number;employeeId:number;actionType:string;deviceOccurredAt:string;deviceId:string;createdAt:string};
const DB_NAME="payrollph-wfm-punch-queue-v1", STORE="punches", INSTALLATION="installation";
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined")return reject(Error("Offline storage unavailable on this device."));
    const request=indexedDB.open(DB_NAME,2);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"});
      if(!db.objectStoreNames.contains(INSTALLATION))db.createObjectStore(INSTALLATION);
    };
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
/** Random browser-installation pseudonym, not a hardware/device fingerprint.
 * Never stored in localStorage/sessionStorage/cookies or sent in telemetry.
 * Its server HMAC is purpose/tenant-scoped; shared-device signals are warnings.
 * IndexedDB's readwrite transaction also prevents different tabs racing to
 * create different IDs for the same browser installation.
 */
export async function installationPunchDeviceId():Promise<string>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(INSTALLATION,"readwrite");
    const store=transaction.objectStore(INSTALLATION);
    let identifier:string|null=null;
    let settled=false;
    const fail=(reason:unknown)=>{
      if(settled)return;
      settled=true;
      db.close();
      reject(reason instanceof Error?reason:Error("Device installation storage unavailable."));
    };
    transaction.oncomplete=()=>{
      if(settled)return;
      settled=true;db.close();
      if(identifier)resolve(identifier);
      else reject(Error("No device installation identifier was saved."));
    };
    transaction.onabort=()=>fail(transaction.error);
    transaction.onerror=()=>fail(transaction.error);
    const get=store.get("id");
    get.onsuccess=()=>{
      const existing=get.result;
      if(typeof existing==="string"&&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
        identifier=existing;
      } else {
        identifier=crypto.randomUUID();
        store.put(identifier,"id");
      }
    };
    get.onerror=()=>fail(get.error);
  });
}
export async function queueWebPunch(punch:QueuedWebPunch) {await withObjectStore("readwrite",store=>store.put(punch));}
export async function pendingWebPunches(org:number,employee:number):Promise<QueuedWebPunch[]> {
  const all=await withObjectStore<QueuedWebPunch[]>("readonly",store=>store.getAll());
  return all.filter(p=>p.organizationId===org&&p.employeeId===employee).sort((a,b)=>a.deviceOccurredAt.localeCompare(b.deviceOccurredAt));
}
export async function deleteQueuedPunch(id:string){await withObjectStore("readwrite",store=>store.delete(id));}
/**
 * A 2xx response is not a durable punch receipt. Auth redirects, proxy HTML,
 * malformed JSON, or another punch's receipt must NEVER empty IndexedDB.
 * The server echoes the opaque client UUID (no personal information).
 */
export type PunchReceipt = {
  ok: true; id: number; status: "pending" | "approved" | "rejected";
  clientPunchId: string;
};
export function isPunchReceipt(value: unknown, clientPunchId: string): value is PunchReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return receipt.ok === true
    && receipt.clientPunchId === clientPunchId
    && typeof receipt.id === "number"
    && Number.isSafeInteger(receipt.id) && receipt.id > 0
    && (receipt.status === "pending" || receipt.status === "approved" || receipt.status === "rejected");
}
export type PunchSyncResult = {id:string;status:"synced"|"failed";message:string};

/** Coalesce an automatic reconnect and a manual sync for this one employee. */
const runningSyncs = new Map<string, Promise<PunchSyncResult[]>>();
async function performQueuedPunchSync(organizationId:number,employeeId:number,signal?:AbortSignal):Promise<PunchSyncResult[]> {
  const results:PunchSyncResult[]=[];
  for(const item of await pendingWebPunches(organizationId,employeeId)){
    if(signal?.aborted)break;
    const body=new FormData();
    for(const [key,value] of Object.entries(item))if(key!=="id"||value) body.set(key==="id"?"clientPunchId":key,String(value));
    body.set("source","offline");
    try {
      const res=await fetch("/api/web-bundy/evidence",{method:"POST",body,signal});
      const response:unknown=await res.json().catch(()=>null);
      if(res.ok&&isPunchReceipt(response,item.id)) {
        // Delete only after a matching server-side, idempotent receipt.
        await deleteQueuedPunch(item.id);
        results.push({id:item.id,status:"synced",message:"Queued for human review"});
      } else {
        const error=response && typeof response==="object"
          ? (response as {error?:unknown}).error : null;
        results.push({id:item.id,status:"failed",message:typeof error==="string"
          ?error.slice(0,200):"No verified server receipt; saved punch was kept for retry."});
        // Never skip a rejected clock-in and send later clock-out actions out of order.
        break;
      }
    }catch{
      results.push({id:item.id,status:"failed",message:"Still offline or server unreachable; punch remains on device."});
      break;
    }
  }
  return results;
}
export function syncQueuedWebPunches(organizationId:number,employeeId:number,signal?:AbortSignal):Promise<PunchSyncResult[]> {
  const key=`${organizationId}:${employeeId}`;
  const running=runningSyncs.get(key);
  if(running)return running;
  const task=performQueuedPunchSync(organizationId,employeeId,signal);
  runningSyncs.set(key,task);
  void task.then(
    ()=>{if(runningSyncs.get(key)===task)runningSyncs.delete(key);},
    ()=>{if(runningSyncs.get(key)===task)runningSyncs.delete(key);},
  );
  return task;
}

export function offlineQueueSupported(){return typeof indexedDB!=="undefined";}
