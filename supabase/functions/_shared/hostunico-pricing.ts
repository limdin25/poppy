// Display and coaching only. Never import this into a charging path.
export function hostunicoCountry(country?: string | null, phone?: string | null) {
  const code = country?.trim().toUpperCase();
  if (code === 'UK' || code === 'GB' || code === 'UNITED KINGDOM') return 'GB';
  if (code && /^[A-Z]{2}$/.test(code)) return code;
  return phone?.startsWith('+') && !phone.startsWith('+44') ? 'US' : 'GB';
}
export function hostunicoPriceCopy(country = 'GB') {
  const software = hostunicoCountry(country) === 'GB' ? '£29' : '$29';
  return `Management fee: 9% of booking revenue.\nVAT: 20% of the management fee, added separately.\nSoftware is free in month one, then ${software} a month from month two, on top of management. The fee covers booking revenue including guest-paid cleaning. Actual cleaning, platform fees and property costs are separate. VAT registration is pending; current billing remains 9% until registration is confirmed.`;
}
