// The voice stage's two clear paths: pick a curated voice (cards with play
// preview) or clone your own (upload a sample, name it). Zero friction: one
// segmented control, no nesting.

import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { backend } from '../../core/persistence';
import type { VoiceInfo } from '../../core/persistence/backend';
import { TID } from '../../testids';

interface Props {
  selectedVoiceId: string;
  onSelect: (voiceId: string) => void;
}

export function VoicePicker({ selectedVoiceId, onSelect }: Props) {
  const [tab, setTab] = useState<'choose' | 'clone'>('choose');
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refresh = () => backend().listVoices().then(setVoices);
  useEffect(() => {
    void refresh();
  }, []);

  const togglePreview = (voice: VoiceInfo) => {
    if (playing === voice.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    if (!voice.previewUrl) return;
    audioRef.current?.pause();
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    void audio.play();
    setPlaying(voice.id);
  };

  const startClone = async () => {
    if (!cloneFile || !cloneName.trim() || cloning) return;
    setCloning(true);
    try {
      const voice = await backend().cloneVoice(cloneFile, cloneName.trim());
      await refresh();
      onSelect(voice.id);
      setTab('choose');
    } finally {
      setCloning(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex rounded-btn bg-page p-0.5">
        {(['choose', 'clone'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={t === 'clone' ? TID.voiceCloneTab : undefined}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-[10px] py-1.5 text-[11px] font-semibold transition-colors ${
              tab === t ? 'bg-white text-ink shadow-card' : 'text-ink-muted'
            }`}
          >
            {t === 'choose' ? 'Choose a voice' : 'Clone a voice'}
          </button>
        ))}
      </div>

      {tab === 'choose' ? (
        <div data-testid={TID.voiceList} className="space-y-1.5">
          {voices.map((voice) => (
            <button
              key={voice.id}
              type="button"
              data-testid={TID.voiceCard(voice.id)}
              onClick={() => onSelect(voice.id)}
              className={`flex w-full items-center gap-2 rounded-slot border px-2.5 py-2 text-left transition-colors ${
                selectedVoiceId === voice.id ? 'border-ink bg-page' : 'border-hairline bg-white hover:bg-page'
              }`}
            >
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePreview(voice);
                }}
                onKeyDown={(e) => e.key === 'Enter' && togglePreview(voice)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white"
                aria-label={`Preview ${voice.name}`}
              >
                {playing === voice.id ? <Square size={10} /> : <Play size={11} className="ml-0.5" />}
              </span>
              <span className="flex-1 text-[12px] font-semibold text-ink">{voice.name}</span>
              {voice.kind === 'cloned' ? (
                <span className="rounded-full bg-live/10 px-2 py-0.5 text-[9px] font-bold text-live">Yours</span>
              ) : (
                <span className="text-[10px] text-ink-subtle">{voice.vibe}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            data-testid={TID.voiceCloneName}
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
            placeholder="Name this voice"
            className="w-full rounded-slot border border-hairline px-2.5 py-2 text-[12px] outline-none focus:border-live"
          />
          <label className="block cursor-pointer rounded-slot border border-dashed border-hairline px-2.5 py-3 text-center text-[11px] text-ink-muted hover:bg-page">
            {cloneFile ? cloneFile.name : 'Upload a voice sample (30s or more sounds best)'}
            <input
              type="file"
              accept="audio/*"
              data-testid={TID.voiceCloneFile}
              className="hidden"
              onChange={(e) => setCloneFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            data-testid={TID.voiceCloneStart}
            onClick={() => void startClone()}
            disabled={!cloneFile || !cloneName.trim() || cloning}
            className="w-full rounded-btn bg-ink py-2 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            {cloning ? 'Cloning' : 'Clone this voice'}
          </button>
        </div>
      )}
    </div>
  );
}
