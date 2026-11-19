/** Separate, integer-centavo reference arithmetic. No application/rule-pack imports.
 * SSS Circular 2024-006 p1; HDMF 460 section C; BIR RR11-2018 Annex E.
 * PhilHealth 5% arithmetic is an explicit assumption pending the original 2026 advisory.
 * Cutoff allocation is a software convention, not an agency-prescribed remittance split.
 */
export const MONTHS = ['2026-09', '2026-10'] as const;
export const WORKERS = [
  { key:'MONTHLY30', basis:'monthly', rate:3000000, divisor:22 },
  { key:'MONTHLY40', basis:'monthly', rate:4000000, divisor:22 },
  { key:'MONTHLY100', basis:'monthly', rate:10000000, divisor:22 },
  { key:'PH_ODD', basis:'monthly', rate:1000020, divisor:10 },
  { key:'VARIABLE24', basis:'monthly', rate:2400000, divisor:22 },
  { key:'DAILY', basis:'daily', rate:100000, divisor:22 },
  { key:'HOURLY', basis:'hourly', rate:12500, divisor:22 },
  { key:'BENEFITS', basis:'monthly', rate:3000000, divisor:22 },
] as const;
export const PHILHEALTH_HALF_CENTAVO_WORKER = { key: "PH_HALF_CENT", basis: "monthly", rate: 1024090, divisor: 10 } as const;
export type Worker = typeof WORKERS[number] | typeof PHILHEALTH_HALF_CENTAVO_WORKER;
export function cents(value:string|number):number {
 const s=String(value);if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))throw Error('Invalid centavo input');
 const negative=s.startsWith('-'),[whole,fraction='']=s.replace('-','').split('.');
 const n=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
 if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Unsafe centavos');
 return Number(negative?-n:n);
}
export const pesos=(n:number)=>`${n<0?'-':''}${Math.floor(Math.abs(n)/100)}.${String(Math.abs(n)%100).padStart(2,'0')}`;
const percent=(n:number,p:number)=>Number((BigInt(n)*BigInt(p)+BigInt(50))/BigInt(100));
export function sssReference(remuneration:number){
 const msc=Math.min(3500000,Math.max(500000,Math.floor((remuneration+25000)/50000)*50000));
 return {msc,regularMsc:Math.min(msc,2000000),mpfMsc:Math.max(msc-2000000,0),sss:percent(msc,5),sssEr:percent(msc,10),ec:msc<1500000?1000:3000};
}
export function semiMonthlyTax(taxable:number){
 if(!Number.isSafeInteger(taxable)||taxable<0)throw Error('Invalid taxable compensation');
 // Published semi-monthly table thresholds and base tax in centavos.
 const bands=[[1041700,0,15],[1666700,93750,20],[3333300,427070,25],[8333300,1677070,30],[33333300,9177070,35]];
 let result=0;for(const [threshold,base,rate]of bands)if(taxable>threshold)result=base+percent(taxable-threshold,rate);
 return result;
}
export function extra(w:Worker,month:string,cutoff:number){
 if(cutoff!==2)return {amount:0,exempt:0,sssBase:true,kind:'allowance'};
 if(w.key==='VARIABLE24')return {amount:600000,exempt:0,sssBase:true,kind:'allowance'};
 if(w.key==='BENEFITS')return month==='2026-09'
  ?{amount:6000000,exempt:6000000,sssBase:false,kind:'other_benefit_90k'}
  :{amount:4000000,exempt:3000000,sssBase:false,kind:'13th_month'};
 return {amount:0,exempt:0,sssBase:true,kind:'allowance'};
}
export function expectedCutoff(w:Worker,month:string,cutoff:number){
 const basic=w.basis==='monthly'?w.rate/2:w.basis==='daily'?w.rate*10:w.rate*8*10;
 const mb=w.basis==='monthly'?w.rate:w.basis==='daily'?w.rate*w.divisor:w.rate*8*w.divisor;
 const bonus=extra(w,month,cutoff),gross=basic+bonus.amount;
 const monthlyBase=basic*2+(bonus.sssBase?bonus.amount:0);
 const target=sssReference(monthlyBase),first=sssReference(basic*2);
 const allocate=(total:number,prior:number)=>cutoff===1?Math.floor((total+1)/2):total-prior;
 const sss=allocate(target.sss,Math.floor((first.sss+1)/2));
 const sssEr=allocate(target.sssEr,Math.floor((first.sssEr+1)/2)),ec=allocate(target.ec,Math.floor((first.ec+1)/2));
 const premium=percent(Math.min(10000000,Math.max(1000000,mb)),5);
 // Assumption only: split odd premium cent to ER. Preserve SOURCE NOT VERIFIED.
 const phMonthly=Math.floor(premium/2),phErMonthly=premium-phMonthly;
 const ph=allocate(phMonthly,Math.floor((phMonthly+1)/2));
 const phEr=allocate(phErMonthly,Math.floor((phErMonthly+1)/2));
 const pagMonthly=percent(Math.min(monthlyBase,1000000),monthlyBase<=150000?1:2);
 const pag=allocate(pagMonthly,percent(Math.min(basic*2,1000000),basic*2<=150000?1:2)/2);
 const pagEr=allocate(percent(Math.min(monthlyBase,1000000),2),percent(Math.min(basic*2,1000000),2)/2);
 const taxable=gross-bonus.exempt-sss-ph-pag,wht=semiMonthlyTax(taxable),deductions=sss+ph+pag+wht;
 return {gross,basic,sss,ph,pag,wht,deductions,net:gross-deductions,sssEr,ec,phEr,pagEr,msc:target.msc,regularMsc:target.regularMsc,mpfMsc:target.mpfMsc,taxable,benefitExempt:bonus.exempt};
}
