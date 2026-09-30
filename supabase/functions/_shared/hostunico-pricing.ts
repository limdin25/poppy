// Display and coaching only. Never import this into a charging path.
export function hostunicoCountry(country?: string | null, phone?: string | null) {
  const code = country?.trim().toUpperCase();
  if (code === 'UK' || code === 'GB' || code === 'UNITED KINGDOM') return 'GB';
  if (code && /^[A-Z]{2}$/.test(code)) return code;
  return phone?.startsWith('+') && !phone.startsWith('+44') ? 'US' : 'GB';
}
export function hostunicoPriceCopy(country = 'GB') {
  return `Our management fee is 9% + VAT. ${hostunicoSoftwareCopy(country)}`;
}
export function hostunicoSoftwareCopy(country = 'GB') {
  const software = hostunicoCountry(country) === 'GB' ? '£29' : '$29';
  return `Software is free in month one, then ${software} a month from month two, on top of management.`;
}
