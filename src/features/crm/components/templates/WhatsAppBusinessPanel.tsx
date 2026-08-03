import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import {
  extractTemplateVars,
  slugTemplateName,
  templateProblem,
} from '../../lib/waTemplates';

/**
 * Admin panel for the ONE Meta-registered WhatsApp Business sender
 * (Hugo 2026-08-03). Two things live here:
 *  - Meta message templates: the only messages that can OPEN a WhatsApp
 *    conversation outside the 24 hour reply window. Created + submitted
 *    for Meta review through wk-whatsapp-admin.
 *  - The business profile leads see when they tap the sender's name
 *    (bio, description, website, ...). Display name changes go to Meta
 *    review; everything else applies in minutes.
 */

interface MetaTemplate {
  sid: string;
  name: string;
  language: string;
  body: string;
  date_created: string;
  approval: { status: string; category: string; rejection_reason: string };
}

interface SenderProfile {
  name: string;
  about: string;
  description: string;
  address: string;
  email: string;
  website: string;
  logo_url: string;
  vertical: string;
}

const EMPTY_PROFILE: SenderProfile = {
  name: '', about: '', description: '', address: '',
  email: '', website: '', logo_url: '', vertical: '',
};

// Twilio's allowed vertical labels for a WhatsApp sender profile.
const VERTICALS = [
  '', 'Professional Services', 'Automotive', 'Beauty, Spa and Salon',
  'Clothing and Apparel', 'Education', 'Entertainment',
  'Event Planning and Service', 'Finance and Banking', 'Food and Grocery',
  'Public Service', 'Hotel and Lodging', 'Medical and Health', 'Non-profit',
  'Shopping and Retail', 'Travel and Transportation', 'Restaurant', 'Other',
];

// supabase-js hides the edge function's JSON error body inside
// error.context; dig it out or every failure reads as "non-2xx".
async function fnErrorText(
  error: { message?: string; context?: Response } | null,
  data: { error?: string } | null,
): Promise<string | null> {
  if (data?.error) return data.error;
  if (!error) return null;
  try {
    const body = await error.context?.clone().json() as { error?: unknown } | undefined;
    if (body?.error) return String(body.error);
  } catch { /* body was not JSON, fall through */ }
  return error.message ?? 'unknown';
}

async function callAdmin<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('wk-whatsapp-admin', {
    body: payload,
  });
  if (error || (data as { error?: string } | null)?.error) {
    throw new Error((await fnErrorText(error, data as { error?: string } | null)) ?? 'request failed');
  }
  return data as T;
}

function StatusBadge({ status, reason }: { status: string; reason: string }) {
  const s = status.toLowerCase();
  const approved = s === 'approved';
  const rejected = s === 'rejected' || s === 'paused' || s === 'disabled';
  return (
    <span
      title={rejected && reason ? reason : undefined}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
        approved && 'bg-emerald-50 text-emerald-700',
        rejected && 'bg-red-50 text-red-600',
        !approved && !rejected && 'bg-amber-50 text-amber-700',
      )}
    >
      {approved && <BadgeCheck className="w-3 h-3" />}
      {approved ? 'Approved' : rejected ? status : 'In review'}
    </span>
  );
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-[13px] text-[#1A1A1A] bg-white focus:outline-none focus:border-[#3C5A87]';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-[#6B7280] mb-1';

export default function WhatsAppBusinessPanel() {
  // ---- templates ----
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplError, setTplError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // ---- profile ----
  const [profile, setProfile] = useState<SenderProfile>(EMPTY_PROFILE);
  const [senderLine, setSenderLine] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    setTplError(null);
    try {
      const res = await callAdmin<{ templates: MetaTemplate[] }>({ action: 'template_list' });
      setTemplates(res.templates ?? []);
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'failed to load templates');
    } finally {
      setTplLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await callAdmin<{
        sender: string; status: string; quality_rating: string;
        messaging_limit: string; profile: SenderProfile;
      }>({ action: 'profile_get' });
      setProfile({ ...EMPTY_PROFILE, ...res.profile });
      setSenderLine(
        `${res.sender.replace('whatsapp:', '')} is ${res.status}. Quality ${res.quality_rating || 'unknown'}, limit ${res.messaging_limit || 'unknown'}.`,
      );
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'failed to load profile');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadProfile();
  }, [loadTemplates, loadProfile]);

  const bodyVars = extractTemplateVars(newBody);
  const newProblem = creating && (newName || newBody)
    ? templateProblem(newName, newBody)
    : null;

  const submitTemplate = async () => {
    const problem = templateProblem(newName, newBody);
    if (problem) { setTplError(problem); return; }
    setSubmitting(true);
    setTplError(null);
    try {
      await callAdmin({
        action: 'template_create',
        name: newName,
        body: newBody,
        category: newCategory,
        samples,
      });
      setCreating(false);
      setNewName('');
      setNewBody('');
      setSamples({});
      await loadTemplates();
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTemplate = async (t: MetaTemplate) => {
    if (!confirm(`Delete Meta template "${t.name}"?`)) return;
    setTplError(null);
    try {
      await callAdmin({ action: 'template_delete', content_sid: t.sid });
      await loadTemplates();
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'delete failed');
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setProfileError(null);
    setProfileNote(null);
    try {
      const res = await callAdmin<{ note?: string }>({
        action: 'profile_update',
        profile,
      });
      setProfileNote(res.note ?? 'Saved.');
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const setP = (key: keyof SenderProfile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setProfile((p) => ({ ...p, [key]: e.target.value }));

  return (
    <div data-testid="wa-business-panel" className="mb-6 pb-6 border-b border-[#E5E7EB]">
      {/* ---------------- Meta templates ---------------- */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[14px] font-bold text-[#1A1A1A]">Meta approved templates</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadTemplates()}
            title="Refresh approval status"
            className="p-1.5 rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', tplLoading && 'animate-spin')} />
          </button>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              data-testid="wa-new-meta-template"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#3C5A87] text-white text-[12px] font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> New Meta template
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[#6B7280] leading-snug mb-3">
        These are the only WhatsApp messages you can send when a lead has not written to you in
        the last 24 hours. Meta reviews each one, usually within the hour. The quick templates
        further down work only inside that 24 hour window.
      </p>

      {tplError && (
        <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {tplError}
        </div>
      )}

      {creating && (
        <div className="mb-3 border border-[#E5E7EB] rounded-xl p-3 bg-[#FAFAF7]">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelCls}>Template name</label>
              <input
                className={inputCls}
                placeholder="instagram_url_request"
                value={newName}
                onChange={(e) => setNewName(slugTemplateName(e.target.value))}
                data-testid="wa-tpl-name"
              />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select
                className={inputCls}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as 'MARKETING' | 'UTILITY')}
              >
                <option value="MARKETING">Marketing (safe default)</option>
                <option value="UTILITY">Utility (order/account updates only)</option>
              </select>
            </div>
          </div>
          <label className={labelCls}>Body (use {'{{1}}'} for the lead's first name)</label>
          <textarea
            className={cn(inputCls, 'min-h-[96px] resize-y')}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={'Hi {{1}}, thanks for your interest!'}
            data-testid="wa-tpl-body"
          />
          {bodyVars.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {bodyVars.map((v) => (
                <div key={v}>
                  <label className={labelCls}>Sample for {'{{'}{v}{'}}'} (shown to Meta's reviewer)</label>
                  <input
                    className={inputCls}
                    value={samples[v] ?? ''}
                    placeholder="John"
                    onChange={(e) => setSamples((s) => ({ ...s, [v]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          {newProblem && (
            <div className="mt-2 text-[11px] text-amber-700">{newProblem}</div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void submitTemplate()}
              disabled={submitting || !!templateProblem(newName, newBody)}
              data-testid="wa-tpl-submit"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3C5A87] text-white text-[12px] font-medium disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Submit for approval
            </button>
            <button
              onClick={() => { setCreating(false); setTplError(null); }}
              className="px-3 py-1.5 text-[12px] text-[#6B7280]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tplLoading && templates.length === 0 ? (
        <div className="text-[12px] text-[#6B7280] py-2">Loading templates from Twilio...</div>
      ) : templates.length === 0 ? (
        <div className="text-[12px] text-[#6B7280] py-2">
          No Meta templates yet. Create one to unlock messaging leads outside the 24 hour window.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.sid}
              data-testid={`wa-meta-template-${t.name}`}
              className="border border-[#E5E7EB] rounded-xl px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[#1A1A1A]">{t.name}</span>
                <StatusBadge status={t.approval.status} reason={t.approval.rejection_reason} />
                {t.approval.category && (
                  <span className="text-[10px] text-[#9CA3AF] uppercase">{t.approval.category}</span>
                )}
                <span className="text-[10px] text-[#9CA3AF] uppercase">{t.language}</span>
                <button
                  onClick={() => void deleteTemplate(t)}
                  title="Delete template"
                  className="ml-auto p-1 text-[#9CA3AF] hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-[12px] text-[#4B5563] whitespace-pre-wrap mt-1">{t.body}</div>
              {t.approval.rejection_reason && (
                <div className="text-[11px] text-red-600 mt-1">
                  Meta said: {t.approval.rejection_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Business profile ---------------- */}
      <div className="mt-6">
        <h2 className="text-[14px] font-bold text-[#1A1A1A] mb-1">WhatsApp business profile</h2>
        <p className="text-[11px] text-[#6B7280] leading-snug mb-3">
          What a lead sees when they tap your name in WhatsApp.
          {senderLine ? ` ${senderLine}` : ''}
        </p>

        {profileError && (
          <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {profileError}
          </div>
        )}
        {profileNote && (
          <div className="mb-3 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {profileNote}
          </div>
        )}

        {profileLoading ? (
          <div className="text-[12px] text-[#6B7280] py-2">Loading profile from Twilio...</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Display name (Meta reviews changes)</label>
              <input className={inputCls} value={profile.name} onChange={setP('name')} data-testid="wa-profile-name" />
            </div>
            <div>
              <label className={labelCls}>About / bio ({profile.about.length}/139)</label>
              <input className={inputCls} maxLength={139} value={profile.about} onChange={setP('about')} data-testid="wa-profile-about" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Description ({profile.description.length}/512)</label>
              <input className={inputCls} maxLength={512} value={profile.description} onChange={setP('description')} />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <input className={inputCls} placeholder="https://heypubli.com" value={profile.website} onChange={setP('website')} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} value={profile.email} onChange={setP('email')} />
            </div>
            <div>
              <label className={labelCls}>Address</label>
              <input className={inputCls} value={profile.address} onChange={setP('address')} />
            </div>
            <div>
              <label className={labelCls}>Industry</label>
              <select className={inputCls} value={profile.vertical} onChange={setP('vertical')}>
                {VERTICALS.map((v) => (
                  <option key={v || 'none'} value={v}>{v || 'Not set'}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Logo URL (public image link)</label>
              <input className={inputCls} value={profile.logo_url} onChange={setP('logo_url')} />
            </div>
            <div className="col-span-2">
              <button
                onClick={() => void saveProfile()}
                disabled={saving}
                data-testid="wa-profile-save"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3C5A87] text-white text-[12px] font-medium disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save profile
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
