alter table time_punches add column if not exists break_start timestamptz;
alter table time_punches add column if not exists break_end timestamptz;
