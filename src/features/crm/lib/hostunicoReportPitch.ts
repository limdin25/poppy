export type HostunicoReportPitch = {
  monthly: string;
  rent: string | null;
  difference: string | null;
  higher: boolean;
  areaEstimate: boolean;
  studioComparison: boolean;
  afterAirbnbFee: boolean;
};

export function hostunicoReportHook(pitch?: HostunicoReportPitch | null): string {
  if (!pitch?.monthly.trim()) {
    return 'We help owners manage short stays through Airbnb. Can I prepare a report comparing the estimated earnings and costs with your asking rent, and send it when it is ready?';
  }
  const basis = pitch.studioComparison
    ? 'The one-bedroom area comparison for your studio'
    : pitch.areaEstimate ? 'The area estimate' : 'The property estimate';
  const comparison = pitch.rent ? ` versus your asking rent of ${pitch.rent}` : '';
  const difference = pitch.rent && pitch.higher && pitch.difference ? ` That is ${pitch.difference} higher before those costs.` : '';
  return `${basis} shows about ${pitch.monthly} a month${comparison}. That is ${pitch.afterAirbnbFee ? 'after' : 'before'} the Airbnb fee, before our management fee and running costs.${difference} It is an estimate, not guaranteed profit. Can I send you the report?`;
}
