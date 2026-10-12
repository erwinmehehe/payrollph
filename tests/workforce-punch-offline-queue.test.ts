import assert from "node:assert/strict";
import test from "node:test";
import {setImmediate} from "node:timers";
import {queueWebPunch,syncQueuedWebPunches,isPunchReceipt,type QueuedWebPunch} from "../src/lib/workforce-punch-offline-queue";

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

function syntheticSyncQueue(punches:QueuedWebPunch[]) {
  const priorDb=Object.getOwnPropertyDescriptor(globalThis,"indexedDB");
  const data=new Map(punches.map(punch=>[punch.id,punch]));
  type SimRequest<T>={result:T;error:Error|null;onsuccess:Callback;onerror:Callback};
  const db={
    transaction:()=>{
      const transaction:{oncomplete:Callback;onabort:Callback;onerror:Callback;error:Error|null;
        objectStore:()=>{getAll:()=>SimRequest<QueuedWebPunch[]>;delete:(id:string)=>SimRequest<undefined>}}={
        oncomplete:null,onabort:null,onerror:null,error:null,
        objectStore:()=>({
          getAll:()=>finish([...data.values()]),
          delete:(id:string)=>finish(undefined,()=>{data.delete(id);}),
        }),
      };
      function finish<T>(result:T,mutate?:()=>void):SimRequest<T> {
        const request:SimRequest<T>={result,error:null,onsuccess:null,onerror:null};
        queueMicrotask(()=>{
          mutate?.();
          request.onsuccess?.();
          queueMicrotask(()=>transaction.oncomplete?.());
        });
        return request;
      }
      return transaction;
    },
    close:()=>undefined,
  };
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{
    open:()=>{
      const request:{result:typeof db;onsuccess:Callback;onerror:Callback;error:Error|null}={
        result:db,onsuccess:null,onerror:null,error:null,
      };
      queueMicrotask(()=>request.onsuccess?.());
      return request;
    },
  }});
  return {
    ids:()=>[...data.keys()],
    restore:()=>{if(priorDb)Object.defineProperty(globalThis,"indexedDB",priorDb);
      else Reflect.deleteProperty(globalThis,"indexedDB");},
  };
}
test("verified receipt must match the client UUID, record id and known review status",()=>{
  const ok={ok:true,id:123,status:"pending",clientPunchId:example.id};
  assert.equal(isPunchReceipt(ok,example.id),true);
  for(const response of [
    {},{...ok,clientPunchId:"another-punch"},{...ok,id:0},
    {...ok,id:"123"},{...ok,status:"saved"},{...ok,ok:false},
    {redirected:true},null,
  ])assert.equal(isPunchReceipt(response,example.id),false,JSON.stringify(response));
});
test("a successful HTTP status without a matching receipt keeps the local punch",async()=>{
  const fixture=syntheticSyncQueue([example]);
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=(async()=>new Response(JSON.stringify({ok:true,id:25,status:"pending",clientPunchId:"wrong"}),{
      status:200,headers:{"Content-Type":"application/json"},
    })) as typeof fetch;
    const outcome=await syncQueuedWebPunches(example.organizationId,example.employeeId);
    assert.equal(outcome[0].status,"failed");
    assert.deepEqual(fixture.ids(),[example.id],"no deletion on 2xx mis-acknowledgment");
  }finally{globalThis.fetch=originalFetch;fixture.restore();}
});
test("a login HTML 200 must not erase offline punch evidence",async()=>{
  const fixture=syntheticSyncQueue([example]);
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=(async()=>new Response("<html>Sign in</html>",{status:200,headers:{"Content-Type":"text/html"}})) as typeof fetch;
    const outcome=await syncQueuedWebPunches(example.organizationId,example.employeeId);
    assert.equal(outcome[0].status,"failed");
    assert.deepEqual(fixture.ids(),[example.id]);
  }finally{globalThis.fetch=originalFetch;fixture.restore();}
});
test("valid idempotent receipt deletes exactly its acknowledged punch",async()=>{
  const fixture=syntheticSyncQueue([example]);
  const originalFetch=globalThis.fetch;
  try{
    let clientId="";
    globalThis.fetch=(async(_url,options)=>{
      const body=options?.body as FormData;
      clientId=String(body.get("clientPunchId"));
      return new Response(JSON.stringify({
        ok:true,id:49,status:"pending",clientPunchId:clientId,
      }),{status:202,headers:{"Content-Type":"application/json"}});
    }) as typeof fetch;
    const outcome=await syncQueuedWebPunches(example.organizationId,example.employeeId);
    assert.equal(clientId,example.id);
    assert.equal(outcome[0].status,"synced");
    assert.deepEqual(fixture.ids(),[]);
  }finally{globalThis.fetch=originalFetch;fixture.restore();}
});
test("a failed first replay pauses later offline actions and preserves both",async()=>{
  const second={...example,id:"00000000-0000-4000-8000-000000000003",
    actionType:"clock_out",deviceOccurredAt:"2026-10-12T02:00:00.000Z"};
  const fixture=syntheticSyncQueue([example,second]);
  const originalFetch=globalThis.fetch;
  try{
    let calls=0;
    globalThis.fetch=(async()=>{
      calls++;
      return new Response(JSON.stringify({error:"Temporarily unavailable."}),{
        status:503,headers:{"Content-Type":"application/json"},
      });
    }) as typeof fetch;
    const outcome=await syncQueuedWebPunches(example.organizationId,example.employeeId);
    assert.equal(calls,1);
    assert.equal(outcome[0].status,"failed");
    assert.deepEqual(fixture.ids(),[example.id,second.id]);
  }finally{globalThis.fetch=originalFetch;fixture.restore();}
});
test("automatic reconnect and manual sync share one in-flight replay",async()=>{
  const fixture=syntheticSyncQueue([example]);
  const originalFetch=globalThis.fetch;
  try{
    let calls=0;
    globalThis.fetch=(async(_url,options)=>{
      calls++;
      await new Promise<void>(resolve=>setImmediate(resolve));
      const body=options?.body as FormData;
      return new Response(JSON.stringify({
        ok:true,id:52,status:"pending",clientPunchId:body.get("clientPunchId"),
      }),{status:202,headers:{"Content-Type":"application/json"}});
    }) as typeof fetch;
    const a=syncQueuedWebPunches(example.organizationId,example.employeeId);
    const b=syncQueuedWebPunches(example.organizationId,example.employeeId);
    assert.strictEqual(a,b);
    const [first,second]=await Promise.all([a,b]);
    assert.deepEqual(first,second);
    assert.equal(calls,1);
    assert.deepEqual(fixture.ids(),[]);
  }finally{globalThis.fetch=originalFetch;fixture.restore();}
});
