import { CHANNEL_RULES, type Channel } from './channel-rules.js';

export interface Business {
  name: string;
  industry?: string;
  address?: string;
  phone?: string;
  website?: string;
  greeting?: string;
  tone?: string;
}

export interface Service {
  name: string;
  description?: string;
  price_from?: number;
  price_to?: number;
  bookable?: boolean;
}

export interface FAQ {
  question: string;
  answer: string;
}

export interface CallInfoType {
  name: string;
  fields: Array<{ name: string; type: string; required?: boolean }>;
  enabled: boolean;
}

export function buildSystemPrompt(
  business: Business,
  services: Service[],
  faqs: FAQ[],
  callInfoTypes: CallInfoType[],
  channel?: Channel,
  knowledgeContent?: string,
): string {
  const sections: string[] = [];

  // Identity
  sections.push(`# You are the AI receptionist for ${business.name}`);

  // Business details
  const details: string[] = [];
  if (business.industry) details.push(`Industry: ${business.industry}`);
  if (business.address) details.push(`Address: ${business.address}`);
  if (business.phone) details.push(`Phone: ${business.phone}`);
  if (business.website) details.push(`Website: ${business.website}`);
  if (details.length > 0) {
    sections.push(`## Business details\n${details.join('\n')}`);
  }

  // Greeting
  if (business.greeting) {
    sections.push(`## Greeting\nWhen a conversation starts, greet the caller with:\n"${business.greeting}"`);
  }

  // Tone
  const tone = business.tone || 'professional';
  sections.push(`## Tone\nSpeak in a ${tone} tone throughout the conversation.`);

  // Services
  if (services.length > 0) {
    const serviceLines = services.map((s) => {
      let line = `- **${s.name}**`;
      if (s.description) line += `: ${s.description}`;
      if (s.price_from != null && s.price_to != null) {
        line += ` (from £${s.price_from} to £${s.price_to})`;
      } else if (s.price_from != null) {
        line += ` (from £${s.price_from})`;
      }
      if (s.bookable) line += ' [BOOKABLE]';
      return line;
    });
    sections.push(`## Services offered\n${serviceLines.join('\n')}`);
  }

  // FAQs
  if (faqs.length > 0) {
    const faqLines = faqs.map((f) => `**Q: ${f.question}**\nA: ${f.answer}`);
    sections.push(`## Frequently Asked Questions\n${faqLines.join('\n\n')}`);
  }

  // Call info types
  const enabled = callInfoTypes.filter((c) => c.enabled);
  if (enabled.length > 0) {
    const infoLines = enabled.map((c) => {
      const fields = c.fields
        .map((f) => `  - ${f.name} (${f.type})${f.required ? ' *required*' : ''}`)
        .join('\n');
      return `### ${c.name}\nCollect the following:\n${fields}`;
    });
    sections.push(`## Information to collect\n${infoLines.join('\n\n')}`);
  }

  // Knowledge base
  if (knowledgeContent?.trim()) {
    sections.push(`## Knowledge base\nUse the following information to answer caller questions:\n${knowledgeContent.trim()}`);
  }

  // Qualification (only when bookable services exist)
  const hasBookable = services.some((s) => s.bookable);
  if (hasBookable) {
    sections.push(`## Qualification
When a caller wants to book a service marked [BOOKABLE], collect the following BEFORE offering appointment times:
1. **Postcode** — to confirm they're in the service area
2. **Issue details** — what specifically needs doing
3. **Urgency** — is it an emergency (today), within a few days, or just planning ahead

Ask these naturally during the conversation, one at a time. Once you have all three, use the check_availability tool to find available slots and offer the caller up to 3 options.

If the caller doesn't want to book right now, take their name and number and let them know someone will follow up with available times.`);
  }

  // Behaviour rules
  sections.push(`## Behaviour rules
- NEVER make up information. If you don't know, say so and offer to have someone call back.
- NEVER quote a price unless it is listed above. Say "I can get a quote sent over to you" instead.
- NEVER book or confirm an appointment unless the service is marked [BOOKABLE].
- NEVER share internal business information, staff personal details, or financial data.
- NEVER argue with the caller. Stay polite and de-escalate.
- If the caller asks something outside your knowledge, take their details and say someone will be in touch.
- Always confirm spelling of names and repeat back phone numbers/emails.
- If the caller wants to speak to a human, acknowledge their request and explain someone will call them back shortly.`);

  // Channel-specific rules
  if (channel && CHANNEL_RULES[channel]) {
    sections.push(CHANNEL_RULES[channel]);
  }

  return sections.join('\n\n');
}
