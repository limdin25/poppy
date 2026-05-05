export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#?\w+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripQuotedReply(text: string): string {
  const inlineMatch = text.match(/\s+On\s.{5,120}\swrote:\s*/i);
  if (inlineMatch && inlineMatch.index !== undefined) {
    text = text.substring(0, inlineMatch.index);
  }

  const lines = text.split('\n');
  const cutPatterns = [
    /^On .{5,80} wrote:\s*$/i,
    /^-{3,}\s*Original Message\s*-{3,}/i,
    /^From:\s*.+/i,
    /^_{3,}/,
    /^>{3,}/,
    /^\*{3,}/,
  ];

  let cutIndex = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (cutPatterns.some((p) => p.test(line))) {
      cutIndex = i;
      break;
    }
    if (line.startsWith('>') && i > 0 && lines[i - 1].trim() === '') {
      cutIndex = i;
      break;
    }
  }

  return lines
    .slice(0, cutIndex)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanEmailBody(text: string): string {
  let cleaned = stripQuotedReply(text);
  cleaned = cleaned.replace(/\(\s*https?:\/\/\S{80,}\s*\)/g, '');
  cleaned = cleaned.replace(/https?:\/\/\S{120,}/g, '[link]');
  cleaned = cleaned.replace(/^\*{5,}\s*$/gm, '');
  cleaned = cleaned.replace(/^-{5,}\s*$/gm, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

export function isEmailSpam(fromEmail: string, subject: string, body: string): boolean {
  const lowerFrom = fromEmail.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase().slice(0, 3000);

  const spamPrefixes = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster'];
  if (spamPrefixes.some((p) => lowerFrom.startsWith(p))) return true;

  const marketingDomains = ['mailchimp.com', 'sendgrid.net', 'constantcontact.com', 'hubspot.com'];
  if (marketingDomains.some((d) => lowerFrom.includes(d))) return true;

  const spamPhrases = ['unsubscribe from this list', 'click here to unsubscribe', 'opt out of future'];
  if (spamPhrases.some((p) => lowerBody.includes(p))) return true;

  const spamSubjects = ['your subscription', 'promotional', 'limited time offer'];
  if (spamSubjects.some((s) => lowerSubject.includes(s))) return true;

  return false;
}

export function normalizeSubject(subject: string): string {
  if (!subject) return '';
  let s = subject;
  while (/^(Re|Fwd|Fw):\s*/i.test(s)) {
    s = s.replace(/^(Re|Fwd|Fw):\s*/i, '');
  }
  return s.trim().toLowerCase();
}
