import { useState } from 'react'
import { Play, Check } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface Voice {
  id: string
  name: string
  description: string
  accent: string
}

const VOICES: Voice[] = [
  { id: 'emma', name: 'Emma', description: 'Warm and professional', accent: 'British' },
  { id: 'sophie', name: 'Sophie', description: 'Friendly and upbeat', accent: 'British' },
  { id: 'olivia', name: 'Olivia', description: 'Calm and reassuring', accent: 'British' },
  { id: 'james', name: 'James', description: 'Confident and clear', accent: 'British' },
  { id: 'harry', name: 'Harry', description: 'Energetic and engaging', accent: 'British' },
  { id: 'charlotte', name: 'Charlotte', description: 'Polished and articulate', accent: 'British' },
]

export default function VoiceSection() {
  const [selected, setSelected] = useState('emma')
  const [speed, setSpeed] = useState(1.0)
  const [playing, setPlaying] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Voice</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Choose how your AI receptionist sounds on calls.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {VOICES.map((voice) => (
            <button
              key={voice.id}
              onClick={() => setSelected(voice.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-4 text-left transition',
                selected === voice.id
                  ? 'border-brand bg-brand-50 shadow-sm'
                  : 'border-border hover:border-brand/30'
              )}
            >
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                selected === voice.id ? 'bg-brand text-white' : 'bg-elevated text-ink-muted'
              )}>
                {selected === voice.id ? <Check size={16} /> : voice.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-medium text-ink">{voice.name}</p>
                  <span className="rounded bg-elevated px-1.5 py-0.5 text-[11px] text-ink-subtle">{voice.accent}</span>
                </div>
                <p className="text-[12px] text-ink-muted">{voice.description}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setPlaying(playing === voice.id ? null : voice.id) }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border transition hover:bg-elevated"
              >
                <Play size={12} className={cn('text-ink-muted', playing === voice.id && 'text-brand')} />
              </button>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Speaking Speed</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Adjust how fast Poppy speaks.
        </p>

        <div className="mt-4">
          <input
            type="range"
            min={0.7}
            max={1.3}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-full accent-brand"
          />
          <div className="mt-2 flex justify-between text-[12px] text-ink-subtle">
            <span>Slower</span>
            <span className="font-medium text-ink">{speed.toFixed(1)}x</span>
            <span>Faster</span>
          </div>
        </div>
      </div>

      <button className="h-10 w-full rounded-lg bg-brand text-[14px] font-semibold text-white transition hover:bg-brand-600 sm:w-auto sm:px-6">
        Save changes
      </button>
    </div>
  )
}
