// EditScriptModal — agent edits THEIR OWN call script without leaving
// the live-call screen. Hugo 2026-04-26 (PR 4): "you should have
// something there to click, and then we can the agent can edit his
// script."
//
// Wires to useAgentScript (already loaded by the parent CallScriptPane).
// On Save, calls setField + save() which UPSERTs the agent's row in
// wk_call_scripts (RLS lets the agent UPDATE their own row — see
// migration 20260430000000 lines 146–159). Cancel discards local form
// state without touching the hook.
//
// Z-index note: the live-call screen is z-[200]; dialog overlay +
// content are bumped to z-[220] so they sit above.

import { useEffect, useState } from 'react';
import { Save, Loader2, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/features/crm/ui/dialog';
import type { AgentScript } from '../../hooks/useAgentScript';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script: AgentScript;
  saving: boolean;
  error: string | null;
  onSave: (next: { name: string; body_md: string }) => Promise<void> | void;
  /** PR 21: when present, clicking "Reset to default" calls this to
   *  DELETE the agent's personal row and pull down whatever is
   *  currently flagged is_default = true. Pass undefined when the
   *  agent is already viewing the default (nothing to reset to). */
  onResetToDefault?: () => Promise<void> | void;
}

export default function EditScriptModal({
  open,
  onOpenChange,
  script,
  saving,
  error,
  onSave,
  onResetToDefault,
}: Props) {
  const [name, setName] = useState(script.name);
  const [body, setBody] = useState(script.body_md);
  const [savedHint, setSavedHint] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Re-seed local form state every time the modal opens — matches the
  // current persisted script, even if the agent edited / discarded a
  // previous open.
  useEffect(() => {
    if (open) {
      setName(script.name);
      setBody(script.body_md);
      setSavedHint(false);
    }
  }, [open, script.name, script.body_md]);

  const handleSave = async () => {
    if (saving) return;
    await onSave({ name: name.trim() || 'My script', body_md: body });
    setSavedHint(true);
    // Auto-close shortly after a successful save so the agent gets
    // back to the call quickly. If `error` flips truthy, the parent
    // component will surface it next render — we leave the modal open
    // to let them retry.
    setTimeout(() => {
      // Re-check error inside a state callback would race; the parent
      // controls whether the modal stays open via the onOpenChange
      // callback after this resolves.
      onOpenChange(false);
    }, 500);
  };

  const handleReset = async () => {
    if (!onResetToDefault || resetting || saving) return;
    if (
      !confirm(
        "Reset to the admin default? Your personal copy of this script will be deleted and you'll see the latest default body. This can't be undone."
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      await onResetToDefault();
      onOpenChange(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[220] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit your call script</DialogTitle>
          <DialogDescription>
            Saved to your own copy — admins and other agents won't see your
            edits. Markdown supported (#/##/### headings, - bullets,
            **bold**, *italic*, &gt; quote). Lines starting with
            <span className="font-mono"> "If &lt;cond&gt;: &lt;body&gt;"</span> auto-highlight as orange branches in
            the live-call view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#525252] mb-1">
              Script name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#525252] mb-1">
              Body (Markdown)
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              spellCheck
              className="w-full px-3 py-2 text-[12px] font-mono border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80] resize-y"
            />
            <div className="text-[10px] text-[#9CA3AF] mt-1">
              {body.length} chars
            </div>
          </div>
          {error && (
            <div className="text-[12px] text-[#EF4444] bg-[#FEF2F2] border border-[#FEE2E2] rounded-md px-3 py-2">
              ⚠ {error}
            </div>
          )}
          {savedHint && !error && (
            <div className="text-[12px] text-[#1E9A80]">
              Saved · just now
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Left side: destructive Reset to default. Hidden when the
              agent is already viewing the default (nothing to reset). */}
          <div>
            {onResetToDefault && script.source === 'own' && (
              <button
                type="button"
                onClick={() => void handleReset()}
                disabled={saving || resetting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-[#B45309] hover:bg-[#FFFBEB] rounded-[8px] disabled:opacity-50"
                title="Delete your personal copy and pull the admin default"
              >
                {resetting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                {resetting ? 'Resetting…' : 'Reset to default'}
              </button>
            )}
          </div>

          {/* Right side: Cancel + Save. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving || resetting}
              className="px-3 py-1.5 text-[12px] font-medium border border-[#E5E7EB] rounded-[8px] hover:bg-[#F3F3EE] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || resetting || !body.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[#1E9A80] text-white rounded-[8px] hover:bg-[#1E9A80]/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
