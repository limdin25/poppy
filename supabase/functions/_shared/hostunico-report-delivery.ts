export type ReportMessage = { body: string; status: string; channel?: string | null; created_at: string };
/** Delivery evidence for the selected report only, across SMS and email. */
export function hostunicoReportDelivery(url: string | null | undefined, messages: ReportMessage[]) {
  if (!url) return null;
  return messages.find((message) => message.body.includes(url) && ['queued', 'sent', 'delivered', 'read'].includes(message.status)) ?? null;
}
