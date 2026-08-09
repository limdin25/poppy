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
//
// THREE SCRIPTS, picked by `scriptKey`:
//   'cold_call' (default) — one-call-script.html / wk_sales_script. Every
//                           normal dial. Nothing passes the prop, so this path
//                           behaves exactly as it did before the second script
//                           existed.
//   'vsl_close'           — vsl-close-script.html / wk_vsl_close_script. Only
//                           when the dialer is opened from the video funnel
//                           (?script=vsl_close) for a lead who already watched
//                           their video.
//   'property_call'       — property-call-script.html / wk_property_call_script.
//                           The Houses campaign: ringing an estate agency about
//                           a house. Its money section is filled from the
//                           selected property via `extraTokens`.
// Separate bundled files AND separate tables, so editing one can never touch
// the others.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Printer, Save, X } from 'lucide-react';
import scriptHtml from '@/core/content/one-call-script.html?raw';
import vslCloseHtml from '@/core/content/vsl-close-script.html?raw';
import propertyCallHtml from '@/core/content/property-call-script.html?raw';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useSalesScript } from '../../hooks/useSalesScript';
import { useVslCloseScript } from '../../hooks/useVslCloseScript';
import { usePropertyCallScript } from '../../hooks/usePropertyCallScript';
import { interpolateScript, highlightTokens, stripHighlights } from '../../lib/interpolateScript';
import type { Contact } from '../../types';

export type ScriptKey = 'cold_call' | 'vsl_close' | 'property_call';

// Reuse the script's own print rules (hide topbar/rails/controls, page full
// width) but apply them always, so the dialer shows only the centre column.
const LEAN_STYLE = `<style id="__dialer_lean__">
.topbar,.controls,.chooser,.rail{display:none !important}
.workspace{display:block;padding:0;max-width:100%}
.page{box-shadow:none;margin:0;max-width:100%;padding:18px 22px 40px;flex:none}
#page[contenteditable="true"]{outline:2px solid #3C5A87;outline-offset:4px;border-radius:8px}
</style>`;

const LEAN_HTML: Record<ScriptKey, string> = {
  cold_call: scriptHtml.replace('</head>', `${LEAN_STYLE}</head>`),
  vsl_close: vslCloseHtml.replace('</head>', `${LEAN_STYLE}</head>`),
  property_call: propertyCallHtml.replace('</head>', `${LEAN_STYLE}</head>`),
};

const PANE_TITLE: Record<ScriptKey, string> = {
  cold_call: 'Sales script',
  vsl_close: 'Close script · they watched the video',
  property_call: 'Property call · estate agent',
};

interface Props {
  /** The lead being dialled — its custom_fields fill the script's tokens. */
  contact?: Contact | null;
  /** Which script to show. Omitted everywhere except the video funnel's
   *  "Call to close" deep link and the Houses campaign, so every existing
   *  caller keeps the cold script. */
  scriptKey?: ScriptKey;
  /** Extra token values that do NOT come from the contact — the property call's
   *  money section is filled from whichever listing the agent has selected in
   *  the Houses tab, which can change mid-call without the contact changing. */
  extraTokens?: Record<string, string | undefined>;
}

export default function DialerScriptPane({ contact, scriptKey = 'cold_call', extraTokens }: Props) {
  const { isAdmin } = useAuth();
  // All three hooks run unconditionally (Rules of Hooks) and we use the one
  // this pane is showing. The unused two are single cheap singleton reads.
  const cold = useSalesScript();
  const vslClose = useVslCloseScript();
  const propertyCall = usePropertyCallScript();
  const byKey: Record<ScriptKey, typeof cold> = {
    cold_call: cold,
    vsl_close: vslClose,
    property_call: propertyCall,
  };
  const { savedHtml, loading, saving, error, save } = byKey[scriptKey] ?? cold;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [docReady, setDocReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [template, setTemplate] = useState<string | null>(null); // raw HTML with tokens
  const lastSavedRef = useRef<string | null | undefined>(undefined); // last savedHtml folded in

  const pageEl = useCallback((): HTMLElement | null => {
    return iframeRef.current?.contentDocument?.getElementById('page') ?? null;
  }, []);

  // Swapping scripts swaps the iframe's srcDoc, so anything captured from the
  // OLD document is now the wrong script's HTML. Drop it and let the effects
  // below re-capture from the new one, or the close script would render the
  // cold script's body.
  const templateKeyRef = useRef<ScriptKey>(scriptKey);
  useEffect(() => {
    if (templateKeyRef.current === scriptKey) return;
    templateKeyRef.current = scriptKey;
    lastSavedRef.current = undefined;
    setDocReady(false);
    setTemplate(null);
    setEditing(false);
  }, [scriptKey]);

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
  // extraTokens is stringified for the dependency array: it is rebuilt fresh on
  // every render by the parent, so comparing by reference would re-render the
  // iframe body on every keystroke elsewhere in the dialer.
  const extraKey = JSON.stringify(extraTokens ?? null);
  useEffect(() => {
    if (editing || template == null) return;
    const page = pageEl();
    if (page) page.innerHTML = interpolateScript(template, contact, extraTokens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, contact, editing, pageEl, extraKey]);

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
        <span className="text-[12px] font-semibold text-[#1A1A1A]">{PANE_TITLE[scriptKey]}</span>
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
        title={PANE_TITLE[scriptKey]}
        srcDoc={LEAN_HTML[scriptKey]}
        onLoad={() => setDocReady(true)}
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
