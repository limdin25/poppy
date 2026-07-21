// DialerScriptPane — col 2 of the dialer. Renders the one-call sales script,
// but lean (no side rails / no built-in toolbar) and editable in place.
//
// The script HTML (src/core/content/one-call-script.html) is shared with the
// standalone /script page and must stay byte-for-byte, so we DON'T change the
// file: we inject an always-on copy of its own print CSS to hide the chrome,
// and drive editing through the iframe's same-origin document (srcDoc iframes
// share the parent origin, so no postMessage is needed).
//
// Admins can Edit → type → Save; the edited #page HTML persists to
// wk_sales_script (RLS: admins write, agents read). Agents see it read-only.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Printer, Save, X } from 'lucide-react';
import scriptHtml from '@/core/content/one-call-script.html?raw';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useSalesScript } from '../../hooks/useSalesScript';

// Reuse the script's own print rules (hide topbar/rails/controls, page full
// width) but apply them always, so the dialer shows only the centre column.
const LEAN_STYLE = `<style id="__dialer_lean__">
.topbar,.controls,.chooser,.rail{display:none !important}
.workspace{display:block;padding:0;max-width:100%}
.page{box-shadow:none;margin:0;max-width:100%;padding:18px 22px 40px;flex:none}
#page[contenteditable="true"]{outline:2px solid #3C5A87;outline-offset:4px;border-radius:8px}
</style>`;

const LEAN_HTML = scriptHtml.replace('</head>', `${LEAN_STYLE}</head>`);

export default function DialerScriptPane() {
  const { isAdmin } = useAuth();
  const { savedHtml, saving, error, save } = useSalesScript();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [docReady, setDocReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const appliedRef = useRef<string | null>(null);   // last savedHtml pushed into #page
  const snapshotRef = useRef<string>('');            // #page HTML when edit started

  const pageEl = useCallback((): HTMLElement | null => {
    return iframeRef.current?.contentDocument?.getElementById('page') ?? null;
  }, []);

  // Push the saved script into #page once the iframe is ready (and whenever the
  // saved value changes), unless the admin is mid-edit.
  useEffect(() => {
    if (!docReady || editing || savedHtml == null) return;
    if (appliedRef.current === savedHtml) return;
    const page = pageEl();
    if (page) {
      page.innerHTML = savedHtml;
      appliedRef.current = savedHtml;
    }
  }, [docReady, editing, savedHtml, pageEl]);

  const startEdit = () => {
    const page = pageEl();
    if (!page) return;
    snapshotRef.current = page.innerHTML;
    page.setAttribute('contenteditable', 'true');
    setEditing(true);
    page.focus();
  };

  const cancelEdit = () => {
    const page = pageEl();
    if (page) {
      page.innerHTML = snapshotRef.current;
      page.setAttribute('contenteditable', 'false');
    }
    setEditing(false);
  };

  const saveEdit = async () => {
    const page = pageEl();
    if (!page) return;
    const html = page.innerHTML;
    const ok = await save(html);
    if (ok) {
      appliedRef.current = html;
      page.setAttribute('contenteditable', 'false');
      setEditing(false);
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
