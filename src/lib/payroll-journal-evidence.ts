import { sql } from "drizzle-orm";

/** Correlated with an authorized released header. Return NULL for incomplete legacy evidence.
 * Only the employer cutoff total leaves PostgreSQL; worker traces can include payment details.
 */
export const releasedEmployerPhilHealth = sql<string | null>`(
  select case when count(*) > 0
    and count(*) = payroll_runs.employee_count
    and count(distinct entry.employee_id) = count(*)
    and count(owner.id) = count(*)
    and sum(entry.gross_pay) = payroll_runs.gross_pay
    and sum(entry.net_pay) = payroll_runs.net_pay
    and count(proof.amount) = count(*)
    then sum(proof.amount)::text end
  from payroll_entries entry
  left join employees owner on owner.id = entry.employee_id and owner.organization_id = payroll_runs.organization_id
  cross join lateral (
    select case when count(*) = 1 then
      max(case when token ~ '^philHealthEmployerCutoff=(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$'
        then split_part(token, '=', 2)::numeric end)
    end as amount
    from jsonb_array_elements_text(case when jsonb_typeof(entry.trace->'inputs') = 'array'
      then entry.trace->'inputs' else '[]'::jsonb end) as inputs(token)
    where starts_with(token, 'philHealthEmployerCutoff=')
  ) proof
  where entry.payroll_run_id = payroll_runs.id
)`;
