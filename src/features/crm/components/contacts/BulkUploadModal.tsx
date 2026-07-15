import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { X, Upload, FileText, Users, Lock, AlertTriangle, Phone, Columns3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { toE164 } from '@/features/crm/lib/phone';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useAgentsToday } from '../../hooks/useAgentsToday';
import { useDialerCampaigns } from '../../hooks/useDialerCampaigns';
import { usePipelines } from '../../hooks/usePipelines';

const PIPELINE_LS_KEY = 'crm_bulk_import_pipeline_id';

/** First column of a pipeline, preferring one literally named "New Leads"
 *  (case-insensitive) so imports default to the same starting stage even
 *  if the agent reordered columns. Falls back to lowest position. */
function pickDefaultStage(
  cols: Array<{ id: string; name: string; pipelineId: string; position: number }>,
  pipelineId: string,
): string | undefined {
  const inPipeline = cols.filter((c) => c.pipelineId === pipelineId);
  const newLeads = inPipeline.find((c) => c.name.toLowerCase().trim() === 'new leads');
  if (newLeads) return newLeads.id;
  return [...inPipeline].sort((a, b) => a.position - b.position)[0]?.id;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** PR 62 (Hugo 2026-04-27): when set, the modal pre-fills the
   *  campaign picker with this id and locks it (admin can't change
   *  it). Used by the per-campaign Settings → Upload leads tab. */
  prefillCampaignId?: string | null;
  /** Locks the campaign picker so the admin can't accidentally
   *  upload to the wrong one. Defaults to true when prefillCampaignId
   *  is set. */
  lockCampaign?: boolean;
}

interface ParsedRow {
  name: string;
  phone: string;        // canonical E.164
  rawPhone: string;     // original CSV value (for the error report)
  email?: string;
  customFields: Record<string, string>;
}

interface ImportResult {
  inserted: number;
  skipped: number;
  /** PR 22: how many contacts were also enqueued into wk_dialer_queue
   *  (campaign + contact_id rows ready for parallel dial). */
  queued: number;
  errors: string[];
}

const PHONE_KEYS = ['phone', 'mobile', 'number', 'tel', 'whatsapp'];
const NAME_KEYS = ['name', 'full_name', 'fullname', 'contact_name'];
const EMAIL_KEYS = ['email', 'e-mail', 'mail'];

// Header aliases that should be normalised to the canonical custom_fields
// key so they appear in the dedicated "Property address" / "Property URL"
// columns on /crm/contacts. CSV authors don't have to remember the exact
// underscored key — Property Address / address / street_address all work.
const PROPERTY_ADDRESS_KEYS = [
  'property_address', 'property address', 'address', 'street_address',
  'street address', 'street', 'location', 'property location',
];
const PROPERTY_URL_KEYS = [
  'property_url', 'property url', 'url', 'website', 'web', 'link',
  'listing_url', 'listing url', 'property link', 'listing',
];

const CUSTOM_FIELD_ALIASES: Array<{ canonical: string; keys: string[] }> = [
  { canonical: 'property_address', keys: PROPERTY_ADDRESS_KEYS },
  { canonical: 'property_url', keys: PROPERTY_URL_KEYS },
];

function pickKey(row: Record<string, string>, candidates: string[]): string | undefined {
  const lowered = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase().trim()] = k;
    return acc;
  }, {});
  for (const c of candidates) {
    const real = lowered[c];
    if (real && row[real] && row[real].trim()) return real;
  }
  return undefined;
}

export default function BulkUploadModal({
  open,
  onClose,
  prefillCampaignId = null,
  lockCampaign,
}: Props) {
  const [step, setStep] = useState<'pick' | 'review' | 'importing' | 'done'>('pick');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [assignTo, setAssignTo] = useState<string>('me');
  const [tags, setTags] = useState<string>('imported');
  const [result, setResult] = useState<ImportResult | null>(null);
  const { columns, pushToast } = useSmsV2();
  const { agents } = useAgentsToday();
  const { campaigns } = useDialerCampaigns({ includeInactive: true });

  // Pipeline picker uses the shared usePipelines() cache so this modal
  // doesn't repeat the silent-hang failure mode the page-level picker
  // had before 2026-05-22.
  const { pipelines } = usePipelines();
  const [pipelineId, setPipelineId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');

  // When opened with prefillCampaignId, follow the campaign's
  // pipeline_id so contacts uploaded from a campaign's Leads tab
  // ALWAYS land in that campaign's pipeline — not localStorage's
  // last pick. Resolved once pipelines + campaigns have loaded.
  const lockedPipelineId = useMemo(() => {
    if (!prefillCampaignId) return null;
    const c = campaigns.find((cc) => cc.id === prefillCampaignId);
    return c?.pipelineId || null;
  }, [campaigns, prefillCampaignId]);

  // Pick a pipeline once the cache has rows (and re-pick when the modal
  // re-opens or when the locked campaign changes).
  useEffect(() => {
    if (!open) return;
    if (pipelines.length === 0) return;
    if (lockedPipelineId && pipelines.some((r) => r.id === lockedPipelineId)) {
      setPipelineId(lockedPipelineId);
      return;
    }
    const stored = typeof window !== 'undefined' ? localStorage.getItem(PIPELINE_LS_KEY) : null;
    const pick = stored && pipelines.find((p) => p.id === stored) ? stored : pipelines[0].id;
    setPipelineId(pick);
  }, [open, lockedPipelineId, pipelines]);

  // If the user navigates between campaigns (modal stays mounted), or
  // the campaigns hook resolves AFTER the initial load, snap back to
  // the locked pipeline. Cheap because pipelineId only updates when
  // it actually differs.
  useEffect(() => {
    if (lockedPipelineId && pipelineId !== lockedPipelineId) {
      setPipelineId(lockedPipelineId);
    }
  }, [lockedPipelineId, pipelineId]);

  // When pipelineId changes (or columns hydrate after the picker mounts),
  // reset stage to that pipeline's "New Leads" (or first column).
  useEffect(() => {
    if (!pipelineId || columns.length === 0) return;
    const next = pickDefaultStage(columns, pipelineId);
    if (next) setStageId(next);
  }, [pipelineId, columns]);

  const stageOptions = useMemo(() => {
    if (!pipelineId) return columns;
    return columns
      .filter((c) => c.pipelineId === pipelineId)
      .sort((a, b) => a.position - b.position);
  }, [columns, pipelineId]);

  const onPickPipeline = (id: string) => {
    if (lockedPipelineId) return; // can't override the campaign's pipeline
    setPipelineId(id);
    try { localStorage.setItem(PIPELINE_LS_KEY, id); } catch { /* ignore */ }
  };
  // PR 22: optional "add to campaign queue" — when set, the imported
  // contacts are also INSERTed into wk_dialer_queue for that campaign
  // so wk-dialer-start has leads to pick from.
  // PR 62: prefilled when opened from a campaign Settings page.
  const [campaignId, setCampaignId] = useState<string>(prefillCampaignId ?? '');
  // Re-sync if the parent prop changes between mount cycles.
  if (open && prefillCampaignId && campaignId !== prefillCampaignId) {
    setCampaignId(prefillCampaignId);
  }
  const isCampaignLocked = lockCampaign ?? !!prefillCampaignId;

  if (!open) return null;

  const reset = () => {
    setStep('pick');
    setRows([]);
    setParseErrors([]);
    setFileName('');
    setAssignTo('me');
    setTags('imported');
    setResult(null);
    setStageId(columns[0]?.id ?? '');
    setCampaignId('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const errs: string[] = [];
        const seen = new Set<string>();
        const seenEmails = new Set<string>();
        const accepted: ParsedRow[] = [];
        for (const [i, raw] of parsed.data.entries()) {
          const phoneKey = pickKey(raw, PHONE_KEYS);
          if (!phoneKey) {
            errs.push(`Row ${i + 2}: missing phone column`);
            continue;
          }
          const phoneRaw = raw[phoneKey].trim();
          const phone = toE164(phoneRaw);
          if (!phone) {
            errs.push(`Row ${i + 2}: cannot parse phone "${phoneRaw}"`);
            continue;
          }
          if (seen.has(phone)) {
            errs.push(`Row ${i + 2}: duplicate phone "${phone}" — skipped`);
            continue;
          }
          seen.add(phone);

          const nameKey = pickKey(raw, NAME_KEYS);
          const name = nameKey ? raw[nameKey].trim() : phone;
          const emailKey = pickKey(raw, EMAIL_KEYS);
          const emailRaw = emailKey ? raw[emailKey].trim() : '';
          let email: string | undefined = emailRaw || undefined;
          if (email) {
            const lc = email.toLowerCase();
            if (seenEmails.has(lc)) {
              email = undefined;
            } else {
              seenEmails.add(lc);
            }
          }

          // Custom fields: anything that wasn't phone/name/email. Headers
          // matching one of CUSTOM_FIELD_ALIASES (e.g. "address",
          // "Property Address", "website") are renamed to their canonical
          // key (property_address / property_url) so they populate the
          // dedicated columns on /crm/contacts. Everything else is stored
          // under its original header name.
          const customFields: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            if (k === phoneKey || k === nameKey || k === emailKey) continue;
            const lk = k.toLowerCase().trim();
            if (PHONE_KEYS.includes(lk) || NAME_KEYS.includes(lk) || EMAIL_KEYS.includes(lk)) continue;
            const val = (v ?? '').trim();
            if (!val) continue;
            const alias = CUSTOM_FIELD_ALIASES.find((a) => a.keys.includes(lk));
            const targetKey = alias ? alias.canonical : k;
            // First-write wins so an explicit "property_address" column
            // overrides a vague "address" column if both happen to exist.
            if (customFields[targetKey] === undefined) {
              customFields[targetKey] = val;
            }
          }

          accepted.push({ name, phone, rawPhone: phoneRaw, email, customFields });
        }
        setRows(accepted);
        setParseErrors(errs);
        setStep('review');
      },
      error: (err) => {
        setParseErrors([`Parse error: ${err.message}`]);
        setStep('review');
      },
    });
  };

  const runImport = async () => {
    setStep('importing');
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);

    // Decide owner
    const { data: { user } } = await supabase.auth.getUser();
    let ownerAgentId: string | null = null;
    if (assignTo === 'me') ownerAgentId = user?.id ?? null;
    else if (assignTo === 'pull') ownerAgentId = null; // shared queue
    else if (assignTo !== 'round_robin') ownerAgentId = assignTo;

    const inserts = rows.map((row, i) => {
      const ownerForThis =
        assignTo === 'round_robin'
          ? agents[i % Math.max(1, agents.length)]?.id ?? null
          : ownerAgentId;
      return {
        name: row.name,
        phone: row.phone,
        email: row.email || null,
        owner_agent_id: ownerForThis,
        pipeline_column_id: stageId || null,
        custom_fields: row.customFields,
        is_hot: false,
      };
    });

    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;
    let queued = 0;
    // Phones uploaded in this batch — used after the upsert to look
    // up contact ids (existing rows aren't returned by the
    // ignoreDuplicates upsert, so we need a separate SELECT to get
    // their ids for the dialer-queue insert).
    const allPhones = inserts.map((r) => r.phone);

    // Chunk inserts to avoid hitting URL/payload limits
    const CHUNK = 50;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const slice = inserts.slice(i, i + CHUNK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { data, error } = await (supabase.from('wk_contacts' as any) as any)
        .upsert(slice, { onConflict: 'phone', ignoreDuplicates: true })
        .select('id, phone');

      if (error?.message?.includes('wk_contacts_email_uniq')) {
        const stripped = slice.map((r: Record<string, unknown>) => ({ ...r, email: null }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ data, error } = await (supabase.from('wk_contacts' as any) as any)
          .upsert(stripped, { onConflict: 'phone', ignoreDuplicates: true })
          .select('id, phone'));
      }

      if (error) {
        errors.push(error.message);
        continue;
      }
      const insertedRows = (data ?? []) as Array<{ id: string; phone: string }>;
      inserted += insertedRows.length;
      skipped += slice.length - insertedRows.length;

      // Tag every inserted row
      if (tagList.length > 0 && insertedRows.length > 0) {
        const tagInserts = insertedRows.flatMap((r) =>
          tagList.map((tag) => ({ contact_id: r.id, tag }))
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: tagErr } = await (supabase.from('wk_contact_tags' as any) as any)
          .upsert(tagInserts, { onConflict: 'contact_id,tag', ignoreDuplicates: true });
        if (tagErr) errors.push(`tags: ${tagErr.message}`);
      }
    }

    // PR 22: enqueue the uploaded contacts into wk_dialer_queue if a
    // campaign was picked. Re-fetch ids by phone so that already-
    // existing contacts (skipped in the upsert) are also enqueued —
    // Hugo's expectation: "uploaded list = ready to dial".
    //
    // PR 119 (Hugo 2026-04-28): we used to .upsert with
    //   onConflict: 'campaign_id,contact_id'
    // but PR 33 (migration 20260430000010) deliberately DROPPED that
    // unique constraint so the same contact can be queued multiple
    // times (retry policies, multi-attempt campaigns, test fixtures).
    // Postgres now rejects the upsert with:
    //   "there is no unique or exclusion constraint matching the
    //    ON CONFLICT specification"
    // Fix: dedupe in code instead. Pull existing PENDING queue rows
    // for this campaign + these contacts, skip those, plain INSERT
    // the rest. Re-uploading the same CSV is idempotent for already-
    // pending leads, but a contact whose previous queue row is
    // already done/failed can be re-queued (matches design intent).
    if (campaignId && allPhones.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: idRows, error: idErr } = await (
          supabase.from('wk_contacts' as any) as any
        )
          .select('id, phone')
          .in('phone', allPhones);
        if (idErr) {
          errors.push(`queue lookup: ${idErr.message}`);
        } else {
          const contactIds = ((idRows ?? []) as Array<{ id: string; phone: string }>)
            .map((r) => r.id);

          // Find which of these are already pending in this campaign so
          // we don't double-enqueue on a re-upload of the same CSV.
          const alreadyPending = new Set<string>();
          if (contactIds.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: existing, error: existErr } = await (
              supabase.from('wk_dialer_queue' as any) as any
            )
              .select('contact_id')
              .eq('campaign_id', campaignId)
              .eq('status', 'pending')
              .in('contact_id', contactIds);
            if (existErr) {
              errors.push(`queue dedupe: ${existErr.message}`);
            } else {
              for (const r of (existing ?? []) as Array<{ contact_id: string }>) {
                alreadyPending.add(r.contact_id);
              }
            }
          }

          const queueInserts = contactIds
            .filter((id) => !alreadyPending.has(id))
            .map((id) => ({
              campaign_id: campaignId,
              contact_id: id,
              status: 'pending',
              priority: 0,
            }));

          // Chunk to avoid payload limits.
          for (let i = 0; i < queueInserts.length; i += CHUNK) {
            const slice = queueInserts.slice(i, i + CHUNK);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: qData, error: qErr } = await (
              supabase.from('wk_dialer_queue' as any) as any
            )
              .insert(slice)
              .select('id');
            if (qErr) {
              errors.push(`queue: ${qErr.message}`);
              continue;
            }
            queued += ((qData ?? []) as unknown[]).length;
          }
        }
      } catch (e) {
        errors.push(
          `queue: ${e instanceof Error ? e.message : 'unknown error'}`
        );
      }
    }

    setResult({ inserted, skipped, queued, errors });
    setStep('done');
    const queuedNote = campaignId
      ? ` · ${queued} queued for dial`
      : '';
    pushToast(
      `Imported ${inserted} contacts (${skipped} skipped)${queuedNote}`,
      inserted > 0 ? 'success' : 'info'
    );
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-[640px] bg-white rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.18)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-[#1A1A1A]">Bulk import contacts</h3>
            <p className="text-[11px] text-[#6B7280]">
              CSV → assign to user → only that user + admins can see them
            </p>
          </div>
          <button onClick={close} className="p-1.5 rounded hover:bg-[#F3F3EE]">
            <X className="w-4 h-4 text-[#6B7280]" />
          </button>
        </div>

        {step === 'pick' && (
          <div className="p-5 space-y-4">
            <label className="block border-2 border-dashed border-[#E5E7EB] rounded-2xl p-8 text-center cursor-pointer hover:border-[#1E9A80] hover:bg-[#ECFDF5]/30 transition-colors">
              <input type="file" accept=".csv" className="hidden" onChange={onFile} />
              <Upload className="w-7 h-7 text-[#9CA3AF] mx-auto mb-2" />
              <div className="text-[14px] font-medium text-[#1A1A1A]">
                Drop CSV or click to browse
              </div>
              <div className="text-[11px] text-[#6B7280] mt-0.5">
                Required cols: name, phone · Optional: email, anything else becomes a custom field
              </div>
            </label>
          </div>
        )}

        {step === 'review' && (
          <>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#ECFDF5] border border-[#1E9A80]/30 rounded-[10px]">
                <FileText className="w-4 h-4 text-[#1E9A80]" />
                <div className="flex-1 text-[12px]">
                  <span className="font-semibold text-[#1A1A1A]">{fileName || 'CSV'}</span>
                  <span className="text-[#6B7280] ml-2">
                    · {rows.length} valid rows · {parseErrors.length} skipped
                  </span>
                </div>
              </div>

              {parseErrors.length > 0 && (
                <details className="bg-[#FEF2F2] border border-[#FECACA] rounded-[10px] px-3 py-2 text-[11px] text-[#991B1B]">
                  <summary className="cursor-pointer flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {parseErrors.length} row{parseErrors.length === 1 ? '' : 's'} skipped — click to view
                  </summary>
                  <ul className="mt-2 max-h-[120px] overflow-y-auto space-y-0.5 list-disc list-inside">
                    {parseErrors.slice(0, 50).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {parseErrors.length > 50 && <li>…and {parseErrors.length - 50} more</li>}
                  </ul>
                </details>
              )}

              <div>
                <Label icon={<Users className="w-3.5 h-3.5" />}>Assign to</Label>
                <select
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
                >
                  <option value="me">Me (current user)</option>
                  <option value="round_robin">Round-robin across all agents</option>
                  <option value="pull">Shared queue (no owner — agents pull)</option>
                  {agents.length > 0 && (
                    <optgroup label="Specific agent (only they + admins see)">
                      {agents.filter((a) => !a.isAdmin).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {assignTo !== 'round_robin' && assignTo !== 'pull' && assignTo !== 'me' && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#1E9A80]">
                    <Lock className="w-3 h-3" />
                    Visibility: only {agents.find((a) => a.id === assignTo)?.name} + admins
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label icon={<Columns3 className="w-3.5 h-3.5" />}>Pipeline</Label>
                  <select
                    value={pipelineId}
                    onChange={(e) => onPickPipeline(e.target.value)}
                    disabled={!!lockedPipelineId}
                    className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white disabled:bg-[#F3F3EE] disabled:text-[#6B7280]"
                  >
                    {pipelines.length === 0 && <option value="">Loading…</option>}
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {lockedPipelineId && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#1E9A80]">
                      <Lock className="w-3 h-3" />
                      Pinned by the campaign — uploads land in this pipeline
                    </div>
                  )}
                </div>
                <div>
                  <Label>Initial stage</Label>
                  <select
                    value={stageId}
                    onChange={(e) => setStageId(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
                  >
                    {stageOptions.length === 0 && <option value="">No stages</option>}
                    {stageOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Tags (comma-separated)</Label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px]"
                />
              </div>

              {/* PR 22: optional campaign queue. When set, every uploaded
                  contact (new or already-existing) is also INSERTed
                  into wk_dialer_queue for that campaign. Without this,
                  the parallel dialer has no leads to pick from. */}
              <div>
                <Label icon={<Phone className="w-3.5 h-3.5" />}>
                  {isCampaignLocked
                    ? 'Adding leads to this campaign'
                    : 'Add to dialer queue (optional)'}
                </Label>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  disabled={isCampaignLocked}
                  className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white disabled:bg-[#F3F3EE] disabled:text-[#6B7280]"
                >
                  {!isCampaignLocked && (
                    <option value="">— don't queue, just import —</option>
                  )}
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.parallelLines} {c.parallelLines === 1 ? 'line' : 'lines'})
                    </option>
                  ))}
                </select>
                {campaignId && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#1E9A80]">
                    <Phone className="w-3 h-3" />
                    These leads will be ready to dial via the campaign on /crm/dialer
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 bg-[#F3F3EE]/50 border-t border-[#E5E7EB] flex justify-between">
              <button
                onClick={() => setStep('pick')}
                className="text-[12px] text-[#6B7280] hover:text-[#1A1A1A]"
              >
                ← Back
              </button>
              <button
                onClick={() => void runImport()}
                disabled={rows.length === 0}
                className="bg-[#1E9A80] text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#1E9A80]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Import {rows.length} contact{rows.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="p-12 text-center">
            <div className="inline-block w-8 h-8 border-2 border-[#1E9A80] border-t-transparent rounded-full animate-spin mb-3" />
            <div className="text-[13px] text-[#6B7280]">Importing {rows.length} contacts…</div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#ECFDF5] text-[#1E9A80] flex items-center justify-center mx-auto mb-3 text-[24px]">
              ✓
            </div>
            <h3 className="text-[16px] font-semibold text-[#1A1A1A]">
              {result.inserted} contacts imported
            </h3>
            <p className="text-[12px] text-[#6B7280] mt-1">
              {result.skipped > 0 && `${result.skipped} duplicates skipped · `}
              {result.queued > 0 && `${result.queued} queued for dial · `}
              {result.errors.length > 0 ? `${result.errors.length} errors` : 'no errors'}
            </p>
            {result.errors.length > 0 && (
              <details className="mt-3 text-left text-[11px] text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-[10px] p-2">
                <summary className="cursor-pointer">View errors</summary>
                <ul className="mt-1 max-h-[120px] overflow-y-auto list-disc list-inside">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              onClick={close}
              className="mt-4 bg-[#1E9A80] text-white text-[13px] font-semibold px-5 py-2 rounded-[10px]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1 flex items-center gap-1">
      {icon}
      {children}
    </div>
  );
}
