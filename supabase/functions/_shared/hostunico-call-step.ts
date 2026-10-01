import { hostunicoReportHook, type HostunicoReportPitch } from './hostunico-report-pitch.ts';

/** Only clear answers to the last spoken script question skip generation. */
export function hostunicoCallStep(input: {
  mode: string; latestCaller: string; transcript: { speaker: string; body: string }[];
  report: { state?: string; report_pitch?: HostunicoReportPitch | null; latestDelivery?: unknown } | null;
}) {
  if (!['spareroom', 'facebook'].includes(input.mode)) return null;
  const caller = input.latestCaller.toLowerCase().replace(/[.,!?]/g, '').trim();
  const agent = [...input.transcript].reverse().find((row) => row.speaker === 'agent')?.body || '';
  const permission = /^(?:yes|yeah|yep|sure|okay|ok|please)(?:\s+(?:yes|okay|ok|please|go on|tell me more|explain|you can|that's fine))*$/i.test(caller);
  if (permission && /(?:one minute|explain why (?:i|we) (?:called|am calling))/i.test(agent) && !input.report?.latestDelivery) {
    const pitch = input.report?.state === 'ready' ? input.report.report_pitch : null;
    const hook = hostunicoReportHook(pitch);
    const split = hook.split('\n\n');
    return `SAY: ${split[0]}\nASK: ${split[1] || ''}`;
  }
  if (input.report?.latestDelivery && /^(?:yes |yeah |yep |okay |ok )?(?:i(?:'ve| have)? (?:got|received|seen)|got|received)(?: your| the| it| that| email| text| sms| report| link| now| thanks| thank you| yes| yep| okay| ok)*$/i.test(caller)) {
    return "SAY: Thanks.\nASK: Would tomorrow work for a quick call to talk through the report?";
  }
  return null;
}
