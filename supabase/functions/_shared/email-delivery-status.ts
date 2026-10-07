// Resend tells the CRM what happened to an email the CRM sent. Hugo, 7 Oct:
// five of Pedro's fourteen report emails bounced and the CRM still said
// "queued", so nobody knew. The Resend account is shared with other products,
// so an email the CRM did not send matches no row and is simply ignored.
export function emailDeliveryUpdate(type: string | undefined): { status: 'bounced' | 'delivered'; from: string[] | null } | null {
  // A bounce always wins. A late "delivered" never hides a bounce.
  if (type === 'email.bounced') return { status: 'bounced', from: null };
  if (type === 'email.delivered') return { status: 'delivered', from: ['queued', 'sent', 'sending'] };
  return null;
}

export async function recordEmailDelivery(db: any, type: string | undefined, emailId: string): Promise<{ matched: number }> {
  const update = emailDeliveryUpdate(type);
  if (!update || !emailId) return { matched: 0 };
  let messages = db.from('wk_sms_messages').update({ status: update.status })
    .eq('external_id', emailId).eq('channel', 'email').eq('direction', 'outbound');
  if (update.from) messages = messages.in('status', update.from);
  const sent = await messages.select('id');
  // A bounced report email unlocks the report panel so Pedro can fix the address and send again.
  let reports = db.from('sa_property_reports').update({ email_state: update.status }).eq('email_id', emailId);
  if (update.from) reports = reports.in('email_state', update.from);
  const report = await reports.select('listing_id');
  if (sent.error || report.error) throw new Error('Email delivery status could not be saved.');
  return { matched: (sent.data?.length ?? 0) + (report.data?.length ?? 0) };
}
