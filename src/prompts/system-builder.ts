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
  timezone?: string,
  workingDays?: string[],
  assistantMode = false,
): string {
  const sections: string[] = [];

  const tz = timezone || 'Europe/London';
  const days = workingDays?.length ? workingDays : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const fullDayNames: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const offDays = allDays.filter(d => !days.includes(d));

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const currentTime = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

  let scheduleNote: string;
  if (offDays.length === 0) {
    scheduleNote = `Working days are ${days.join(', ')} (every day of the week).`;
  } else if (days.length === 5 && !days.includes('Sat') && !days.includes('Sun')) {
    scheduleNote = `Working days are Monday to Friday. Weekends (Saturday and Sunday) are not available for bookings — if a caller asks for a weekend, explain that and offer the next working day instead. Never say "fully booked" for weekends.`;
  } else {
    scheduleNote = `Working days are ${days.join(', ')}. ${offDays.map(d => fullDayNames[d]).join(' and ')} ${offDays.length === 1 ? 'is' : 'are'} not available for bookings.`;
  }

  if (assistantMode) {
    // Personal-assistant persona: no business/receptionist framing at all.
    sections.push(`# You are a warm, capable personal assistant\n\nYou answer the phone and handle messages on behalf of the person you work for — like a friendly human PA. You are NOT a business, a company, or a receptionist. Never call yourself a receptionist, and never talk about "our business", "our company", "our services" or "our prices". Your own name and who you work for are given in your instructions below.\n\nToday is ${dayName}, ${today}. The current time is ${currentTime} (${tz}). Working days are ${days.join(', ')}.\n\nYour timezone is ${tz}. Treat all times as ${tz} local time.`);
  } else {
    sections.push(`# You are the AI receptionist for ${business.name}\n\nToday is ${dayName}, ${today}. The current time is ${currentTime} (${tz}). ${scheduleNote}\n\nYour timezone is ${tz}. All times in this conversation should be treated as ${tz} local time.`);

    // Business details
    const details: string[] = [];
    if (business.industry) details.push(`Industry: ${business.industry}`);
    if (business.address) details.push(`Address: ${business.address}`);
    if (business.phone) details.push(`Phone: ${business.phone}`);
    if (business.website) details.push(`Website: ${business.website}`);
    if (details.length > 0) {
      sections.push(`## Business details\n${details.join('\n')}`);
    }
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

**IMPORTANT — Time handling:**
- The check_availability tool returns slot times in **UTC (ISO 8601)**.
- Your timezone is **${tz}**. Convert UTC times to ${tz} local time when speaking to the caller.
- When the caller says a time (e.g. "3pm"), they mean ${tz} local time.
- When passing start_time to book_appointment, you MUST use the exact UTC ISO 8601 string from the check_availability result — do NOT convert the caller's spoken time to UTC yourself.
- Example: if a slot is "2026-05-11T14:00:00.000Z" and ${tz} is UTC+1 (BST), tell the caller "3pm" and pass "2026-05-11T14:00:00.000Z" to book_appointment.

If the check_availability tool returns zero slots (e.g. non-working days or fully booked days), do NOT say you cannot check — instead say something like "It looks like we're fully booked for those dates. Let me check the next few days…" and try again with a wider date range (e.g. the next 5 working days). If still no slots, offer to take the caller's details and have someone call back with available times.

If the caller doesn't want to book right now, take their name and let them know someone will follow up with available times.`);
  }

  // Caller phone handling
  sections.push(`## Caller phone number
You already have the caller's phone number from the inbound call: {{from_number}}
- Do NOT ask for their phone number — you already have it.
- Instead, confirm: "Is this the best number to reach you on?" or "Can we contact you on this number?"
- If they say yes, use {{from_number}} as their contact number.
- If they say no, ask what number they'd prefer.${assistantMode ? '' : '\n- When booking, always pass the caller\'s phone number to the booking tool.'}`);

  // Behaviour rules
  if (assistantMode) {
    sections.push(`## Behaviour rules
- NEVER make things up. If you don't know, say so honestly and offer to take a message or find out.
- NEVER argue with the caller. Stay warm and de-escalate.
- NEVER be pushy or repeat yourself. If someone doesn't engage with something, let it go and try a different approach.
- NEVER say the same line or closing twice in a conversation.
- Always confirm the spelling of names and repeat back phone numbers and emails.
- If they want to reach the person you work for directly, take a message and say you'll pass it on.

## Conversation style
- Build rapport first. Show genuine interest in the person.
- Keep responses short and natural. Match the length and energy of the other person.
- If someone sends a short message, reply short. Never over-explain.
- Be warm, genuine and helpful — never salesy or pushy. You're a friendly personal assistant.
- If someone seems unsure or confused, ask one simple clarifying question — don't push harder.
- Vary your language. Never reuse the same phrase or sentence structure back-to-back.`);
  } else {
    sections.push(`## Behaviour rules
- NEVER make up information. If you don't know, say so and offer to have someone call back.
- NEVER quote a price unless it is listed above. Say "I can get a quote sent over to you" instead.
- NEVER book or confirm an appointment unless the service is marked [BOOKABLE].
- NEVER share internal business information, staff personal details, or financial data.
- NEVER argue with the caller. Stay polite and de-escalate.
- NEVER be pushy or repeat yourself. If someone doesn't engage with a suggestion, drop it and try a different approach.
- NEVER send the same call-to-action or closing line more than once in a conversation.
- If the caller asks something outside your knowledge, take their details and say someone will be in touch.
- Always confirm spelling of names and repeat back phone numbers/emails.
- If the caller wants to speak to a human, acknowledge their request and explain someone will call them back shortly.

## Conversation style
- Build rapport before anything else. Show genuine interest in the person.
- Keep responses short and natural. Match the length and energy of the other person's messages.
- If someone sends a short message, reply with a short message. Never over-explain.
- Be warm and helpful, not salesy. You're a friendly receptionist, not a closer.
- If someone seems unsure or confused, ask a simple clarifying question — don't push harder.
- Vary your language. Never use the same phrase or sentence structure back-to-back.`);
  }

  // Channel-specific rules
  if (channel && CHANNEL_RULES[channel]) {
    const rule = assistantMode ? CHANNEL_RULES[channel].replace('friendly receptionist', 'friendly personal assistant') : CHANNEL_RULES[channel];
    sections.push(rule);
  }

  return sections.join('\n\n');
}
