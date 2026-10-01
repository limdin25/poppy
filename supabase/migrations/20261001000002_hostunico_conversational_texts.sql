-- Copy only. Existing STOP handling, send permissions and timing stay intact.
update public.wk_sms_templates
  set body_md = 'Hi {first_name}, it''s {agent_first_name} from Hostunico. Did the numbers match what you expected?'
  where desk='sa' and name='Hostunico: report follow-up' and channel='sms';
update public.wk_sms_templates
  set body_md = 'Hi {first_name}, it''s {agent_first_name} from Hostunico. Could you send me the property''s full postcode and the number of bedrooms and bathrooms?'
  where desk='sa' and name='Hostunico: arrange a report' and channel='sms';
update public.wk_sms_templates
  set body_md = E'Hi {first_name},\n\nHave you had a chance to look at the property report? Let me know what you think.\n\n{agent_first_name}\nHostunico'
  where desk='sa' and name='Hostunico: property report follow-up' and channel='email';
update public.sa_followup_config
  set config = jsonb_set(config,'{steps}',(
    select jsonb_agg(case when step->>'id'='step2' and step->>'text'='Would a quick walkthrough of onboarding help?'
      then step || '{"text":"What did you think of the report?","approved":false}'::jsonb else step end order by position)
    from jsonb_array_elements(config->'steps') with ordinality as steps(step,position)
  )), updated_at=now()
  where id=true;
