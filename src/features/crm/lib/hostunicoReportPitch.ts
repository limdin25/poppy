import { reportRecipientQuestion } from '../../../../supabase/functions/_shared/hostunico-phone';

export type HostunicoReportPitch = {
  monthly: string;
  rent: string | null;
  difference: string | null;
  higher: boolean;
  areaEstimate: boolean;
  studioComparison: boolean;
  afterAirbnbFee: boolean;
};

export function hostunicoReportIntroduction(): string {
  return 'Okay, thanks. Have you got one minute for me to explain why I called?';
}

export function hostunicoReportRecipient(phone?: string, savedMobile?: string | null): string {
  return `Perfect. ${reportRecipientQuestion(phone, savedMobile)}`;
}

export function hostunicoReportHook(pitch?: HostunicoReportPitch | null): string {
  if (!pitch?.monthly.trim()) {
    return 'We manage properties for short-term lets through Airbnb. I can put together a report showing what your property could make. Would you like me to prepare that and send it when it is ready?';
  }
  const comparison = pitch.rent ? `, compared with the ${pitch.rent} you're asking` : '';
  return `We manage properties for short-term lets through Airbnb. I've put together a report for your property, and it shows you could make around ${pitch.monthly} a month${comparison}.\n\nWould you like me to send you the report so you can have a look and see if it's something you'd like to explore?`;
}
