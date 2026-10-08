const audiences = [
  { title: "Payroll teams", description: "Keep cutoff inputs, exception review and approval responsibilities in one workflow." },
  { title: "Multi-branch businesses", description: "Review payroll and people records with organization scope and clear release ownership." },
  { title: "Bookkeepers", description: "Work across client companies while keeping each company’s records and decisions separate." },
];
const steps = [
  { title: "Import", description: "Validate employee records, pay settings and opening balances." },
  { title: "Reconcile", description: "Compare a controlled payroll with expected figures and resolve differences." },
  { title: "Approve", description: "Confirm review responsibilities and approve the first payroll before release." },
];

export function ProductHomeStories() {
  return (
    <section id="product" className="lp-product-stories lp-buyer-guide" aria-labelledby="buyer-guide-title">
      <p className="lp-eyebrow">Find your fit</p>
      <h2 id="buyer-guide-title">A clearer cutoff for the team you have.</h2>
      <div className="lp-audiences">
        {audiences.map(audience => <article key={audience.title}><h3>{audience.title}</h3><p>{audience.description}</p></article>)}
      </div>
      <div className="lp-first-payroll">
        <div><p className="lp-eyebrow">Your first payroll</p><h3>Start with a comparison, then a decision.</h3><a href="/implementation">Explore implementation ↗</a></div>
        <ol>{steps.map((step, index) => <li key={step.title}><span aria-hidden="true">0{index + 1}</span><div><h4>{step.title}</h4><p>{step.description}</p></div></li>)}</ol>
      </div>
      <div className="lp-buyer-links" id="security"><p>Review the controls and responsibilities before sharing real payroll data.</p><a href="/security">Review security details ↗</a><a href="/payroll-outsourcing">Payroll Outsourcing Philippines ↗</a></div>
    </section>
  );
}
