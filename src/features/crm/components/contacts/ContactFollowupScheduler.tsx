import { useState } from 'react';
import { Clock, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsTemplates } from '../../hooks/useSmsTemplates';

/**
 * Schedule a follow-up SMS (or agreement) to a lead for later. Reuses the
 * send_sms job queue; the worker auto-cancels the send if the lead replies
 * first. Agreements are just templates with a link in the body.
 */
const DELAYS = [
  { label: 'In 1 hour', hours: 1 },
  { label: 'Tomorrow', hours: 24 },
  { label: 'In 3 days', hours: 72 },
  { label: 'In 1 week', hours: 168 },
];

export default function ContactFollowupScheduler({ contactId }: { contactId: string }) {
  const { items } = useSmsTemplates();
  const templates = items.filter((t) => t.channel === null || t.channel === 'sms');
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const schedule = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await supabase.functions.invoke('wk-schedule-send', {
        body: { contact_id: contactId, body, delay_hours: hours, auto_cancel_on_reply: true },
      });
      setDone(true); setBody(''); setOpen(false);
      setTimeout(() => setDone(false), 2500);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">Follow-up</div>
      {!open ? (
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[13px] text-[#3C5A87] font-medium">
          <Clock className="w-3.5 h-3.5" /> {done ? 'Scheduled ✓' : 'Schedule a follow-up'}
        </button>
      ) : (
        <div className="space-y-2">
          <select onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setBody(t.body_md); }}
            className="w-full text-[12px] border border-[#E5E7EB] rounded-lg px-2 py-1.5 bg-white">
            <option value="">— template (optional) —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Message or agreement link…"
            className="w-full text-[12px] border border-[#E5E7EB] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30" />
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}
            className="w-full text-[12px] border border-[#E5E7EB] rounded-lg px-2 py-1.5 bg-white">
            {DELAYS.map((d) => <option key={d.hours} value={d.hours}>{d.label}</option>)}
          </select>
          <div className="flex gap-1.5">
            <button onClick={schedule} disabled={busy || !body.trim()}
              className="flex items-center gap-1 text-[12px] font-semibold text-white bg-[#3C5A87] disabled:opacity-40 px-2.5 py-1 rounded-lg">
              <Check className="w-3 h-3" /> Schedule
            </button>
            <button onClick={() => setOpen(false)} className="text-[12px] text-[#6B7280] px-2.5 py-1 rounded-lg border border-[#E5E7EB]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
