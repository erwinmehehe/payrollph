"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {normalizePunchSelfie} from "@/lib/workforce-punch-photo-client";
import {installationPunchDeviceId,queueWebPunch,pendingWebPunches,syncQueuedWebPunches,isPunchReceipt} from "@/lib/workforce-punch-offline-queue";
type Policy={geofenceRequired:boolean;photoMode:"off"|"optional"|"required";consent:"accepted"|"declined"|null;consentVersion:string;pending:{id:number}[]};
export function EnhancedPunchControls({organizationId,employeeId}:{organizationId:number;employeeId:number}){
  const [policy,setPolicy]=useState<Policy|null>(null);
  const [deviceId,setDeviceId]=useState<string|null>(null);
  const [photo,setPhoto]=useState<File|null>(null);
  const [preparingPhoto,setPreparingPhoto]=useState(false);
  const photoRequest=useRef(0);
  const [offline,setOffline]=useState(0);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const reload=useCallback(async()=>{
    const response=await fetch(`/api/web-bundy/evidence?organizationId=${organizationId}`,{cache:"no-store"});
    if(response.ok)setPolicy(await response.json() as Policy);
    const queued=await pendingWebPunches(organizationId,employeeId).catch(()=>[]);
    setOffline(queued.length);
  },[organizationId,employeeId]);
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        // Installation identity persists through component remount and account
        // switching, enabling tenant-scoped human shared-device warning signals.
        const stored=await installationPunchDeviceId();
        if(alive)setDeviceId(stored);
      }catch{
        // The attendance flow must remain available on browsers that disable
        // IndexedDB. A temporary ID simply cannot support shared-device history.
        if(alive){
          setDeviceId(crypto.randomUUID());
          setMessage("Browser storage is unavailable. Online punching remains available, but shared-device signals may be incomplete.");
        }
      }
      if(alive)await reload().catch(()=>undefined);
    })();
    return()=>{alive=false;};
  },[reload]);
  const sync=useCallback(async()=>{
    try {
      const outcome=await syncQueuedWebPunches(organizationId,employeeId);
      const failed=outcome.find(item=>item.status==="failed");
      if(failed)setMessage("Sync paused. Unconfirmed punches remain on this device. "+failed.message);
      else if(outcome.some(item=>item.status==="synced"))
        setMessage("Synced punches are pending independent reviewer approval.");
    }catch{
      setMessage("Saved punches could not be read. Nothing was confirmed or deleted.");
    }
    await reload().catch(()=>undefined);
  },[organizationId,employeeId,reload]);
  useEffect(()=>{
    const connected=()=>{void sync();};
    window.addEventListener("online",connected);
    return()=>window.removeEventListener("online",connected);
  },[sync]);
  async function choosePhoto(file:File|null){
    const request=++photoRequest.current;
    setPhoto(null);
    if(!file){setPreparingPhoto(false);return;}
    setPreparingPhoto(true);
    try{
      const jpeg=await normalizePunchSelfie(file);
      if(request===photoRequest.current){
        setPhoto(jpeg);
        setMessage("Selfie prepared locally as a JPEG under 512 KB. It is not saved offline.");
      }
    }catch(error){
      if(request===photoRequest.current){
        setMessage(error instanceof Error?error.message:"Could not prepare camera image.");
      }
    }finally{
      if(request===photoRequest.current)setPreparingPhoto(false);
    }
  }
  async function consent(choice:"accepted"|"declined"){
    if(choice==="declined"){
      photoRequest.current++;
      setPhoto(null);
      setPreparingPhoto(false);
    }
    const res=await fetch("/api/web-bundy/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId,choice})});
    if(!res.ok){setMessage("Unable to save consent. Please retry.");return;}
    await reload();
  }
  async function submit(actionType:string){
    if(!deviceId||busy||preparingPhoto)return;
    setBusy(true);setMessage("");
    const item={id:crypto.randomUUID(),organizationId,employeeId,deviceId,actionType,deviceOccurredAt:new Date().toISOString(),createdAt:new Date().toISOString()};
    try{
      if(!navigator.onLine){
        await queueWebPunch(item);
        setMessage("Saved on device only. Sync later; requires human review before payable attendance.");
      }else{
        const data=new FormData();
        data.set("organizationId",String(organizationId));data.set("clientPunchId",item.id);data.set("deviceId",deviceId);
        data.set("actionType",actionType);data.set("deviceOccurredAt",item.deviceOccurredAt);data.set("source","online");
        if (policy?.geofenceRequired && (actionType==="clock_in"||actionType==="clock_out")) {
          if (!navigator.geolocation) {setMessage("GPS is unavailable. Ask HR for reviewed attendance correction.");return;}
          let fix:{latitude:number;longitude:number;accuracyMeters:number;capturedAt:string};
          try {
            fix=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(
              p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,
                accuracyMeters:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()}),
              ()=>reject(Error("GPS was not approved.")),{enableHighAccuracy:true,maximumAge:0,timeout:15000}));
          }catch{setMessage("GPS could not be verified. Ask HR for a reviewed exception.");return;}
          data.set("geolocation",JSON.stringify(fix));
        }
        if(photo&&policy?.consent==="accepted"&&policy.photoMode!=="off")data.set("photo",photo);
        try{
          const res=await fetch("/api/web-bundy/evidence",{method:"POST",body:data});
          const result:unknown=await res.json().catch(()=>null);
          if(res.ok&&isPunchReceipt(result,item.id)){
            const receipt=result as {status:string;flags?:string[]};
            setMessage(receipt.status==="pending"
              ?"Submitted for human review."+(receipt.flags?.length?" Flags: "+receipt.flags.join(", "):"")
              :"Earlier submission confirmed ("+receipt.status+").");
            setPhoto(null);
          }else if(res.ok){
            // A proxy/login HTML or wrong response cannot prove the punch arrived.
            // Replay with the SAME UUID; server idempotency prevents duplication.
            await queueWebPunch(item);
            setMessage("Server confirmation missing. Saved on this device for retry without photo.");
          }else{
            const error=result&&typeof result==="object"?(result as {error?:unknown}).error:null;
            setMessage(typeof error==="string"?error:"Submission rejected. Ask HR if you cannot retry.");
          }
        }catch{
          await queueWebPunch(item);
          setMessage("Network interrupted. Saved on device for later sync (without photo).");
        }
      }
    }catch{setMessage("Offline storage unavailable. No punch was saved.");}
    finally{setBusy(false);await reload();}
  }
  return <section style={{border:"1px solid var(--border)",borderRadius:10,padding:14,display:"grid",gap:10}} aria-label="Review-first attendance">
    <h3>Review-first attendance</h3>
    <p>Every punch is staged until a separate workforce reviewer approves it. Photo evidence never automatically matches faces or deducts pay.</p>
    <p>Awaiting reviewer: {policy?.pending.length??"…"} · Saved offline on this device: {offline}</p>
    <p>This browser keeps a random installation identifier in IndexedDB for tenant-scoped shared-device warnings. It is not a hardware fingerprint. Unsent offline punch actions remain locally until confirmed as received, or until browser data is cleared. Sharing a device can expose locally queued attendance, so use a personal device when possible.</p>
    {policy&&policy.photoMode!=="off"&&policy.consent===null&&<div>
      <p>Optional selfie evidence is collected only to help authorized company attendance reviewers examine an identity or punch dispute. Encrypted photos are ordinarily purged after 90 days unless subject to an authorized legal hold; backups follow the employer&apos;s disclosed retention schedule. No automated face recognition, disciplinary decision, or pay deduction is made from a photo.</p>
      <p>You may decline without an automatic attendance or pay penalty, or withdraw consent later. Employees can request an HR attendance correction without a photo. Contact your employer&apos;s HR or Data Protection Officer about access, deletion and applicable privacy rights. Consent notice: {policy.consentVersion}.</p>
      <button type="button" className="secondary-button" onClick={()=>void consent("accepted")}>Consent to photo evidence</button>
      <button type="button" className="secondary-button" onClick={()=>void consent("declined")}>Decline photo evidence</button>
    </div>}
    {policy?.photoMode!=="off"&&policy?.consent==="accepted"&&<label>
      Selfie evidence ({policy?.photoMode})<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="user" disabled={busy||preparingPhoto} onChange={e=>{const file=e.currentTarget.files?.[0]??null;void choosePhoto(file);}}/>
      {preparingPhoto&&<span role="status">Preparing selfie on this device…</span>}
      {photo&&<span role="status"> Selfie ready ({Math.round(photo.size/1024)} KB).</span>}
    </label>}
    {policy?.consent==="accepted"&&<button type="button" className="secondary-button" disabled={busy}
      onClick={()=>{void consent("declined");}}>
      Withdraw optional selfie consent
    </button>}
    {policy?.consent==="declined"&&<p>Photo declined. You can submit an attendance entry for independent review.</p>}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
      {(["clock_in","break_start","break_end","clock_out"] as const).map(action=><button key={action} type="button" className="secondary-button" disabled={!policy||busy||preparingPhoto||!deviceId} onClick={()=>void submit(action)}>{action.replaceAll("_"," ").toUpperCase()}</button>)}
    </div>
    <button className="secondary-button" type="button" disabled={busy||!deviceId} onClick={()=>void sync()}>Sync saved offline punches</button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
