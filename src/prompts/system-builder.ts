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

  // Identity + current date so the model knows the real date/year
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' });
  sections.push(`# You are the AI receptionist for ${business.name}\n\nToday is ${dayName}, ${today}. Working days are Monday to Friday. Weekends (Saturday and Sunday) are not available for bookings — if a caller asks for a weekend, explain that and offer the next working day instead. Never say "fully booked" for weekends.`);

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
    sections.push(`## Greeting\nWhen a conversation starts, greet the caller with:\n"${business.greeting}"\nAfter greeting, STOP and WAIT for the caller to speak. Do not continue until they respond.`);
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

  // Booking instructions (only when bookable services exist)
  const hasBookable = services.some((s) => s.bookable);
  if (hasBookable) {
    sections.push(`## Booking
When a caller wants to book a service marked [BOOKABLE]:
1. Ask what the meeting or appointment is about (briefly).
2. Use the check_availability tool to find available slots. Offer the caller up to 3 options.
3. Once the caller confirms a slot, use the book_appointment tool to book it.

If the check_availability tool returns zero slots (e.g. weekends or fully booked days), do NOT say you cannot check — instead say something like "It looks like we're fully booked for those dates. Let me check the next few days…" and try again with a wider date range (e.g. the next 5 working days). If still no slots, offer to take the caller's details and have someone call back with available times.

If the caller doesn't want to book right now, take their name and let them know someone will follow up with available times.`);
  }

  // Caller phone handling
  sections.push(`## Caller phone number
You already have the caller's phone number from the inbound call: {{from_number}}
- Do NOT ask for their phone number — you already have it.
- Instead, confirm: "Is this the best number to reach you on?" or "Can we contact you on this number?"
- If they say yes, use {{from_number}} as their contact number.
- If they say no, ask what number they'd prefer.
- When booking, always pass the caller's phone number to the booking tool.`);

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
