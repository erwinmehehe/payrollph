alter table organizations
  add column if not exists statutory_deduction_timing varchar(24) not null default 'split';

alter table employees
  add column if not exists pagibig_voluntary_monthly numeric(10,2) not null default 0;

alter table organizations
  add constraint organizations_statutory_deduction_timing_check
  check (statutory_deduction_timing in ('split', 'first_cutoff', 'second_cutoff'));
