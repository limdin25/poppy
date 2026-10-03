import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { TRAINING_LABEL, readTrainingMaterial, setTrainingMaterial } from '../../lib/trainingMaterial';

/** Tags a call as good objections / training material. Never changes the outcome. */
export default function TrainingMaterialToggle({ callId, initial, compact = false, onChange }: { callId: string | null | undefined; initial?: boolean; compact?: boolean; onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(initial ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (initial !== undefined) { setOn(initial); return; }
    if (!callId) { setOn(false); return; }
    let cancelled = false;
    void readTrainingMaterial(callId).then((value) => { if (!cancelled) setOn(value); });
    return () => { cancelled = true; };
  }, [callId, initial]);
  if (!callId) return null;
  async function toggle() {
    if (!callId || busy) return;
    setBusy(true); setError('');
    try { await setTrainingMaterial(callId, !on); setOn(!on); onChange?.(!on); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the tag.'); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col">
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={on}
      title={on ? `Tagged: ${TRAINING_LABEL}. Click to remove.` : `Tag as ${TRAINING_LABEL}. The outcome is not changed.`}
      data-testid="training-material-toggle"
      className={`inline-flex items-center gap-1 rounded-[7px] font-bold transition-colors disabled:opacity-50 ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1.5 text-[11.5px]'} ${on ? 'border border-[#B45309] bg-[#FEF3C7] text-[#92400E]' : 'border border-dashed border-[#D1D5DB] text-[#6B7280] hover:bg-[#FAFAF8]'}`}
    >
      <GraduationCap className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {compact ? (on ? 'Training' : 'Tag') : TRAINING_LABEL}
    </button>
    {error && <span role="alert" className="mt-1 text-[10.5px] text-[#B91C1C]">{error}</span>}
  </span>;
}
