import { reportRecipientQuestion } from './hostunico-phone.ts';

export type HostunicoReportPitch = {
  monthlyGbpPence?: number;
  askingRentGbpPence?: number | null;
  eligibility?: 'eligible' | 'excluded' | 'pending';
  planning?: boolean;
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
  if (pitch?.eligibility === 'excluded' || pitch?.eligibility === 'pending') return 'Do not pitch this property. Research must show at least 30% above the asking rent. Move to the next qualified lead.';
  if (pitch?.planning) return "We partner with landlords for short-term lets through Airbnb, and we run the entire process. I've put together an initial report comparing your asking rent with what short lets would need to bring in. Would you like me to send it so you can have a look?";
  if (!pitch?.monthly.trim()) {
    return 'We partner with landlords for short-term lets through Airbnb, and we run the entire process. I can put together a report showing what your property could make. Would you like me to prepare that and send it when it is ready?';
  }
  const comparison = pitch.rent ? `, compared with the ${pitch.rent} you're asking` : '';
  return `We partner with landlords for short-term lets through Airbnb, and we run the entire process. I've put together a report for your property, and it shows you could make around ${pitch.monthly} a month${comparison}.\n\nWould you like me to send you the report so you can have a look and see if it's something you'd like to explore?`;
}
