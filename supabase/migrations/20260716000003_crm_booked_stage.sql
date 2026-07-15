-- CRM Growth · Phase C — a "Booked" pipeline stage for AI-booked leads.
-- Inserts a Booked column at the top of the default pipeline (idempotent).
DO $$
DECLARE
  pid uuid;
BEGIN
  SELECT id INTO pid FROM wk_pipelines ORDER BY created_at ASC LIMIT 1;
  IF pid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM wk_pipeline_columns WHERE pipeline_id = pid AND lower(name) = 'booked'
  ) THEN
    INSERT INTO wk_pipeline_columns (pipeline_id, name, colour, position, sort_order)
    VALUES (pid, 'Booked', '#3C5A87', 0, 0);
  END IF;
END $$;
