"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CirclePause, CirclePlay, MousePointer2 } from "lucide-react";
import type { DemoRoleId } from "@/lib/demo-roles";
import { AppProductPreview } from "./AppProductPreview";

const SCENE_DURATION = 5200;

const scenes: Array<{id:string;role:DemoRoleId;step:string;eyebrow:string;title:string;copy:string}> = [
  { id:"prepare", role:"payroll", step:"01", eyebrow:"Prepare", title:"Build the payroll run with the exceptions visible.", copy:"Approved inputs, calculations and attendance issues stay in one working view before review." },
  { id:"review", role:"checker", step:"02", eyebrow:"Review", title:"See what changed before anyone approves it.", copy:"The checker focuses on differences, exceptions and unusual movements instead of rereading the entire run." },
  { id:"release", role:"owner", step:"03", eyebrow:"Release", title:"Know what is still blocking payday.", copy:"Approval state, open exceptions and payout context come together before the release decision." },
  { id:"receive", role:"employee", step:"04", eyebrow:"Receive", title:"Give every employee a clear payday view.", copy:"After release, employees can see their own payslip and pay details without exposing anyone else's records." },
];

export function CinematicHeroDemo() {
  const [active,setActive]=useState(0);
  const [paused,setPaused]=useState(false);
  const [hovering,setHovering]=useState(false);
  const [reducedMotion,setReducedMotion]=useState(false);
  const frameRef=useRef<HTMLDivElement>(null);
  const autoplay=!paused&&!hovering&&!reducedMotion;
  const current=scenes[active];

  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync=()=>setReducedMotion(media.matches);
    sync();
    media.addEventListener?.("change",sync);
    return()=>media.removeEventListener?.("change",sync);
  },[]);

  useEffect(()=>{
    if(!autoplay)return;
    const timer=window.setTimeout(()=>setActive(index=>(index+1)%scenes.length),SCENE_DURATION);
    return()=>window.clearTimeout(timer);
  },[active,autoplay]);

  const progressKey=useMemo(()=>current.id+"-"+(autoplay?"play":"pause"),[current.id,autoplay]);
  const move=(delta:number)=>setActive(index=>(index+delta+scenes.length)%scenes.length);

  return (
    <div ref={frameRef} className="cinematic-demo" data-testid="cinematic-hero-demo"
      onMouseEnter={()=>setHovering(true)} onMouseLeave={()=>setHovering(false)}
      onFocusCapture={()=>setHovering(true)}
      onBlurCapture={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setHovering(false);}}>
      <div className="cinematic-demo-glow" aria-hidden="true"/>
      <div className="cinematic-demo-shell">
        <div className="cinematic-demo-topbar">
          <div className="cinematic-demo-window" aria-hidden="true"><span/><span/><span/></div>
          <div className="cinematic-demo-now"><span className="cinematic-demo-live-dot" aria-hidden="true"/>Product walkthrough</div>
          <div className="cinematic-demo-actions">
            <button type="button" onClick={()=>move(-1)} aria-label="Previous hero scene" className="cinematic-demo-icon-button"><ArrowLeft size={14} aria-hidden="true"/></button>
            <button type="button" onClick={()=>setPaused(value=>!value)} aria-label={paused?"Play hero demo":"Pause hero demo"} className="cinematic-demo-icon-button">
              {paused?<CirclePlay size={15} aria-hidden="true"/>:<CirclePause size={15} aria-hidden="true"/>}
            </button>
            <button type="button" onClick={()=>move(1)} aria-label="Next hero scene" className="cinematic-demo-icon-button"><ArrowRight size={14} aria-hidden="true"/></button>
          </div>
        </div>

        <div className="cinematic-demo-stage">
          <div className="cinematic-demo-story" aria-live="polite">
            <span className="cinematic-demo-kicker">{current.step} · {current.eyebrow}</span>
            <strong>{current.title}</strong>
            <p>{current.copy}</p>
          </div>

          <Link href="/demo" className="cinematic-demo-preview-link" aria-label={"Open interactive Linaw demo from "+current.eyebrow.toLowerCase()+" scene"}>
            <div key={current.id} className="cinematic-demo-preview cinematic-demo-enter">
              <AppProductPreview role={current.role} compact/>
            </div>
            <span className="cinematic-demo-click-hint"><MousePointer2 size={13} aria-hidden="true"/>Click to explore the interactive demo</span>
          </Link>
        </div>

        <div className="cinematic-demo-scenes" role="tablist" aria-label="Hero product scenes">
          {scenes.map((scene,index)=>{
            const selected=index===active;
            return (
              <button type="button" key={scene.id} role="tab" aria-selected={selected} aria-controls="cinematic-demo-panel"
                onClick={()=>setActive(index)} className={"cinematic-demo-scene "+(selected?"is-active":"")}>
                <span className="cinematic-demo-scene-number">{selected?<Check size={11} aria-hidden="true"/>:scene.step}</span>
                <span><strong>{scene.eyebrow}</strong><small>{scene.role==="payroll"?"Payroll Officer":scene.role==="checker"?"Checker":scene.role==="owner"?"Owner":"Employee"}</small></span>
                <span className="cinematic-demo-progress-track" aria-hidden="true">
                  {selected&&<span key={progressKey} className={"cinematic-demo-progress "+(autoplay?"is-playing":"")} style={{"--cinematic-duration":SCENE_DURATION+"ms"} as CSSProperties}/>}
                </span>
              </button>
            );
          })}
        </div>
        <div id="cinematic-demo-panel" className="sr-only" role="tabpanel">{current.eyebrow}: {current.title}</div>
      </div>
      <p className="cinematic-demo-note">Illustrative sample data · product structure mirrors the current Linaw role dashboards</p>
    </div>
  );
}
