import { supabase } from '@/integrations/supabase/browser';

export async function saveServices(businessId: string, services: string[]) {
  const { error: delErr } = await supabase.from('services').delete().eq('business_id', businessId);
  if (delErr) throw new Error(delErr.message);

  if (services.length === 0) return;

  const { error: insErr } = await supabase.from('services').insert(
    services.map((name, i) => ({ business_id: businessId, name, sort_order: i }))
  );
  if (insErr) throw new Error(insErr.message);
}

export async function saveFAQs(businessId: string, faqs: { question: string; answer: string }[]) {
  const { error: delErr } = await supabase.from('faqs').delete().eq('business_id', businessId);
  if (delErr) throw new Error(delErr.message);

  if (faqs.length === 0) return;

  const { error: insErr } = await supabase.from('faqs').insert(
    faqs.map((f, i) => ({ business_id: businessId, question: f.question, answer: f.answer, sort_order: i }))
  );
  if (insErr) throw new Error(insErr.message);
}

export async function saveGreeting(businessId: string, greeting: string) {
  const { error } = await supabase.from('businesses').update({ greeting }).eq('id', businessId);
  if (error) throw new Error(error.message);
}

export async function saveCallInfoFields(businessId: string, fields: { label: string; enabled: boolean }[]) {
  const { error: delErr } = await supabase.from('call_info_types').delete().eq('business_id', businessId);
  if (delErr) throw new Error(delErr.message);

  if (fields.length === 0) return;

  const { error: insErr } = await supabase.from('call_info_types').insert(
    fields.map((f, i) => ({ business_id: businessId, name: f.label, enabled: f.enabled, sort_order: i }))
  );
  if (insErr) throw new Error(insErr.message);
}
