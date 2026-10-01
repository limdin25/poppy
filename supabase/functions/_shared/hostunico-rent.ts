export function hostunicoAdvertisedRent(source: string | null | undefined, monthly: number | null | undefined): string {
  const money = (n: number) => `£${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  if (!source) return monthly && Number.isFinite(monthly) && monthly > 0 ? `${money(monthly)} a month` : '';
  const match = source.trim().match(/^£?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(pw|pcm|per week|per month|a week|a month)$/i);
  if (!match) return 'a price that needs checking';
  const amount = Number(match[1].replaceAll(',', ''));
  const weekly = /pw|week/i.test(match[2]);
  const equivalent = Math.round(amount * (weekly ? 52 / 12 : 1) * 100) / 100;
  if (!monthly || !Number.isFinite(monthly) || amount <= 0 || Math.abs(equivalent - monthly) > 0.011) return 'a price that needs checking';
  return weekly ? `${money(amount)} a week, around ${money(Math.round(equivalent))} a month` : `${money(amount)} a month`;
}

export function hostunicoRentQuestion(question: string): boolean {
  return /\b(week|weekly|pw)\b.*\b(month|monthly|pcm)\b|\b(month|monthly|pcm)\b.*\b(week|weekly|pw)\b/i.test(question);
}

export function hostunicoRentExplanation(source: string | null | undefined, monthly: number | null | undefined): string | null {
  const spoken = hostunicoAdvertisedRent(source, monthly);
  if (!spoken.includes('a week, around')) return null;
  const [week, month] = spoken.split(', around ');
  return `The advert says ${week}. That works out to around ${month}, using 52 weeks divided by 12.`;
}
