import assert from "node:assert/strict";
import test from "node:test";
import {setImmediate} from "node:timers";
import {queueWebPunch,type QueuedWebPunch} from "../src/lib/workforce-punch-offline-queue";

type Callback=(()=>void)|null;
const example:QueuedWebPunch={
  id:"00000000-0000-4000-8000-000000000001",
  organizationId:10,employeeId:7,actionType:"clock_in",
  deviceOccurredAt:"2026-10-12T01:00:00.000Z",
  deviceId:"00000000-0000-4000-8000-000000000002",
  createdAt:"2026-10-12T01:00:00.000Z",
};
function syntheticIndexedDB() {
  const prior=Object.getOwnPropertyDescriptor(globalThis,"indexedDB");
  const request:{result:unknown;error:Error|null;onsuccess:Callback;onerror:Callback}={
    result:undefined,error:null,onsuccess:null,onerror:null,
  };
  let closes=0;
  const transaction:{
    error:Error|null;oncomplete:Callback;onabort:Callback;onerror:Callback;
    objectStore:()=>{put:(value:unknown)=>typeof request};
  }={
    error:null,oncomplete:null,onabort:null,onerror:null,
    objectStore:()=>({put:()=>request}),
  };
  const db={transaction:()=>transaction,close:()=>{closes++;}};
  const openRequest:{result:typeof db;onsuccess:Callback;onerror:Callback;error:Error|null}={
    result:db,onsuccess:null,onerror:null,error:null,
  };
  Object.defineProperty(globalThis,"indexedDB",{
    configurable:true,
    value:{open:()=>{queueMicrotask(()=>openRequest.onsuccess?.());return openRequest;}},
  });
  return {
    request,transaction,closes:()=>closes,
    restore:()=>{if(prior)Object.defineProperty(globalThis,"indexedDB",prior);
      else Reflect.deleteProperty(globalThis,"indexedDB");},
  };
}
async function tick(){await new Promise<void>(resolve=>setImmediate(resolve));}

test("offline queue only reports success after the IndexedDB transaction commits",async()=>{
  const fake=syntheticIndexedDB();
  try{
    let resolved=false;
    const promise=queueWebPunch(example).then(()=>{resolved=true;});
    await tick();
    fake.request.onsuccess?.();
    await tick();
    assert.equal(resolved,false,"individual request success is not a durable punch");
    assert.equal(fake.closes(),0,"database must remain open until commit");
    fake.transaction.oncomplete?.();
    await promise;
    assert.equal(resolved,true);
    assert.equal(fake.closes(),1);
  }finally{fake.restore();}
});

test("offline queue rejects an aborted transaction even after request success",async()=>{
  const fake=syntheticIndexedDB();
  try{
    const promise=queueWebPunch(example);
    const rejected=assert.rejects(promise,/Synthetic transaction aborted/);
    await tick();
    fake.request.onsuccess?.();
    fake.transaction.error=new Error("Synthetic transaction aborted");
    fake.transaction.onabort?.();
    await rejected;
    assert.equal(fake.closes(),1);
  }finally{fake.restore();}
});
