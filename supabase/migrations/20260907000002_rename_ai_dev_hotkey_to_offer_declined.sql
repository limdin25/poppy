-- Rename the mistaken AI_DEV_HOTKEY column to Offer declined on live boards.
-- Hugo's instruction text was not the column name. Re-run safe.

update wk_pipeline_columns
   set name = 'Offer declined',
       colour = '#BE123C'
 where name = 'AI_DEV_HOTKEY';
