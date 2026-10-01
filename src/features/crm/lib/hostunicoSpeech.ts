export type HostunicoSpeech = { id: string; body: string; speaker: string; ts: string; sequence?: number; utterance_id?: string; is_final?: boolean };
export type HostunicoLiveSpeech = HostunicoSpeech & { call_id: string; sequence: number; utterance_id: string; is_final: boolean };

export function mergeHostunicoSpeech(current: HostunicoLiveSpeech[], next: HostunicoLiveSpeech) {
  const previous = current.find((line) => line.speaker === next.speaker);
  if (previous && previous.sequence >= next.sequence) return current;
  return [...current.filter((line) => line.speaker !== next.speaker), { ...next, id: next.utterance_id }].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function hostunicoSpeechLines(finals: HostunicoSpeech[], live: HostunicoLiveSpeech[]): HostunicoSpeech[] {
  return [...finals, ...live.filter((line) => !finals.some((final) => final.speaker === line.speaker && final.body === line.body && Math.abs(Date.parse(final.ts) - Date.parse(line.ts)) < 5000))].sort((a, b) => a.ts.localeCompare(b.ts));
}

const fillers = new Set(['a','an','the','to','of','and','it','is','we','you','i','in','for','with','that','this','your','our','so','can','be']);
function words(text: string) { return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']/g, ' ').split(/\s+/).filter(Boolean); }

// Reading progress is local and reversible as partial speech is corrected.
// Only agent speech counts. An isolated common word never completes a line.
export function hostunicoSpokenWords(text: string, spoken: string): Set<number> {
  const target = text.match(/\S+\s*/g) || [];
  const heard = words(spoken).slice(-700);
  let best: number[] = [];
  for (let start = 0; start < heard.length; start++) {
    let at = start;
    const matched: number[] = [];
    let meaningful = 0, missed = 0;
    for (let i = 0; i < target.length; i++) {
      const tokens = words(target[i]);
      if (!tokens.length) continue;
      const next = heard.slice(at, at + 5).findIndex((word) => word === tokens[0]);
      if (next < 0) { missed++; if (missed > 2) break; continue; }
      at += next + 1;
      matched.push(i);
      if (tokens.some((token) => !fillers.has(token))) meaningful++;
      if (at >= heard.length) break;
    }
    if (meaningful >= 2 && matched.length >= Math.min(3, target.length) && matched.length / (matched.at(-1)! + 1) >= 0.65 && matched.length > best.length) best = matched;
  }
  return new Set(best);
}
