"use client";
import { useState } from "react";
import { LinawSimulation } from "./linaw-simulation";
import "./product-home.css";
export type ProductSimulationArea = "people" | "attendance" | "reports" | "employee" | "payroll";
const pages = { people: "People", attendance: "Time & attendance", reports: "Exports", employee: "Payroll", payroll: "Payroll" };
const titles = { people: "Explore your employee workspace", attendance: "See your team’s time and attendance", reports: "Explore workforce reporting", employee: "See payday from an employee’s perspective", payroll: "Explore the payroll workflow" };
export function ProductSimulation({ area }: { area: ProductSimulationArea }) {
 const [page,setPage]=useState(pages[area]);
 return <section className="home-redesign" aria-label="Interactive product simulation"><div style={{maxWidth:1180,margin:"0 auto",padding:"40px 20px"}}><h2 style={{fontSize:28,fontWeight:650,color:"#102747",marginBottom:12}}>{titles[area]}</h2><p style={{fontSize:13,color:"#61748c",marginBottom:24}}>Try a sample workflow, or switch roles to see what each team member needs next.</p><div style={{border:"1px solid #dde6f1",borderRadius:12,overflow:"hidden"}}><LinawSimulation initialRole={area === "employee" ? "Employee" : "Payroll"} page={page} onPageChange={setPage}/></div></div></section>;
}
