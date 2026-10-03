alter table contractors add column if not exists tin varchar(180);
alter table contractors add column if not exists withholding_atc varchar(24);
alter table contractors add column if not exists withholding_rate numeric(6,3);

create table if not exists contractor_payments (
  id serial primary key,
  organization_id integer not null references organizations(id) on delete cascade,
  contractor_id integer not null references contractors(id) on delete restrict,
  payment_date date not null,
  gross_amount_php numeric(14,2) not null,
  withholding_atc varchar(24) not null,
  withholding_rate numeric(6,3) not null,
  withholding_amount numeric(14,2) not null,
  net_amount_php numeric(14,2) not null,
  reference varchar(160),
  created_by varchar(120) not null,
  created_at timestamptz not null default now()
);

create index if not exists contractor_payment_org_date_idx on contractor_payments(organization_id, payment_date);
create index if not exists contractor_payment_contractor_idx on contractor_payments(contractor_id);
