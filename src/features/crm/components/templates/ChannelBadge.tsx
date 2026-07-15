export type TemplateChannel = 'sms' | 'whatsapp' | 'email';

export default function ChannelBadge({ channel }: { channel: TemplateChannel | null }) {
  if (channel === null) {
    return (
      <span className="text-[9px] uppercase font-bold tracking-wide text-[#9CA3AF] bg-[#F3F3EE] px-1.5 py-0.5 rounded">
        any
      </span>
    );
  }
  const styles: Record<TemplateChannel, { bg: string; fg: string; label: string }> = {
    sms:      { bg: '#DBEAFE', fg: '#1D4ED8', label: 'SMS' },
    whatsapp: { bg: '#D1FAE5', fg: '#065F46', label: 'WhatsApp' },
    email:    { bg: '#FEF3C7', fg: '#B45309', label: 'Email' },
  };
  const s = styles[channel];
  return (
    <span
      className="text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
