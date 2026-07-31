-- Migration 011: atomic, race-safe removal of a refunded sale from an UNPAID payout.
--
-- The refund webhook previously did a stale read-then-unguarded-write, opening:
--   (a) a TOCTOU where a refund landing during admin "Marcar como pago" rewrote the
--       total of an already-PAID payout and wiped the sale's payout_id; and
--   (b) a double-decrement under concurrent / duplicate PURCHASE_REFUNDED deliveries.
-- This moves the release+reduce into a single function that takes row locks (FOR UPDATE)
-- so the decrement is serialized and computed from the CURRENT value. The payout is only
-- touched while it is still 'requested'; an already-paid payout keeps the sale attached
-- as the clawback audit trail and returns 'clawback_needed'.

create or replace function public.release_refunded_sale(p_transaction_id text)
returns text as $$
declare
  v_sale   record;
  v_payout record;
begin
  -- Lock the sale row so concurrent refunds for the same transaction serialize.
  select id, commission_amount, payout_id into v_sale
  from public.hotmart_sales
  where transaction_id = p_transaction_id
  for update;

  if not found or v_sale.payout_id is null then
    return 'noop';
  end if;

  -- Lock the payout row so a concurrent mark-paid cannot interleave.
  select status, commission_amount, sales_count into v_payout
  from public.payouts
  where id = v_sale.payout_id
  for update;

  if not found then
    return 'noop';
  end if;

  -- Already paid/cancelled → leave the sale attached as the clawback audit trail.
  if v_payout.status <> 'requested' then
    return 'clawback_needed';
  end if;

  -- Still 'requested' (and locked): detach the sale and decrement from the live value.
  update public.hotmart_sales set payout_id = null where id = v_sale.id;
  update public.payouts
     set commission_amount = greatest(0, commission_amount - v_sale.commission_amount),
         sales_count       = greatest(0, sales_count - 1)
   where id = v_sale.payout_id;

  return 'released';
end;
$$ language plpgsql security definer;

-- Money mutation — only the service role (the webhook) may call it, never influencers.
revoke all on function public.release_refunded_sale(text) from public, anon, authenticated;
grant execute on function public.release_refunded_sale(text) to service_role;
