import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  value: string;
  onSave: (name: string) => Promise<boolean | string>;
  className?: string;
}

export default function EditableName({ value, onSave, className = '' }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await onSave(trimmed);
    setSaving(false);
    if (result === true) {
      setEditing(false);
    } else {
      setDraft(value);
      setEditing(false);
    }
  }, [draft, value, onSave]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void commit(); }
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
          disabled={saving}
          className={`bg-transparent border-b border-[#1E9A80] outline-none ${className}`}
          style={{ width: `${Math.max(draft.length, 4)}ch` }}
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin text-[#1E9A80]" />}
      </span>
    );
  }

  return (
    <span
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
      className={`cursor-text hover:border-b hover:border-[#1E9A80]/40 ${className}`}
      title="Click to rename"
    >
      {value}
    </span>
  );
}
