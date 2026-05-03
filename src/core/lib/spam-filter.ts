export function isSpamEmail(
  fromEmail: string,
  _fromName: string,
  subject: string,
  body: string,
): boolean {
  const lowerFrom = fromEmail.toLowerCase();
  const lowerBody = body.toLowerCase().slice(0, 3000);

  const spamSenderPrefixes = [
    'noreply@', 'no-reply@', 'newsletter@', 'marketing@', 'promo@',
    'notifications@', 'digest@', 'updates@', 'mailer@', 'bulk@',
    'campaign@',
  ];

  const spamSenderDomains = [
    'cyberimpact.com', 'skool.com', 'etsy.com', 'mailchimp.com',
    'sendgrid.net', 'constantcontact.com', 'hubspot.com', 'klaviyo.com',
    'mailerlite.com', 'convertkit.com', 'signalheadline.com',
    'theharmonydiaries.com', 'substack.com', 'beehiiv.com',
  ];

  if (spamSenderPrefixes.some(p => lowerFrom.startsWith(p))) return true;
  if (spamSenderDomains.some(d => lowerFrom.includes(d))) return true;

  if (
    lowerBody.includes('unsubscribe') ||
    lowerBody.includes('opt out') ||
    lowerBody.includes('opt-out') ||
    lowerBody.includes('manage your preferences') ||
    lowerBody.includes('email preferences') ||
    lowerBody.includes('manage preferences') ||
    lowerBody.includes('view in browser') ||
    lowerBody.includes('view this email in')
  ) {
    return true;
  }

  const spamSubjectPatterns = [
    /\$\d+.*waiting/i,
    /finalize receipt/i,
    /claim your/i,
    /act now/i,
    /limited time/i,
    /congratulations/i,
    /you('ve| have) been selected/i,
    /winner/i,
    /free gift/i,
    /lbs per day/i,
    /weight loss/i,
    /new notifications? since/i,
    /\d+ new notifications/i,
  ];
  if (spamSubjectPatterns.some(p => p.test(subject))) return true;

  const spamBodySignals = [
    /eliminate.*pain/i,
    /restore energy/i,
    /lose \d+ lbs/i,
    /miracle cure/i,
    /limited offer/i,
    /click here to claim/i,
    /wire transfer/i,
    /dear (sir|madam|friend|winner)/i,
    /you have been chosen/i,
  ];
  const bodyHits = spamBodySignals.filter(p => p.test(body)).length;
  if (bodyHits >= 2) return true;

  return false;
}
