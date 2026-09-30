-- Copy only. Billing and Stripe remain unchanged.
update wk_sms_templates set body_md='Hi {first_name}, it is {agent_first_name} from Hostunico. Did the numbers match what you expected? Reply STOP to opt out.'
where desk='sa' and name='Hostunico: report follow-up';
update wk_sms_templates set body_md=E'Hi {first_name},\n\nHere is the report we discussed. The figures are estimates, not guaranteed income. Please check its property assumptions and separate running costs.\n\n{hostunico_price}\n\nWant me to walk you through what onboarding looks like?\n\n{agent_first_name}\nHostunico'
where desk='sa' and name='Hostunico: property report follow-up';
