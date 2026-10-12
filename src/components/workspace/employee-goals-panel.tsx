"use client";
import { useCallback, useEffect, useState } from "react";
type Goal={
 id:number;employeeId:number;title:string;description:string;dueDate:string;
 status:string;reviewScore:number|null;reviewNotes:string|null;
};
export function EmployeeGoalsPanel({organizationId}:{organizationId:number}){
 const [goals,setGoals]=useState<Goal[]>([]);
 const [role,setRole]=useState("");
 const [employeeId,setEmployeeId]=useState("");
 const [title,setTitle]=useState("");
 const [description,setDescription]=useState("");
 const [dueDate,setDueDate]=useState("");
 const [scores,setScores]=useState<Record<number,number>>({});
 const [notes,setNotes]=useState<Record<number,string>>({});
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
   const response=await fetch(`/api/hcm/simple-goals?organizationId=${organizationId}`,{cache:"no-store"});
   if(!response.ok)throw Error("Goal reviews are unavailable.");
   const data=await response.json() as {goals:Goal[];viewerRole?:string};
   setGoals(data.goals);setRole(data.viewerRole??"");
 },[organizationId]);
 useEffect(()=>{let active=true;void refresh().catch(()=>{if(active)setMessage("Goal records unavailable.");});
   return()=>{active=false};},[refresh]);
 async function act(fields:Record<string,unknown>){
   setBusy(true);setMessage("");
   try{
     const response=await fetch("/api/hcm/simple-goals",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({organizationId,...fields}),
     });
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw Error(data.error??"Goal action failed.");
     await refresh();setMessage("Goal updated without changes to payroll or compensation.");
   }catch(e){setMessage(e instanceof Error?e.message:"Goal review failed.");}
   finally{setBusy(false);}
 }
 return <section className="mx-auto max-w-3xl space-y-4 p-6">
   <h1 className="text-2xl font-semibold">Goals and review cycle</h1>
   <p>Company goals, separate HR review, and employee acknowledgement. This does not change wages.</p>
   {role!=="employee"&&<form onSubmit={e=>{e.preventDefault();void act({
     action:"create",employeeId:Number(employeeId),title,description,dueDate,
   });}} className="space-y-2 rounded border p-3">
     <h2>Create employee goal</h2>
     <label className="block">Employee ID<input className="w-full rounded border p-2"
       value={employeeId} inputMode="numeric" onChange={e=>setEmployeeId(e.target.value)}/></label>
     <label className="block">Goal title<input className="w-full rounded border p-2"
       value={title} onChange={e=>setTitle(e.target.value)}/></label>
     <label className="block">Description<textarea className="w-full rounded border p-2"
       value={description} onChange={e=>setDescription(e.target.value)}/></label>
     <label className="block">Due date<input type="date" className="w-full rounded border p-2"
       value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
     <button type="submit" disabled={busy} className="secondary-button">Create goal</button>
   </form>}
   {goals.map(goal=><article key={goal.id} className="space-y-2 rounded border p-4">
     <h2 className="font-semibold">{goal.title}</h2>
     <p>Employee #{goal.employeeId} · Due {goal.dueDate} · {goal.status}</p>
     <p>{goal.description}</p>
     {goal.reviewScore&&<p>Review: {goal.reviewScore}/5 · {goal.reviewNotes}</p>}
     {role==="employee"&&goal.status==="reviewed"&&
       <button className="secondary-button" disabled={busy}
         onClick={()=>void act({action:"acknowledge",goalId:goal.id})}>Acknowledge review</button>}
     {role!=="employee"&&goal.status==="active"&&<div className="space-y-2">
       <label>Rating <select value={scores[goal.id]??3} onChange={e=>
         setScores(prev=>({...prev,[goal.id]:Number(e.target.value)}))}>
         {[1,2,3,4,5].map(x=><option value={x} key={x}>{x}</option>)}
       </select></label>
       <label className="block">Independent reviewer notes<textarea className="w-full rounded border p-2"
         value={notes[goal.id]??""} onChange={e=>setNotes(prev=>({...prev,[goal.id]:e.target.value}))}/></label>
       <button className="secondary-button" disabled={busy}
         onClick={()=>void act({action:"review",goalId:goal.id,
           score:scores[goal.id]??3,notes:notes[goal.id]??""})}>Submit independent review</button>
     </div>}
   </article>)}
   {goals.length===0&&<p>No goals in your authorized scope.</p>}
   {message&&<p role="status">{message}</p>}
 </section>;
}
