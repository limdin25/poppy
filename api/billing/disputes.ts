import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleList(req);
  if (req.method === 'POST') return handleCreate(req);
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

async function handleList(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const { data, error } = await supabase
    .from('booking_disputes')
    .select('*, booking_event:booking_events(contact_name, service_description, amount_billed, created_at)')
    .eq('business_id', auth.businessId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ disputes: data || [] }), { status: 200 });
}

async function handleCreate(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const { booking_event_id, reason, description } = await req.json() as {
    booking_event_id: string;
    reason: string;
    description?: string;
  };

  if (!booking_event_id || !reason) {
    return new Response(JSON.stringify({ error: 'booking_event_id and reason required' }), { status: 400 });
  }

  const validReasons = ['ai_error', 'wrong_time', 'wrong_service', 'duplicate', 'other'];
  if (!validReasons.includes(reason)) {
    return new Response(JSON.stringify({ error: 'Invalid reason' }), { status: 400 });
  }

  const { data: booking } = await supabase
    .from('booking_events')
    .select('id, business_id, amount_billed')
    .eq('id', booking_event_id)
    .eq('business_id', auth.businessId)
    .single();

  if (!booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404 });
  }

  const { data: existingDispute } = await supabase
    .from('booking_disputes')
    .select('id')
    .eq('booking_event_id', booking_event_id)
    .neq('status', 'rejected')
    .maybeSingle();

  if (existingDispute) {
    return new Response(JSON.stringify({ error: 'Dispute already exists for this booking' }), { status: 409 });
  }

  const { data: dispute, error } = await supabase
    .from('booking_disputes')
    .insert({
      business_id: auth.businessId,
      booking_event_id,
      reason,
      description: description || null,
      credit_amount: booking.amount_billed,
    })
    .select('*')
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, dispute }), { status: 201 });
}
