-- Encryptable government identifiers require room for authenticated envelopes.
alter table employees alter column tin type varchar(180);
alter table employees alter column tin_branch_code type varchar(180);
alter table employees alter column sss_no type varchar(180);
alter table employees alter column philhealth_no type varchar(180);
alter table employees alter column pagibig_no type varchar(180);
