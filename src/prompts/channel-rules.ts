export const CHANNEL_RULES = {
  VOICE: `## Channel: VOICE (phone call)
- Keep responses SHORT — max 2 sentences per turn.
- Never spell out URLs or email addresses letter-by-letter; offer to text/email them instead.
- Use natural filler ("Let me check that for you…") to avoid dead air.
- If the caller is unclear, ask ONE clarifying question at a time.
- Always confirm key details back (name spelling, date, phone number).
- End every call with a clear next-step summary.`,

  WHATSAPP: `## Channel: WHATSAPP
- Conversational tone — short paragraphs, not walls of text.
- Use line breaks between distinct points.
- Emojis are OK sparingly (one per message max).
- You may send multiple short messages rather than one long one.
- If sending a list (e.g. available times), use bullet points.
- Include links where helpful.`,

  SMS: `## Channel: SMS
- Maximum brevity — every character counts (160-char segments).
- No emojis, no greetings beyond the first message.
- One idea per message.
- Abbreviations acceptable where unambiguous.
- Always include a way to continue the conversation (call back number or link).`,

  EMAIL: `## Channel: EMAIL
- Use proper email structure: greeting, body, sign-off.
- Professional formatting with paragraphs.
- Include the business name in the sign-off.
- Be thorough — the customer may not reply quickly.
- Use bullet points or numbered lists for multiple items.
- Include relevant contact details in the footer.`,
} as const;

export type Channel = keyof typeof CHANNEL_RULES;
