// CallScriptPane — col 3 of the LiveCallScreen.
//
// Hugo 2026-04-30: each agent has their OWN editable script. Resolution
// priority (via useAgentScript):
//   1. Agent's own row (wk_call_scripts WHERE owner_agent_id = auth.uid())
//   2. Default row (wk_call_scripts WHERE is_default = true)
//   3. Empty state
// Each agent edits inline via the pencil icon (PR 4).
//
// Hugo 2026-04-26 (PR 5): teleprompter — script blocks auto-grey as
// the agent reads them aloud. Read state is driven by useScriptRead-
// Tracking, which fuzzy-matches wk_live_transcripts (speaker = 'agent')
// against parsed blocks. Replaces the manual click-to-mark mechanism
// from PR #585. The current (next-to-read) block gets a green left
// border so the agent's eye snaps to it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, RotateCcw, Pencil } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useAgentScript } from '../../hooks/useAgentScript';
import { parseBlocks, type Block } from '../../lib/scriptParser';
import { useScriptReadTracking } from '../../hooks/useScriptReadTracking';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import EditScriptModal from './EditScriptModal';

interface Props {
  /** Active call id — used to scope teleprompter state per call. */
  callId: string | null;
  /** First name of the contact, used for {{first_name}} substitution. */
  contactFirstName: string;
  /** Agent first name, used for {{agent_first_name}} substitution. */
  agentFirstName: string;
  /** Campaign ID — used for script resolution chain. */
  campaignId?: string | null;
  /** Pipeline column ID — used for script resolution chain. */
  pipelineColumnId?: string | null;
}

export default function CallScriptPane({
  callId,
  contactFirstName,
  agentFirstName,
  campaignId,
  pipelineColumnId,
}: Props) {
  const { script, loading, error, saving, save, resetToDefault } = useAgentScript({ campaignId, pipelineColumnId });
  const [editing, setEditing] = useState(false);

  const rendered = useMemo(() => {
    const body = (script.body_md || '').trim();
    if (!body) return '';
    return interpolateTemplate(body, {
      firstName: contactFirstName,
      agentFirstName,
    });
  }, [script.body_md, contactFirstName, agentFirstName]);

  // Teleprompter state — fuzzy-matches agent voice to script blocks.
  const { readIdxs, currentIdx, reset } = useScriptReadTracking(
    callId,
    rendered
  );

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-[#3C5A87]" />
          <span className="text-[12px] font-semibold text-[#1A1A1A]">
            Call script
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#9CA3AF]">{script.name}</span>
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-[#F3F3EE] text-[#9CA3AF] hover:text-[#1A1A1A]"
            title="Edit your script"
            disabled={loading}
          >
            <Pencil className="w-3 h-3" />
          </button>
          {callId && (readIdxs.size > 0 || currentIdx !== null) && (
            <button
              onClick={reset}
              className="text-[10px] text-[#9CA3AF] hover:text-[#1A1A1A] inline-flex items-center gap-0.5"
              title="Reset teleprompter progress for this call"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="text-[12px] text-[#9CA3AF]">Loading script…</div>
        )}
        {error && (
          <div className="text-[11px] text-[#EF4444]">⚠ {error}</div>
        )}
        {!loading && !rendered && !error && (
          <div className="text-[12px] text-[#9CA3AF] leading-snug">
            No default script yet. Open Settings → AI coach → "Default call
            script" to add one.
          </div>
        )}
        {!loading && rendered && (
          <ScriptMarkdown
            body={rendered}
            readIdxs={readIdxs}
            currentIdx={currentIdx}
          />
        )}
      </div>

      <EditScriptModal
        open={editing}
        onOpenChange={setEditing}
        script={script}
        saving={saving}
        error={error}
        onSave={(next) => save({ name: next.name, body_md: next.body_md })}
        onResetToDefault={resetToDefault}
      />
    </div>
  );
}

// Renders the parsed script blocks with teleprompter styling:
//   - read blocks: dimmed + line-through
//   - current block (next to read): 2px green left border
//   - everything else: normal
function ScriptMarkdown({
  body,
  readIdxs,
  currentIdx,
}: {
  body: string;
  readIdxs: Set<number>;
  currentIdx: number | null;
}) {
  const blocks = parseBlocks(body);
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-[#1A1A1A]">
      {blocks.map((b, i) => (
        <TeleprompterBlock
          key={i}
          isRead={readIdxs.has(i)}
          isCurrent={currentIdx === i}
        >
          {renderBlock(b, i)}
        </TeleprompterBlock>
      ))}
    </div>
  );
}

function TeleprompterBlock({
  isRead,
  isCurrent,
  children,
}: {
  isRead: boolean;
  isCurrent: boolean;
  children: React.ReactNode;
}) {
  // Hugo 2026-04-26 (PR 14): "as the agent speaks throughout the script
  // it gets a background color so the agent knows it's being read."
  //
  // Read blocks get a soft highlighter wash (pale yellow) instead of
  // line-through — the agent can still read the text easily but sees
  // at a glance which lines are behind them. Current block (the next
  // unread one) gets a bright mint highlight + green left border so
  // the eye snaps to it. Auto-scroll keeps the cursor in view.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isCurrent && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isCurrent]);
  return (
    <div
      ref={ref}
      className={cn(
        'rounded -mx-1 px-2 py-0.5 transition-colors',
        isRead && !isCurrent && 'bg-[#FEF9C3]/60 text-[#525252]',
        isCurrent &&
          'border-l-[3px] border-[#3C5A87] -ml-[3px] pl-2 bg-[#EEF2F8] shadow-[0_2px_8px_rgba(30,154,128,0.12)]'
      )}
    >
      {children}
    </div>
  );
}

// Block parser + types live in src/features/smsv2/lib/scriptParser.ts so
// vitest can exercise them without dragging React + Supabase imports
// into the test environment. Renderer below consumes the parsed blocks.

function renderBlock(b: Block, i: number) {
  if (b.type === 'h') {
    const cls =
      b.level === 1
        ? 'text-[16px] font-bold text-[#1A1A1A] mt-2 mb-1'
        : b.level === 2
          ? 'text-[14px] font-bold text-[#1A1A1A] mt-2 mb-0.5'
          : 'text-[12px] font-semibold uppercase tracking-wide text-[#6B7280] mt-1.5 mb-0.5';
    return (
      <div key={i} className={cls}>
        {renderInline(b.text)}
      </div>
    );
  }
  if (b.type === 'p') {
    return (
      <p key={i} className="text-[13px] text-[#1A1A1A] leading-relaxed">
        {renderInline(b.text)}
      </p>
    );
  }
  if (b.type === 'ul') {
    return (
      <ul key={i} className="list-disc pl-4 space-y-1 text-[13px] text-[#1A1A1A]">
        {b.items.map((it, j) => (
          <li key={j}>
            {it.kind === 'if' ? (
              <span className="inline-flex items-baseline gap-1.5 flex-wrap">
                <span
                  className="inline-block bg-[#FEF3C7] text-[#B45309] text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                >
                  if {it.condition}
                </span>
                <span>{renderInline(it.text)}</span>
              </span>
            ) : (
              renderInline(it.text)
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (b.type === 'q') {
    return (
      <blockquote
        key={i}
        className="border-l-2 border-[#3C5A87] pl-3 py-0.5 text-[12px] italic text-[#6B7280]"
      >
        {renderInline(b.text)}
      </blockquote>
    );
  }
  return <hr key={i} className="border-[#E5E7EB] my-2" />;
}

// Inline: **bold**, *italic*, `code`. Keep it simple — call-script content
// is admin-controlled, no need to defend against XSS beyond text rendering.
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="bg-[#F3F3EE] text-[12px] px-1 rounded font-mono"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
