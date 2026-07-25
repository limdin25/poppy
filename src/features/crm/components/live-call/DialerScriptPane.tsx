// DialerScriptPane — col 2 of the dialer. Renders the one-call sales script,
// but lean (no side rails / no built-in toolbar), personalised per lead, and
// editable in place.
//
// The script HTML (src/core/content/one-call-script.html) is shared with the
// standalone /script page and must stay byte-for-byte, so we DON'T change the
// file: we inject an always-on copy of its own print CSS to hide the chrome,
// and drive editing through the iframe's same-origin document (srcDoc iframes
// share the parent origin, so no postMessage is needed).
//
// Two layers of HTML:
//   - TEMPLATE (raw, with [named] tokens) — what admins edit and what persists
//     to wk_sales_script. Established once from savedHtml, or captured from the
//     script's own default render when nothing is saved.
//   - DISPLAY — interpolateScript(template, contact): the same HTML with THIS
//     lead's owner name, business, reviews, rank, competitors and live Google-
//     search link filled in. Re-rendered whenever the active contact changes.
//
// So editing never bakes one lead's numbers into the saved script, and every
// agent dialling any lead sees that lead's own personalised script.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Printer, Save, X } from 'lucide-react';
import scriptHtml from '@/core/content/one-call-script.html?raw';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useSalesScript } from '../../hooks/useSalesScript';
import { interpolateScript, highlightTokens, stripHighlights } from '../../lib/interpolateScript';
import type { Contact } from '../../types';

// Reuse the script's own print rules (hide topbar/rails/controls, page full
// width) but apply them always, so the dialer shows only the centre column.
const LEAN_STYLE = `<style id="__dialer_lean__">
.topbar,.controls,.chooser,.rail{display:none !important}
.workspace{display:block;padding:0;max-width:100%}
.page{box-shadow:none;margin:0;max-width:100%;padding:18px 22px 40px;flex:none}
#page[contenteditable="true"]{outline:2px solid #3C5A87;outline-offset:4px;border-radius:8px}
</style>`;

const LEAN_HTML = scriptHtml.replace('</head>', `${LEAN_STYLE}</head>`);

interface Props {
  /** The lead being dialled — its custom_fields fill the script's tokens. */
  contact?: Contact | null;
}

export default function DialerScriptPane({ contact }: Props) {
  const { isAdmin } = useAuth();
  const { savedHtml, loading, saving, error, save } = useSalesScript();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [docReady, setDocReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [template, setTemplate] = useState<string | null>(null); // raw HTML with tokens
  const lastSavedRef = useRef<string | null | undefined>(undefined); // last savedHtml folded in

  const pageEl = useCallback((): HTMLElement | null => {
    return iframeRef.current?.contentDocument?.getElementById('page') ?? null;
  }, []);

  // Establish / refresh the TEMPLATE. Runs once the iframe is ready and the
  // saved script has settled. When nothing is saved we capture the script's
  // own default render (build() has already populated #page by onLoad).
  useEffect(() => {
    if (!docReady || loading || editing) return;
    if (lastSavedRef.current === savedHtml && template != null) return;
    const page = pageEl();
    if (!page) return;
    const tpl = savedHtml ?? template ?? page.innerHTML;
    lastSavedRef.current = savedHtml;
    setTemplate(tpl);
  }, [docReady, loading, editing, savedHtml, template, pageEl]);

  // Render the DISPLAY (template filled for the current contact) whenever the
  // template or the active lead changes — but never while an admin is editing.
  useEffect(() => {
    if (editing || template == null) return;
    const page = pageEl();
    if (page) page.innerHTML = interpolateScript(template, contact);
  }, [template, contact, editing, pageEl]);

  const startEdit = () => {
    const page = pageEl();
    if (!page || template == null) return;
    page.innerHTML = highlightTokens(template); // raw tokens, brown so slots are obvious
    page.setAttribute('contenteditable', 'true');
    setEditing(true);
    page.focus();
  };

  const cancelEdit = () => {
    const page = pageEl();
    if (page) page.setAttribute('contenteditable', 'false');
    setEditing(false);                    // the display effect re-fills from template
  };

  const saveEdit = async () => {
    const page = pageEl();
    if (!page) return;
    const edited = stripHighlights(page.innerHTML); // strip brown styling → bare tokens
    const ok = await save(edited);
    if (ok) {
      lastSavedRef.current = edited;
      page.setAttribute('contenteditable', 'false');
      setEditing(false);
      setTemplate(edited);                // triggers a re-fill for the current lead
    }
  };

  const print = () => iframeRef.current?.contentWindow?.print();

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-[#3C5A87]" />
        <span className="text-[12px] font-semibold text-[#1A1A1A]">Sales script</span>
        {error && <span className="text-[10px] text-[#EF4444] truncate">⚠ {error}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {isAdmin && !editing && (
            <button onClick={startEdit} title="Edit the script"
              className="flex items-center gap-1 text-[11px] font-medium text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1 rounded-md hover:bg-[#F3F3EE]">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {isAdmin && editing && (
            <>
              <button onClick={cancelEdit} disabled={saving} title="Discard changes"
                className="flex items-center gap-1 text-[11px] font-medium text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1 rounded-md hover:bg-[#F3F3EE] disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button onClick={() => void saveEdit()} disabled={saving}
                className="flex items-center gap-1 text-[11px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] px-2.5 py-1 rounded-md disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          <button onClick={print} title="Print / save PDF"
            className="flex items-center gap-1 text-[11px] font-medium text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1 rounded-md hover:bg-[#F3F3EE]">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        title="Sales script"
        srcDoc={LEAN_HTML}
        onLoad={() => setDocReady(true)}
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
