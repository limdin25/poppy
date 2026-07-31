// The side panel: a dumb renderer of derivePanel's PanelModel. The Input
// Assignment section only exists when derivePanel emits it (>= 1 incoming
// edge), which is the product's core panel rule made visible.

import { Link2Off, Upload } from 'lucide-react';
import { derivePanel } from '../../../core/graph/panel';
import { capability } from '../../../core/graph/capabilities';
import { useCanvasStore } from '../state/store';
import { VoicePicker } from '../../voice/VoicePicker';
import { TID } from '../../../testids';

export function InspectorPanel() {
  const doc = useCanvasStore((s) => s.doc);
  const selection = useCanvasStore((s) => s.selection);
  const updateConfig = useCanvasStore((s) => s.updateConfig);
  const deleteEdge = useCanvasStore((s) => s.deleteEdge);
  const approve = useCanvasStore((s) => s.approve);
  const uploadTo = useCanvasStore((s) => s.uploadTo);

  if (!doc || !selection) return null;
  const node = doc.nodes.find((n) => n.id === selection);
  if (!node) return null;

  const cap = capability(node.kind);
  const sections = derivePanel(doc, selection);

  return (
    <aside
      data-testid={TID.panel}
      className="flex h-full w-[300px] flex-col overflow-y-auto border-l border-hairline bg-white"
    >
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">{cap.displayName}</p>
        <h2 className="text-[15px] font-bold text-ink">{node.label}</h2>
      </div>

      {node.kind === 'asset' && (
        <div className="border-b border-hairline px-4 py-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-btn border border-dashed border-hairline py-3 text-[12px] text-ink-muted hover:bg-page">
            <Upload size={13} />
            {node.output ? 'Replace photo' : 'Upload photo'}
            <input
              type="file"
              accept="image/*"
              data-testid={TID.panelUpload}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadTo(selection, f);
              }}
            />
          </label>
        </div>
      )}

      {sections.map((section, i) => {
        if (section.type === 'inputs') {
          return (
            <div key={i} data-testid={TID.panelInputs} className="border-b border-hairline px-4 py-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                Input assignment
              </p>
              <div className="space-y-1.5">
                {section.rows.map((row) => (
                  <div
                    key={row.slot}
                    data-testid={TID.panelSlotRow(row.slot)}
                    className="flex items-center gap-2 rounded-slot border border-hairline px-2.5 py-1.5"
                  >
                    <span className="flex-1 text-[11px] font-medium text-ink">{row.label}</span>
                    {row.bound ? (
                      <>
                        <span className="max-w-[110px] truncate text-[11px] text-ink-muted">
                          {row.bound.sourceLabel}
                        </span>
                        <button
                          type="button"
                          data-testid={TID.panelUnlink(row.slot)}
                          onClick={() => deleteEdge(row.bound!.edgeId)}
                          aria-label={`Unlink ${row.label}`}
                          className="text-ink-subtle hover:text-failed"
                        >
                          <Link2Off size={12} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-ink-subtle">Skip</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (section.type === 'fields') {
          return (
            <div key={i} className="border-b border-hairline px-4 py-3">
              {section.fields.map((field) => {
                if (node.kind === 'voice' && field.id === 'voiceId') {
                  return (
                    <div key={field.id} className="mt-3">
                      <VoicePicker
                        selectedVoiceId={String(node.config['voiceId'] ?? '')}
                        onSelect={(voiceId) => updateConfig(selection, { voiceId })}
                      />
                    </div>
                  );
                }
                const value = node.config[field.id];
                return (
                  <label key={field.id} className="mb-3 block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                      {field.label}
                    </span>
                    {field.type === 'textarea' ? (
                      <textarea
                        data-testid={TID.panelField(field.id)}
                        value={typeof value === 'string' ? value : ''}
                        placeholder={field.placeholder}
                        rows={3}
                        onChange={(e) => updateConfig(selection, { [field.id]: e.target.value })}
                        className="w-full resize-none rounded-slot border border-hairline px-2.5 py-2 text-[12px] leading-snug outline-none focus:border-live"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        data-testid={TID.panelField(field.id)}
                        value={typeof value === 'string' ? value : (field.options?.[0] ?? '')}
                        onChange={(e) => updateConfig(selection, { [field.id]: e.target.value })}
                        className="w-full rounded-slot border border-hairline bg-white px-2.5 py-2 text-[12px] outline-none focus:border-live"
                      >
                        {field.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        data-testid={TID.panelField(field.id)}
                        value={typeof value === 'string' ? value : ''}
                        placeholder={field.placeholder}
                        onChange={(e) => updateConfig(selection, { [field.id]: e.target.value })}
                        className="w-full rounded-slot border border-hairline px-2.5 py-2 text-[12px] outline-none focus:border-live"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          );
        }

        if (section.type === 'approval') {
          return (
            <div key={i} className="border-b border-hairline px-4 py-3">
              {section.state === 'unapproved' ? (
                <>
                  <p className="mb-2 text-[11px] text-ink-muted">
                    Lip-sync unlocks after you approve this take.
                  </p>
                  {node.output?.assetRef.url && (
                    <audio controls src={node.output.assetRef.url} className="mb-2 w-full" />
                  )}
                  <button
                    type="button"
                    data-testid={TID.panelApprove}
                    onClick={() => void approve(selection)}
                    className="w-full rounded-btn bg-ink py-2 text-[12px] font-semibold text-white hover:bg-black"
                  >
                    Approve this take
                  </button>
                </>
              ) : (
                <div
                  data-testid={TID.panelApproved}
                  className="rounded-slot bg-done/10 px-3 py-2 text-[11px] font-semibold text-done"
                >
                  Approved. The video stage is unlocked.
                </div>
              )}
            </div>
          );
        }

        // output
        return (
          <div key={i} data-testid={TID.panelOutput} className="px-4 py-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
              Output {section.stale && <span className="ml-1 normal-case text-gated">(out of date)</span>}
            </p>
            {section.output.category === 'audio' ? (
              section.output.assetRef.url && <audio controls src={section.output.assetRef.url} className="w-full" />
            ) : (
              section.output.assetRef.url && (
                <img src={section.output.assetRef.url} alt="" className="w-full rounded-lg" />
              )
            )}
            {section.output.creditsSpent > 0 && (
              <p className="mt-1.5 text-[10px] text-ink-subtle">{section.output.creditsSpent} credits</p>
            )}
          </div>
        );
      })}
    </aside>
  );
}
