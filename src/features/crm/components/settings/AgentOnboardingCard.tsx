import { useMemo, useState } from 'react';
import { Copy, Check, Plus, Trash2, ExternalLink } from 'lucide-react';
import { useAgentAgreement, type AgreementTerm } from '../../hooks/useAgentAgreement';
import { useAgentSignups } from '../../hooks/useAgentSignups';

/**
 * Hire & onboard agents — lives at the top of Settings → Agents & spend.
 *  - the shareable /join link you send to a new hire
 *  - an open/closed switch (closed = the link stops creating accounts)
 *  - the editable agreement the hire signs
 *  - the list of who has signed (created ones also show in the roster below)
 * Admin-only (the whole Settings page is AdminOnlyRoute).
 */

function Card({ title, hint, children }: { title: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1A1A1A]">{title}</h3>
        {hint && <span className="text-[11px] text-[#9CA3AF]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  signed: { label: 'Signed', cls: 'bg-[#FEF3C7] text-[#B45309]' },
  code_sent: { label: 'Code sent', cls: 'bg-[#EEF2F8] text-[#3C5A87]' },
  created: { label: 'Account created', cls: 'bg-[#DEF3E8] text-[#2E7D5B]' },
};

export default function AgentOnboardingCard() {
  const { agreement, loading, saving, error, save } = useAgentAgreement();
  const { signups, refresh } = useAgentSignups();

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  // Local draft while editing the agreement.
  const [dTitle, setDTitle] = useState('');
  const [dCompany, setDCompany] = useState('');
  const [dIntro, setDIntro] = useState('');
  const [dTerms, setDTerms] = useState<AgreementTerm[]>([]);

  const joinUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.heyelsie.com';
    return `${origin}/join`;
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the input is selectable as a fallback */ }
  };

  const startEdit = () => {
    setDTitle(agreement.title);
    setDCompany(agreement.company);
    setDIntro(agreement.intro);
    setDTerms(agreement.terms.length ? agreement.terms : [{ heading: '', body: '' }]);
    setEditing(true);
  };

  const saveEdit = async () => {
    const cleanTerms = dTerms.filter((t) => t.heading.trim() || t.body.trim());
    const ok = await save({ title: dTitle.trim(), company: dCompany.trim() || 'HeyElsie', intro: dIntro.trim(), terms: cleanTerms });
    if (ok) setEditing(false);
  };

  const toggleOpen = () => void save({ onboarding_open: !agreement.onboarding_open });

  return (
    <>
      <Card title="Hire &amp; onboard agents" hint="Send the link → they sign → they appear below">
        {/* Shareable link */}
        <Field label="Onboarding link (send this to a new hire)">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={joinUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-[#F9FAFB] font-mono"
            />
            <button
              onClick={() => void copyLink()}
              className="inline-flex items-center gap-1.5 bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-2 rounded-[10px] hover:bg-[#33507a]"
            >
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </button>
            <a
              href={joinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 border border-[#E5E7EB] text-[#1A1A1A] text-[12px] font-medium px-3 py-2 rounded-[10px] hover:bg-[#F3F3EE]"
              title="Preview the sign page"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open
            </a>
          </div>
        </Field>

        {/* Open / closed */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#E5E7EB]">
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A]">Onboarding {agreement.onboarding_open ? 'open' : 'closed'}</div>
            <div className="text-[11px] text-[#6B7280]">
              {agreement.onboarding_open
                ? 'Anyone with the link can sign and create an agent account.'
                : 'The link is live but no new accounts can be created.'}
            </div>
          </div>
          <button
            onClick={toggleOpen}
            disabled={saving || loading}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold border disabled:opacity-60 ${
              agreement.onboarding_open
                ? 'bg-[#DEF3E8] text-[#2E7D5B] border-[#2E7D5B]/30'
                : 'bg-[#FEF3C7] text-[#B45309] border-[#F59E0B]/30'
            }`}
          >
            {agreement.onboarding_open ? '🟢 Open' : '⏸ Closed'}
          </button>
        </div>

        {error && <div className="text-[11px] text-[#B91C1C] mt-2">⚠ {error}</div>}
      </Card>

      {/* Agreement editor */}
      <Card
        title="The agreement they sign"
        hint={editing ? undefined : 'What the new hire reads before signing'}
      >
        {!editing ? (
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A]">{agreement.title}</div>
            <div className="text-[12px] text-[#6B7280] mt-1 mb-3 leading-relaxed">{agreement.intro}</div>
            <div className="space-y-2">
              {agreement.terms.map((t, i) => (
                <div key={i} className="border border-[#E5E7EB] rounded-lg p-2.5">
                  <div className="text-[12px] font-semibold text-[#1A1A1A]">{t.heading}</div>
                  <div className="text-[11px] text-[#6B7280] leading-snug">{t.body}</div>
                </div>
              ))}
              {agreement.terms.length === 0 && (
                <div className="text-[12px] text-[#9CA3AF] italic">No terms yet. Click Edit to add some.</div>
              )}
            </div>
            <button
              onClick={startEdit}
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3C5A87] hover:bg-[#EEF2F8] px-3 py-1.5 rounded-[10px]"
            >
              Edit agreement
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Agreement title">
                <input
                  value={dTitle}
                  onChange={(e) => setDTitle(e.target.value)}
                  className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px]"
                />
              </Field>
              <Field label="Company name">
                <input
                  value={dCompany}
                  onChange={(e) => setDCompany(e.target.value)}
                  className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px]"
                />
              </Field>
            </div>
            <Field label="Intro line">
              <textarea
                value={dIntro}
                onChange={(e) => setDIntro(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px]"
              />
            </Field>

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">Terms sections</div>
              {dTerms.map((t, i) => (
                <div key={i} className="border border-[#E5E7EB] rounded-xl p-2.5 space-y-1.5 bg-[#F9FAFB]">
                  <div className="flex items-center gap-2">
                    <input
                      value={t.heading}
                      onChange={(e) => setDTerms(dTerms.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))}
                      placeholder="Heading (e.g. Your role)"
                      className="flex-1 px-2.5 py-1.5 text-[12px] font-semibold border border-[#E5E7EB] rounded-[8px] bg-white"
                    />
                    <button
                      onClick={() => setDTerms(dTerms.filter((_, j) => j !== i))}
                      className="text-[#9CA3AF] hover:text-[#EF4444] p-1.5 rounded"
                      title="Remove section"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={t.body}
                    onChange={(e) => setDTerms(dTerms.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                    placeholder="What this section says…"
                    rows={2}
                    className="w-full px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white"
                  />
                </div>
              ))}
              <button
                onClick={() => setDTerms([...dTerms, { heading: '', body: '' }])}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3C5A87] hover:bg-[#EEF2F8] px-2.5 py-1.5 rounded-[10px]"
              >
                <Plus className="w-3.5 h-3.5" /> Add section
              </button>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-[#E5E7EB]">
              <button
                onClick={() => void saveEdit()}
                disabled={saving}
                className="bg-[#3C5A87] text-white text-[12px] font-semibold px-4 py-1.5 rounded-[10px] hover:bg-[#33507a] disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save agreement'}
              </button>
              <button onClick={() => setEditing(false)} className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Signed list */}
      <Card title="Signed agreements" hint="Refreshes as people sign">
        {signups.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF] italic py-2">
            No one has signed yet. Share the link above to onboard your first agent.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
              <tr>
                <th className="text-left py-2">Name</th>
                <th className="text-left py-2">Email</th>
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Signed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {signups.map((s) => {
                const meta = STATUS_META[s.status] ?? STATUS_META.signed;
                return (
                  <tr key={s.id}>
                    <td className="py-2 font-semibold text-[#1A1A1A]">{s.name}</td>
                    <td className="py-2 text-[#6B7280]">{s.email}</td>
                    <td className="py-2">
                      <span className={`text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-2 text-right text-[#6B7280] tabular-nums">
                      {new Date(s.signed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button onClick={() => void refresh()} className="mt-3 text-[11px] text-[#3C5A87] hover:underline">
          Refresh
        </button>
      </Card>
    </>
  );
}
