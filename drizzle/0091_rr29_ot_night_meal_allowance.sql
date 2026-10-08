ALTER TABLE de_minimis_grants
  ADD COLUMN IF NOT EXISTS basis_daily_minimum_wage numeric(10,2),
  ADD COLUMN IF NOT EXISTS basis_wage_order varchar(80);

CREATE UNIQUE INDEX IF NOT EXISTS de_minimis_active_ot_night_meal_unique
  ON de_minimis_grants (organization_id, employee_id, benefit_type)
  WHERE active = true AND benefit_type = 'otNightMealAllowance';
