-- The property agreement is Unico, not HeyElsie.
--
-- Property callers work under the Unico name, which is what they say on the
-- phone (see src/core/content/property-call-script.html). A working agreement
-- should also name the actual contracting company, not only the trading name,
-- so a new first section names the registered entity. These details are the
-- Companies House record and are already used in heypubli/features/legal/.
--
-- SCOPE: the 'property' row only. The 'sales-closer' agreement stays HeyElsie
-- on purpose, because those agents sell the HeyElsie reviews product.
--
-- Safe to run twice. Nobody had signed when this went out, so no signature
-- snapshot in wk_agreement_signatures is affected either way: a snapshot is
-- taken at signing time and is never rewritten by an edit here. The version
-- bump is left to the wk_agent_agreement_bump_version trigger, as designed.

UPDATE wk_agent_agreement
   SET company = 'Unico',
       intro = 'Welcome to the team, and thanks for coming on board. This is a short, plain English agreement for your role as a Property Deal Sourcing Caller at Unico, so you know exactly how we work together and how you get paid. Read it through, and ask us anything you are not sure about before you sign.',
       terms = $json$[
         {"heading":"Who you are working with","body":"Unico is the trading name of ULINC UNICO GROUP LTD, a company registered in England and Wales under company number 11197856, whose registered office is 483 Green Lanes, London, England, N13 4BS. That is the company you are agreeing this with, and wherever this agreement says Unico or we, it means that company."},
         {"heading":"Your role","body":"You will call estate agents from the list we give you and ask about the properties they have for sale. You will ask the right questions, find out what the seller really needs, and put offers forward. Everything you do is managed inside the CRM: the list you call from, the notes you take, and the offers you submit. When an agent accepts one of your offers, we pass that deal to our network of investors."},
         {"heading":"Your hours","body":"Monday to Friday, 10:00am to 6:00pm UK time. Those are the hours estate agents are at their desks, so that is when we call."},
         {"heading":"Your pay","body":"You start on 100 USD per week. Your weekly salary then goes up permanently with every deal you complete, and you also earn a separate commission on each one. Both are set out below."},
         {"heading":"How your salary grows","body":"Every deal you complete adds 25 USD to your weekly salary, and it stays there for good. Your first completed deal takes you to 125 USD per week. Your second takes you to 150 USD. Your third takes you to 175 USD. Your fourth takes you to 200 USD per week, which is the maximum weekly salary for this role."},
         {"heading":"Your commission","body":"On top of your salary you earn 100 USD for every deal you complete. That is paid for each completed deal, and it is separate from the 25 USD weekly salary rise the same deal earns you."},
         {"heading":"What counts as a completed deal","body":"This is the most important part of this agreement, so please read it twice. An accepted offer is NOT a completed deal. A deal is only complete once all of these have happened: the estate agent accepts your offer, we send the deal to an investor, an investor decides to buy it, and then the purchase fully completes, meaning the legal process and all the paperwork are finished. That last step normally takes 1 to 2 months. Your 25 USD weekly salary rise and your 100 USD commission are both triggered by that final completion, not by the offer being accepted."},
         {"heading":"What to expect in your first two months","body":"Based on performance we expect somewhere between 1 and 4 deals a month. Because a deal takes 1 to 2 months to complete legally, your first commission and your first salary rise will most likely land around your second month, and by then you should have several deals moving through the pipeline at once. We are telling you this up front so a quiet third week does not worry you. If the calls are being made and the offers are going in, the work is being done and the money follows."},
         {"heading":"When you get paid","body":"Your work week closes every Friday, and your weekly salary is paid within 72 hours. In practice you can expect it on Monday morning, before your shift starts. You just need to set up your payment method first, and we will email you simple instructions."},
         {"heading":"Your paid trial week","body":"Your first week is a paid trial. If it turns out not to be the right fit, we may end it straight away during that week, and you will still be paid in full for all the work you have done up to that point."},
         {"heading":"Notice after the trial","body":"Once you are past the trial, either of us can end the arrangement by giving one week of notice."},
         {"heading":"Your working hours are tracked in the CRM","body":"The CRM records your working hours for you automatically, so nobody has to count them by hand and nobody is looking over your shoulder. Idle time does not count as paid working time. This protects both of us: you never have to argue for hours you worked, and we never pay for hours nobody worked. Everything is recorded fairly, openly, and you can see it too."},
         {"heading":"Your taxes and equipment","body":"You work as an independent contractor. You are responsible for your own taxes, and for your own setup: a reliable internet connection, a quiet place to work, and a good headset and microphone."},
         {"heading":"Keeping things confidential","body":"Property lists, agent contact details, call recordings, scripts, offer figures and any investor information belong to Unico. Please keep them private, use them only for your work here, and never copy or share them anywhere else."},
         {"heading":"We are looking for someone long term","body":"We have worked in this niche before and we know it works when somebody sticks with it. This is not a short term hire. We want somebody who wants to grow with this, get really good at it, and stay."}
       ]$json$::jsonb
 WHERE slug = 'property';
