import { hostunicoSpokenWords } from '../../lib/hostunicoSpeech';

export default function SpokenText({ text, spoken }: { text: string; spoken: string }) {
  const covered = hostunicoSpokenWords(text, spoken);
  if (!covered.size) return <>{text}</>;
  return <>{(text.match(/\S+\s*/g) || []).map((word, index) => <span key={index} className={covered.has(index) ? 'text-green-800' : undefined} data-spoken={covered.has(index) ? 'true' : undefined}>{word}</span>)}</>;
}
