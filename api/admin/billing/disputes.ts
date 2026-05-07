import { supabaseAdmin } from '../../../src/integrations/supabase/client.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
  if (!user?.email) return new Response('Unauthorized', { status: 401 });

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single();
  if (!admin) return new Response('Forbidden', { status: 403 });

  if (req.method === 'GET') return handleList();
  if (req.method === 'POST') return handleResolve(req, user.email);
  return new Response('Method not allowed', { status: 405 });
}

async function handleList() {
  const { data, error } = await supabaseAdmin
    .from('booking_disputes')
    .select('*, booking_event:booking_events(contact_name, service_description, amount_billed, created_at, channel), business:businesses(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ disputes: data || [] });
}

async function handleResolve(req: Request, adminEmail: string) {
  const { dispute_id, action } = await req.json() as {
    dispute_id: string;
    action: 'approve' | 'reject';
  };

  if (!dispute_id || !action) {
    return Response.json({ error: 'dispute_id and action required' }, { status: 400 });
  }

  const { data: dispute } = await supabaseAdmin
    .from('booking_disputes')
    .select('*, booking_event:booking_events(billing_period_id, amount_billed)')
    .eq('id', dispute_id)
    .eq('status', 'pending')
    .single();

  if (!dispute) {
    return Response.json({ error: 'Dispute not found or already resolved' }, { status: 404 });
  }

  if (action === 'approve') {
    const creditAmount = dispute.credit_amount || (dispute as any).booking_event?.amount_billed || 0;

    await supabaseAdmin.from('booking_disputes').update({
      status: 'approved',
      credit_amount: creditAmount,
      resolved_by: adminEmail,
      resolved_at: new Date().toISOString(),
    }).eq('id', dispute_id);

    const periodId = (dispute as any).booking_event?.billing_period_id;
    if (periodId && creditAmount > 0) {
      const { data: period } = await supabaseAdmin
        .from('billing_periods')
        .select('total_amount, booking_count')
        .eq('id', periodId)
        .single();

      if (period) {
        await supabaseAdmin.from('billing_periods').update({
          total_amount: Math.max(0, parseFloat(period.total_amount as any) - creditAmount),
          booking_count: Math.max(0, (period.booking_count || 0) - 1),
        }).eq('id', periodId);
      }
    }
  } else {
    await supabaseAdmin.from('booking_disputes').update({
      status: 'rejected',
      resolved_by: adminEmail,
      resolved_at: new Date().toISOString(),
    }).eq('id', dispute_id);
  }

  return Response.json({ ok: true, action });
}
