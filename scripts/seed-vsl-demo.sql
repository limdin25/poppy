-- Seed the VSL demo business (5b6e8782) with realistic dashboard data.
-- Story: Energywise Heating Limited, Glossop — 5.0★, 59 reviews, rank 11.
-- Everything the video mentions must look alive: contacts in stages,
-- requests flowing, 4-5★ reviews with AI replies, social templates + queue.

BEGIN;

UPDATE businesses SET name = 'Energywise Heating Limited' WHERE id = '5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d';

-- Contacts (12, staggered over 3 weeks)
INSERT INTO contacts (id, business_id, name, phone, email, status, created_at) VALUES
 ('dd000001-0000-4000-8000-000000000001','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Sarah Thompson','+447700900101','sarah.t@example.co.uk','new',now() - interval '21 days'),
 ('dd000001-0000-4000-8000-000000000002','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Dave Whitfield','+447700900102','dave.w@example.co.uk','new',now() - interval '20 days'),
 ('dd000001-0000-4000-8000-000000000003','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Karen Bishop','+447700900103','karen.b@example.co.uk','new',now() - interval '18 days'),
 ('dd000001-0000-4000-8000-000000000004','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Tom Ashley','+447700900104','tom.a@example.co.uk','new',now() - interval '16 days'),
 ('dd000001-0000-4000-8000-000000000005','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Priya Shah','+447700900105','priya.s@example.co.uk','new',now() - interval '14 days'),
 ('dd000001-0000-4000-8000-000000000006','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Martin Oakes','+447700900106','martin.o@example.co.uk','new',now() - interval '12 days'),
 ('dd000001-0000-4000-8000-000000000007','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Julie Cartwright','+447700900107','julie.c@example.co.uk','new',now() - interval '10 days'),
 ('dd000001-0000-4000-8000-000000000008','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Steve Redfern','+447700900108','steve.r@example.co.uk','new',now() - interval '8 days'),
 ('dd000001-0000-4000-8000-000000000009','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Angela Ford','+447700900109','angela.f@example.co.uk','new',now() - interval '6 days'),
 ('dd000001-0000-4000-8000-000000000010','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Chris Duckworth','+447700900110','chris.d@example.co.uk','new',now() - interval '4 days'),
 ('dd000001-0000-4000-8000-000000000011','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Emma Shaw','+447700900111','emma.s@example.co.uk','new',now() - interval '2 days'),
 ('dd000001-0000-4000-8000-000000000012','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Paul Mellor','+447700900112','paul.m@example.co.uk','new',now() - interval '1 day');

-- Review requests across every funnel stage (14)
INSERT INTO review_requests (id, business_id, contact_id, channel, status, followups_sent, first_sent_at, last_sent_at, clicked_at, reviewed_at, message_body, created_at) VALUES
 ('dd000002-0000-4000-8000-000000000001','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000001','sms','reviewed',0,now() - interval '20 days',now() - interval '20 days',now() - interval '20 days' + interval '2 hours',now() - interval '20 days' + interval '3 hours','Hi Sarah, it''s Michael from Energywise Heating. Thanks for having us out — would you mind leaving a quick review?',now() - interval '20 days'),
 ('dd000002-0000-4000-8000-000000000002','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000002','sms','reviewed',1,now() - interval '19 days',now() - interval '17 days',now() - interval '17 days' + interval '1 hour',now() - interval '17 days' + interval '2 hours','Hi Dave, it''s Michael from Energywise Heating. Thanks for choosing us — a quick review would mean a lot.',now() - interval '19 days'),
 ('dd000002-0000-4000-8000-000000000003','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000003','email','reviewed',0,now() - interval '18 days',now() - interval '18 days',now() - interval '18 days' + interval '5 hours',now() - interval '18 days' + interval '6 hours','Hi Karen, thank you for choosing Energywise Heating — would you share your experience?',now() - interval '18 days'),
 ('dd000002-0000-4000-8000-000000000004','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000004','sms','reviewed',0,now() - interval '15 days',now() - interval '15 days',now() - interval '15 days' + interval '3 hours',now() - interval '15 days' + interval '4 hours','Hi Tom, it''s Michael from Energywise Heating — glad we got the boiler sorted. A quick review helps us a lot.',now() - interval '15 days'),
 ('dd000002-0000-4000-8000-000000000005','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000005','sms','reviewed',1,now() - interval '13 days',now() - interval '11 days',now() - interval '11 days' + interval '2 hours',now() - interval '11 days' + interval '3 hours','Hi Priya, it''s Michael from Energywise Heating. Thanks for the cuppa! Would you mind leaving a review?',now() - interval '13 days'),
 ('dd000002-0000-4000-8000-000000000006','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000006','sms','reviewed',0,now() - interval '11 days',now() - interval '11 days',now() - interval '11 days' + interval '6 hours',now() - interval '11 days' + interval '7 hours','Hi Martin, it''s Michael from Energywise Heating — thanks for recommending us to your neighbour. A review would be brilliant.',now() - interval '11 days'),
 ('dd000002-0000-4000-8000-000000000007','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000007','sms','in_progress',1,now() - interval '9 days',now() - interval '7 days',now() - interval '7 days' + interval '1 hour',null,'Hi Julie, it''s Michael from Energywise Heating. Hope the new radiator is doing the job — fancy leaving a quick review?',now() - interval '9 days'),
 ('dd000002-0000-4000-8000-000000000008','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000008','sms','in_progress',0,now() - interval '7 days',now() - interval '7 days',null,null,'Hi Steve, it''s Michael from Energywise Heating — thanks for having us. Would you mind leaving a quick review?',now() - interval '7 days'),
 ('dd000002-0000-4000-8000-000000000009','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000009','email','in_progress',1,now() - interval '5 days',now() - interval '3 days',now() - interval '3 days' + interval '4 hours',null,'Hi Angela, thank you for choosing Energywise Heating — your feedback means a lot to us.',now() - interval '5 days'),
 ('dd000002-0000-4000-8000-000000000010','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000010','sms','no_review',1,now() - interval '4 days',now() - interval '2 days',null,null,'Hi Chris, it''s Michael from Energywise Heating. Cheers for the job yesterday — a quick review if you get a sec.',now() - interval '4 days'),
 ('dd000002-0000-4000-8000-000000000011','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000011','sms','queued',0,null,null,null,null,'Hi Emma, it''s Michael from Energywise Heating — thanks for booking the service. Mind leaving a review after?',now() - interval '2 days'),
 ('dd000002-0000-4000-8000-000000000012','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000001-0000-4000-8000-000000000012','sms','queued',0,null,null,null,null,'Hi Paul, it''s Michael from Energywise Heating. Thanks for today — would love a quick review.',now() - interval '1 day');

-- Google reviews (9): seven 5★, two 4★, most auto-replied in Michael's voice
INSERT INTO gbp_reviews (id, business_id, zernio_review_id, rating, comment, reviewer_name, review_created_at, has_reply, reply_text, reply_posted_at, ai_draft, ai_draft_status, matched_request_id, social_posted_at) VALUES
 ('dd000003-0000-4000-8000-000000000001','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-001',5,'Boiler serviced within the week. Engineer was tidy, on time and explained everything clearly. Would definitely recommend.','Sarah Thompson',now() - interval '20 days',true,'Thanks Sarah — glad we could get it sorted so quickly. See you at the next service! — Michael',now() - interval '20 days' + interval '2 hours',null,'posted','dd000002-0000-4000-8000-000000000001',now() - interval '19 days'),
 ('dd000003-0000-4000-8000-000000000002','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-002',5,'New combi fitted in a day. Brilliant job, house left spotless, price exactly as quoted.','Dave Whitfield',now() - interval '17 days',true,'Cheers Dave — enjoy the new boiler! Any questions just give us a ring. — Michael',now() - interval '17 days' + interval '1 hour',null,'posted','dd000002-0000-4000-8000-000000000002',null),
 ('dd000003-0000-4000-8000-000000000003','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-003',4,'Good honest service. Took a couple of days to get booked in but the work itself was spot on.','Karen Bishop',now() - interval '16 days',true,'Thanks Karen — sorry about the wait, winter rush! Glad the work hit the mark. — Michael',now() - interval '16 days' + interval '3 hours',null,'posted','dd000002-0000-4000-8000-000000000003',null),
 ('dd000003-0000-4000-8000-000000000004','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-004',5,'Called at 8am about no hot water, fixed by lunchtime. Cannot fault them.','Tom Ashley',now() - interval '15 days',true,'Thanks Tom — that''s what we''re here for! — Michael',now() - interval '15 days' + interval '1 hour',null,'posted','dd000002-0000-4000-8000-000000000004',now() - interval '14 days'),
 ('dd000003-0000-4000-8000-000000000005','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-005',5,'Really professional from quote to finish. The lads even hoovered before they left.','Priya Shah',now() - interval '11 days',true,'Thank you Priya — we always aim to leave it better than we found it! — Michael',now() - interval '11 days' + interval '2 hours',null,'posted','dd000002-0000-4000-8000-000000000005',null),
 ('dd000003-0000-4000-8000-000000000006','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-006',5,'Had three quotes, Energywise was the most thorough and not the most expensive. Radiator swapped same week.','Martin Oakes',now() - interval '10 days',true,'Thanks Martin — appreciate the thorough comparison, glad we won you over! — Michael',now() - interval '10 days' + interval '4 hours',null,'posted','dd000002-0000-4000-8000-000000000006',null),
 ('dd000003-0000-4000-8000-000000000007','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-007',5,'Best plumber we''ve used in Glossop. Turned up when he said he would, fair price, great job.','Graham Hobson',now() - interval '6 days',true,'Thanks Graham — turning up on time shouldn''t be a bonus, but we''ll take it! — Michael',now() - interval '6 days' + interval '2 hours',null,'posted',null,null),
 ('dd000003-0000-4000-8000-000000000008','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-008',4,'Fixed a leak under the bath quickly. Only small gripe is I had to chase the invoice. Would use again though.','Denise Pritchard',now() - interval '3 days',false,null,null,'Thanks Denise — apologies for the invoice chase, that''s on us. Glad the leak is sorted! — Michael','pending_approval',null,null),
 ('dd000003-0000-4000-8000-000000000009','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zr-demo-009',5,'Annual service done, everything checked and explained. Lovely engineer.','Norma Fielding',now() - interval '1 day',false,null,null,'Thank you Norma — see you same time next year! — Michael','pending_approval',null,null);

-- Google Business Profile connection
INSERT INTO gbp_connections (business_id, zernio_profile_id, zernio_account_id, gbp_location_id, location_name, review_url, maps_url, avg_rating, total_reviews, status, connected_at, last_synced_at)
VALUES ('5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','zp-demo','za-demo','gbp-demo-001','Energywise Heating Limited','https://g.page/r/energywise-demo/review','https://maps.google.com/?cid=demo',4.9,59,'connected',now() - interval '22 days',now() - interval '1 hour')
ON CONFLICT (business_id) DO NOTHING;

-- Social templates (feed + story, preset backgrounds)
INSERT INTO social_templates (id, business_id, name, type, background_url, background_kind, card_x, card_y, card_scale, star_color, text_color, bg_color, border_color, caption_length, overlay_elements) VALUES
 ('dd000004-0000-4000-8000-000000000001','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Gold on Charcoal','feed','gradient:135,#f59e0b,#b45309','preset',0.5,0.55,1.0,'#fbbf24','#111827','#ffffff','#e5e7eb','medium','[]'),
 ('dd000004-0000-4000-8000-000000000002','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','Ocean Story','story','gradient:135,#0ea5e9,#2563eb','preset',0.5,0.5,1.1,'#fbbf24','#111827','#ffffff','#e5e7eb','short','[]');

-- Social queue: one published, two queued
INSERT INTO social_post_queue (id, business_id, review_id, template_id, post_type, caption, status, scheduled_for, published_at, priority) VALUES
 ('dd000005-0000-4000-8000-000000000001','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000003-0000-4000-8000-000000000001','dd000004-0000-4000-8000-000000000001','feed','Another happy customer in Glossop! ⭐⭐⭐⭐⭐','published',now() - interval '19 days',now() - interval '19 days',0),
 ('dd000005-0000-4000-8000-000000000002','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000003-0000-4000-8000-000000000004','dd000004-0000-4000-8000-000000000001','feed','No hot water? Sorted by lunchtime. ⭐⭐⭐⭐⭐','queued',now() + interval '1 day',null,0),
 ('dd000005-0000-4000-8000-000000000003','5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','dd000003-0000-4000-8000-000000000006','dd000004-0000-4000-8000-000000000002','story','Real reviews from real customers 🔥','queued',now() + interval '2 days',null,0);

-- Usage so the monthly tile shows activity
INSERT INTO review_usage (business_id, period_start, requests_sent)
VALUES ('5b6e8782-6f4d-4388-a47d-f4bf92ed2c3d','2026-07-01',34)
ON CONFLICT (business_id, period_start) DO UPDATE SET requests_sent = 34;

COMMIT;
