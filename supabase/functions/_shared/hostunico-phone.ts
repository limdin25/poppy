export function reportPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^[+\d\s().-]+$/.test(raw)) return null;
  let phone = raw.replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  else if (phone.startsWith('0')) phone = '+44' + phone.slice(1);
  else if (/^\d/.test(phone)) phone = '+' + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export function reportPhoneKind(raw: unknown): 'mobile' | 'landline' | 'unknown' | 'invalid' {
  const phone = reportPhone(raw);
  if (!phone) return 'invalid';
  if (!phone.startsWith('+44')) return 'unknown';
  // 070 is personal numbering and 076 is usually paging, not a UK mobile.
  return /^\+447[1-57-9]\d{8}$/.test(phone) ? 'mobile' : 'landline';
}

export function reportRecipientQuestion(phone?: string, savedMobile?: string | null): string {
  const calling = reportPhone(phone);
  const mobile = reportPhone(savedMobile);
  if (mobile && mobile !== calling) return `Can I text the report to your mobile ending ${mobile.slice(-4)}?`;
  if ((mobile && mobile === calling) || reportPhoneKind(phone) === 'mobile') return 'Can I send the report by text to this number?';
  return 'What mobile number can I text the report to? Or would you prefer email?';
}
