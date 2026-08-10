-- Property agreement: salary is released every Saturday and sent by Wise.
--
-- Hugo changed the pay terms on 2026-08-10. This replaces the "When you get
-- paid" clause that had been copied across from the B2B closer agreement
-- (Friday close, paid within 72 hours, in practice Monday morning). The new
-- promise is tighter: released the day after the week closes, with a friendly
-- ask to allow until midnight on Saturday for the transfer to land.
--
-- "Direct debit" was deliberately not used. A direct debit is a company pulling
-- money OUT of an account, which is the opposite of paying a contractor. The
-- mechanism is Wise, and the clause names it.
--
-- SCOPE: the 'property' row only, and only the one clause. Every other section
-- keeps its exact wording and position. The 'sales-closer' agreement is not
-- touched: Payoneer and Monday may well still be right for those agents, and
-- that is a separate decision for Hugo.
--
-- Pedro signed version 2 (the Monday wording) at 11:21 UTC on 2026-08-10.
-- His row in wk_agreement_signatures is a snapshot taken at signing time and is
-- NOT affected by this update. It must keep reading Monday, because that is
-- what he actually agreed to. This edit moves the LIVE agreement to version 3
-- (bumped by the wk_agent_agreement_bump_version trigger) and nothing else.

UPDATE wk_agent_agreement
   SET terms = (
     SELECT jsonb_agg(
              CASE WHEN t->>'heading' = 'When you get paid'
                   THEN jsonb_build_object(
                          'heading', 'When you get paid',
                          'body',    'Your work week closes on Friday and your salary is released the next day, every Saturday. It is sent to you by Wise, and because a transfer takes a little time to land, please allow until midnight on Saturday for it to arrive before worrying. It is on its way. You just need to set up your Wise details first, and we will email you simple instructions.'
                        )
                   ELSE t
              END
              ORDER BY ord
            )
     FROM jsonb_array_elements(terms) WITH ORDINALITY AS a(t, ord)
   )
 WHERE slug = 'property';
