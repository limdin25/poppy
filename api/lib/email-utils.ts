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

export function isEmailSpam(fromEmail: string, subject: string, body: string, htmlBody?: string): boolean {
  const lowerFrom = fromEmail.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase().slice(0, 3000);

  // Never treat mail from our own sending domains as spam (our brand / personas).
  const OWN_DOMAINS = ['heypubli.com', 'heyelsie.com'];
  const fromDomain = lowerFrom.split('@')[1] || '';
  if (OWN_DOMAINS.includes(fromDomain)) return false;

  const spamPrefixes = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster', 'notifications', 'newsletter', 'info@', 'team@', 'updates@', 'news@'];
  if (spamPrefixes.some((p) => lowerFrom.startsWith(p))) return true;

  const marketingDomains = ['mailchimp.com', 'sendgrid.net', 'constantcontact.com', 'hubspot.com', 'klaviyo.com', 'klclick', 'mailgun.org', 'convertkit', 'beehiiv.com'];
  if (marketingDomains.some((d) => lowerFrom.includes(d))) return true;

  const spamPhrases = ['unsubscribe from this list', 'click here to unsubscribe', 'opt out of future', 'manage your preferences', 'email preferences', 'update your preferences'];
  if (spamPhrases.some((p) => lowerBody.includes(p))) return true;

  const spamSubjects = ['your subscription', 'promotional', 'limited time offer', 'exclusive offer', 'don\'t miss'];
  if (spamSubjects.some((s) => lowerSubject.includes(s))) return true;

  // HTML body with unsubscribe link = marketing email
  if (htmlBody) {
    const lowerHtml = htmlBody.toLowerCase();
    if (lowerHtml.includes('unsubscribe') || lowerHtml.includes('opt-out') || lowerHtml.includes('email preferences')) {
      return true;
    }
  }

  return false;
}

export function extractUnsubscribeUrls(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  let match: RegExpExecArray | null;

  // 1. URL itself contains unsubscribe keywords
  const hrefPattern = /href=["']([^"']*(?:unsub|opt[_-]?out|remove[_-]?me|manage[_-]?prefer)[^"']*)["']/gi;
  while ((match = hrefPattern.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, '&');
    if (url.startsWith('http')) urls.push(url);
  }

  // 2. Link anchor text contains "unsubscribe"
  const anchorUnsub = /<a\s[^>]*href=["']([^"']+)["'][^>]*>[^<]*unsub[^<]*<\/a>/gi;
  while ((match = anchorUnsub.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, '&');
    if (url.startsWith('http') && !urls.includes(url)) urls.push(url);
  }

  // 3. href near "unsubscribe" text (within 500 chars)
  if (urls.length === 0) {
    const unsubIdx: number[] = [];
    const unsubFind = /unsub(?:scribe)?/gi;
    while ((match = unsubFind.exec(html)) !== null) {
      unsubIdx.push(match.index);
    }
    for (const idx of unsubIdx) {
      const start = Math.max(0, idx - 500);
      const end = Math.min(html.length, idx + 500);
      const context = html.slice(start, end);
      const hrefInContext = /href=["']([^"']+)["']/gi;
      while ((match = hrefInContext.exec(context)) !== null) {
        const url = match[1].replace(/&amp;/g, '&');
        if (url.startsWith('http') && !urls.includes(url) && !url.includes('mailto:')) {
          urls.push(url);
        }
      }
    }
  }

  return [...new Set(urls)];
}

export function normalizeSubject(subject: string): string {
  if (!subject) return '';
  let s = subject;
  while (/^(Re|Fwd|Fw):\s*/i.test(s)) {
    s = s.replace(/^(Re|Fwd|Fw):\s*/i, '');
  }
  return s.trim().toLowerCase();
}
