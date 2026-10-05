export const HOMEPAGE_FAQS = [
  {
    q: "Are the statutory computations correct?",
    a: "SSS, PhilHealth, Pag-IBIG and TRAIN withholding are implemented with automated regression tests. Holiday, rest-day, overtime, night-differential and MWE logic is traced during payroll, while external payroll reconciliation remains part of production certification.",
  },
  {
    q: "Can I file directly with BIR, SSS, PhilHealth and Pag-IBIG?",
    a: "Linaw generates 1601-C, Alphalist/2316, SSS R-3, PhilHealth RF-1 and Pag-IBIG MCRF worksheets. They stay labelled DRAFT until a human confirms the output validated in the agency's own free tool. We would rather be honest than overclaim.",
  },
  {
    q: "I'm a bookkeeper. Can I run payroll for several clients?",
    a: "Yes. One login can manage multiple client businesses, each fully tenant-isolated. Switch clients from the sidebar or the Cmd/Ctrl+K command palette.",
  },
  {
    q: "How do I move my existing employees in?",
    a: "Upload your current spreadsheet. Column order, extra columns, peso signs and thousands separators are tolerated. Row errors are specific, valid rows still import, and re-uploading updates in place by employee number.",
  },
  {
    q: "How do employees get their payslips?",
    a: "Releasing a run queues a payslip-ready email for every active employee. They sign in to a personal portal with YTD figures and a downloadable PDF payslip, and can never reach a colleague's data.",
  },
  {
    q: "Can I get my data out?",
    a: "Anytime. Full company data export, report builder CSVs and Xero/QBO journals are built in. Privacy requests are tracked through a documented workflow with an internal response deadline and legal-retention review where required.",
  },
] as const;
