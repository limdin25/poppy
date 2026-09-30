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
    return 'We manage properties for short and mid-term lets through Airbnb. I can put together a report comparing the estimated Airbnb income and costs with your asking rent. Would you like me to prepare that and send it when it is ready?';
  }
  const basis = pitch.studioComparison
    ? 'So, using one-bedroom homes nearby as a rough guide for your studio, the report suggests'
    : pitch.areaEstimate ? 'So, based on local figures, the report suggests' : 'So, the property report suggests';
  const comparison = pitch.rent ? `, compared with the ${pitch.rent} you are asking` : '';
  const difference = pitch.rent && pitch.higher && pitch.difference ? ` That is ${pitch.difference} more before those costs.` : '';
  const assumptions = pitch.studioComparison ? ' We would need to refine that for your studio.' : pitch.areaEstimate ? ' We still need to confirm the property details.' : '';
  return `We manage properties for short and mid-term lets through Airbnb, and I have prepared an earnings report for your property.\n\n${basis} around ${pitch.monthly} in Airbnb income per operating month${comparison}. That is ${pitch.afterAirbnbFee ? 'after' : 'before'} the Airbnb fee, before our management fee and running costs.${difference}${assumptions} These are estimates, not guaranteed profit.\n\nWould you like me to send you the report so you can look through the numbers?`;
}
