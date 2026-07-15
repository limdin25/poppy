// Caller — Twilio error code → friendly message + fatal flag.
// Copied verbatim from src/features/smsv2/lib/twilioErrorMap.ts (Hugo's
// PR 138-147 surface — covers 31002/31204/31205/31401/31403/31404/31480/
// 31486/31005/31009/31000/13224 with field-tested wording). See
// docs/caller/DECISIONS.md (D2).

export interface MappedTwilioError {
  friendlyMessage: string;
  fatal: boolean;
}

export function mapTwilioError(code: number, message: string): MappedTwilioError {
  if (code === 31401) {
    return {
      friendlyMessage:
        'Mic blocked. Click the lock icon next to the URL → Microphone → Allow → reload.',
      fatal: false,
    };
  }
  if (code === 31002) {
    return {
      friendlyMessage:
        'Call declined — the destination number is unreachable. Try a different number.',
      fatal: true,
    };
  }
  if (code === 31204) {
    return {
      friendlyMessage: 'Auth token rejected by Twilio. Refreshing — try again.',
      fatal: true,
    };
  }
  if (code === 31205) {
    return {
      friendlyMessage: 'Auth token expired. Refreshing — try again.',
      fatal: true,
    };
  }
  if (code === 31404) {
    return {
      friendlyMessage: 'Contact not found — please dial the next lead.',
      fatal: true,
    };
  }
  if (code === 31480) {
    return {
      friendlyMessage: 'Destination temporarily unavailable — try the next lead.',
      fatal: true,
    };
  }
  if (code === 31486) {
    return {
      friendlyMessage: 'Destination is busy — try again later.',
      fatal: true,
    };
  }
  if (code === 31403) {
    return {
      friendlyMessage: 'Call refused by Twilio (31403). Check phone number / caller ID.',
      fatal: true,
    };
  }
  if (code === 31005 || code === 31009) {
    return {
      friendlyMessage: `Connection lost (${code}). Refresh the page if it doesn't recover.`,
      fatal: true,
    };
  }
  if (code === 31000) {
    return {
      friendlyMessage: 'Call dropped — please try again.',
      fatal: true,
    };
  }
  if (code === 13224) {
    return {
      friendlyMessage: 'Number unreachable on UK carrier — try a different number.',
      fatal: true,
    };
  }
  return {
    friendlyMessage: `Call error ${code || ''}: ${message || 'unknown'}`.trim(),
    fatal: false,
  };
}
