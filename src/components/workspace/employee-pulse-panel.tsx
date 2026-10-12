"use client";
import { useCallback, useEffect, useState } from "react";
type Survey = { id:number;question:string;status:string };
type Result = { surveyId:number;visible:boolean;count?:number;average?:number;distribution?:number[] };
export function EmployeePulsePanel({organizationId}:{organizationId:number}){
 const [surveys,setSurveys]=useState<Survey[]>([]);
 const [results,setResults]=useState<Result[]>([]);
 const [admin,setAdmin]=useState(false);
 const [question,setQuestion]=useState("");
 const [score,setScore]=useState<Record<number,number>>({});
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
   const r=await fetch(`/api/engagement/pulse?organizationId=${organizationId}`,{cache:"no-store"});
   if(!r.ok)throw Error("Engagement survey is unavailable.");
   const data=await r.json() as {surveys:Survey[];results?:Result[]};
   setSurveys(data.surveys);
   setAdmin(Array.isArray(data.results));
   setResults(data.results??[]);
 },[organizationId]);
 useEffect(()=>{
   let active=true;
   const controller=new AbortController();
   fetch(`/api/engagement/pulse?organizationId=${organizationId}`,{
     cache:"no-store",signal:controller.signal,
   }).then(async response=>{
     if(!response.ok)throw Error("Engagement survey is unavailable.");
     return response.json() as Promise<{surveys:Survey[];results?:Result[]}>;
   }).then(data=>{
     if(!active)return;
     setSurveys(data.surveys);
     setAdmin(Array.isArray(data.results));
     setResults(data.results??[]);
   }).catch(()=>{if(active)setMessage("Survey is unavailable.");});
   return()=>{active=false;controller.abort();};
 },[organizationId]);
 async function act(payload:Record<string,unknown>){
   setBusy(true);setMessage("");
   try{
     const r=await fetch("/api/engagement/pulse",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({organizationId,...payload}),
     });
     const response=await r.json().catch(()=>({}));
     if(!r.ok)throw Error(response.error??"Survey action unavailable.");
     await refresh();
     setMessage("Survey response recorded. Private individual answers are not displayed.");
   }catch(e){setMessage(e instanceof Error?e.message:"Survey request failed.");}
   finally{setBusy(false);}
 }
 return <section className="mx-auto max-w-3xl space-y-4 p-6">
   <h1 className="text-2xl font-semibold">Employee pulse</h1>
   <p>One anonymous rating per survey. Results are shown only after closure and five or more participants. This feature is optional.</p>
   {admin&&<form onSubmit={event=>{event.preventDefault();void act({action:"create",question});}} className="flex gap-2">
     <label className="flex-1">New question
       <input value={question} onChange={event=>setQuestion(event.target.value)}
         className="w-full rounded border p-2" minLength={10} maxLength={240}/>
     </label>
     <button type="submit" disabled={busy||question.trim().length<10}
       className="secondary-button">Create survey</button>
   </form>}
   {surveys.map(survey=><article key={survey.id} className="rounded border p-4 space-y-2">
     <h2 className="font-semibold">{survey.question}</h2>
     <p>Status: {survey.status}</p>
     {!admin&&survey.status==="open"&&<div className="flex gap-2">
       <label>Rating <select value={score[survey.id]??3}
         onChange={event=>setScore(prev=>({...prev,[survey.id]:Number(event.target.value)}))}>
         {[1,2,3,4,5].map(value=><option value={value} key={value}>{value}</option>)}
       </select></label>
       <button className="secondary-button" disabled={busy}
         onClick={()=>void act({action:"respond",surveyId:survey.id,score:score[survey.id]??3})}>
         Submit anonymously
       </button>
     </div>}
     {admin&&survey.status==="open"&&<button className="secondary-button" disabled={busy}
       onClick={()=>void act({action:"close",surveyId:survey.id})}>Close and seal results</button>}
     {admin&&survey.status==="closed"&&(()=>{
       const result=results.find(x=>x.surveyId===survey.id);
       return result?.visible?<p role="status">Responses: {result.count} · Average: {result.average} / 5 ·
          Distribution 1–5: {(result.distribution??[]).join(", ")}</p>
         :<p>Result withheld: fewer than five responses.</p>;
     })()}
   </article>)}
   {surveys.length===0&&<p>No eligible surveys.</p>}
   {message&&<p role="status">{message}</p>}
 </section>;
}
