alter table data_requests add column if not exists fulfillment_action varchar(64);
alter table data_requests add column if not exists fulfillment_evidence jsonb not null default '{}'::jsonb;
alter table data_requests add column if not exists legal_retention_applied boolean not null default false;
