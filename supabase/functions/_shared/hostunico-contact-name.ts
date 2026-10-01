// This decides whether to ask, never guesses a name or edits the contact.
export function hostunicoNeedsName(name: string | null | undefined, transcript: { speaker: string; body: string }[] = []) {
  if (transcript.some((line) => line.speaker === 'agent' && /(?:what(?:'s| is) your (?:first )?name|who am i (?:speaking|talking) (?:to|with)|can i (?:take|get|ask) your name)/i.test(line.body))) return false;
  if (transcript.some((line) => line.speaker !== 'agent' && /\bmy name is [a-z]|\b(?:i'm|i am) (?:mr|mrs|miss|ms)\b/i.test(line.body))) return false;
  const value = (name || '').trim();
  return !value || /\d|@|https?:|\b(student|landlord|owner|tenant|unknown|contact|private advertiser|agent|agency|properties|property|lettings|estates|estate|ltd|limited|group|homes|housing|investments|accommodation|studio|flat|apartment|company)\b/i.test(value) || value.split(/\s+/).length > 5;
}
