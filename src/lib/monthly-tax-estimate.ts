/** BIR Annex E, RR 11-2018: monthly taxable compensation table, 2023 onward. */
export const MONTHLY_TAX_BRACKETS = [
 {floor:0,base:0,rate:0},
 {floor:20833,base:0,rate:.15},
 {floor:33333,base:1875,rate:.20},
 {floor:66667,base:8541.8,rate:.25},
 {floor:166667,base:33541.8,rate:.30},
 {floor:666667,base:183541.8,rate:.35},
] as const;
export function monthlyTaxEstimate(amount:number){
 if(!Number.isFinite(amount)||amount<0||amount>1_000_000_000)throw new RangeError("Enter an amount from 0 to 1,000,000,000.");
 const bracket=amount<=20833?MONTHLY_TAX_BRACKETS[0]:[...MONTHLY_TAX_BRACKETS].reverse().find(b=>amount>=b.floor)!;
 const excess=bracket.rate===0?0:amount-bracket.floor;
 const additional=Math.round(excess*bracket.rate*100)/100;
 const tax=Math.round((bracket.base+excess*bracket.rate)*100)/100;
 return {...bracket,excess,additional,tax};
}
