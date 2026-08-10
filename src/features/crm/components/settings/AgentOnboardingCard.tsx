import { useMemo, useState } from 'react';
import { Copy, Check, Plus, Trash2, ExternalLink, FileText } from 'lucide-react';
import { useAgentAgreements, type AgreementTerm } from '../../hooks/useAgentAgreement';
import { useAgentSignups } from '../../hooks/useAgentSignups';
import { useAgreementSignatures } from '../../hooks/useAgreementSignatures';
import { openSignedAgreement, formatSignedAt } from '@/core/agreements/signedAgreementDoc';

/**
 * Hire & onboard agents. Lives at the top of Settings, Agents & spend.
 *  - one tab per role, each with its own agreement and its own public link
 *  - an open/closed switch (closed = that link stops accepting signatures)
 *  - the editable agreement the person signs
 *  - the signed copies, openable and printable exactly as they were signed
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
  const { agreements, agreement, slug, setSlug, loading, saving, error, save } = useAgentAgreements();
  const { signups, refresh } = useAgentSignups();
  const { signatures, refresh: refreshSignatures } = useAgreementSignatures(agreement.slug);

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  // Local draft while editing the agreement.
  const [dTitle, setDTitle] = useState('');
  const [dCompany, setDCompany] = useState('');
  const [dIntro, setDIntro] = useState('');
  const [dTerms, setDTerms] = useState<AgreementTerm[]>([]);
  const [dAcks, setDAcks] = useState<string[]>([]);

  const signOnly = agreement.mode === 'sign_only';

  const joinUrl = useMemo(() => {
    // Hugo shares the hiring link on go.heyelsie.com. On live hosts always use
    // that; on localhost/preview fall back to the current origin so it works.
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://go.heyelsie.com';
    const base = host.endsWith('heyelsie.com') ? 'https://go.heyelsie.com' : origin;
    // The original agreement keeps the plain /join URL it has always had.
    return agreement.slug === 'sales-closer' ? `${base}/join` : `${base}/join/${agreement.slug}`;
  }, [agreement.slug]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked, the input is selectable as a fallback */ }
  };

  const startEdit = () => {
    setDTitle(agreement.title);
    setDCompany(agreement.company);
    setDIntro(agreement.intro);
    setDTerms(agreement.terms.length ? agreement.terms : [{ heading: '', body: '' }]);
    setDAcks(agreement.acks.length ? agreement.acks : ['']);
    setEditing(true);
  };

  const saveEdit = async () => {
    const cleanTerms = dTerms.filter((t) => t.heading.trim() || t.body.trim());
    const cleanAcks = dAcks.map((a) => a.trim()).filter(Boolean);
    const ok = await save({
      title: dTitle.trim(),
      company: dCompany.trim() || 'HeyElsie',
      intro: dIntro.trim(),
      terms: cleanTerms,
      acks: cleanAcks,
    });
    if (ok) setEditing(false);
  };

  const toggleOpen = () => void save({ onboarding_open: !agreement.onboarding_open });

  const pickRole = (next: string) => {
    setEditing(false);
    setSlug(next);
  };

  // Signups only ever come from the account-creating flow.
  const roleSignups = signups.filter((s) => (s.agreement_slug ?? 'sales-closer') === agreement.slug);

  return (
    <>
      <Card title="Hire &amp; onboard agents" hint="Send the link → they sign → it is filed below">
        {/* Which role's agreement */}
        {agreements.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {agreements.map((a) => (
              <button
                key={a.slug}
                onClick={() => pickRole(a.slug)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border ${
                  a.slug === slug
                    ? 'bg-[#3C5A87] text-white border-[#3C5A87]'
                    : 'bg-white text-[#46514B] border-[#E5E7EB] hover:bg-[#F3F3EE]'
                }`}
              >
                {a.role_label}
              </button>
            ))}
          </div>
        )}

        {/* Shareable link */}
        <Field label={`Link for the ${agreement.role_label} agreement (send this to them)`}>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={joinUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-[#F9FAFB] font-mono"
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
          <div className="text-[11px] text-[#6B7280] mt-1.5">
            {signOnly
              ? 'Signature only: this link records the signed agreement and never creates or changes a login. Use it for someone who already has a CRM account.'
              : 'This link creates a new capped CRM agent account at the end (email code, then they pick a password).'}
          </div>
        </Field>

        {/* Open / closed */}
        <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-[#E5E7EB]">
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A]">
              Signing {agreement.onboarding_open ? 'open' : 'closed'}
            </div>
            <div className="text-[11px] text-[#6B7280]">
              {agreement.onboarding_open
                ? `Anyone with this link can read and sign the ${agreement.role_label} agreement.`
                : 'The link is live but nothing can be signed through it.'}
            </div>
          </div>
          <button
            onClick={toggleOpen}
            disabled={saving || loading}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold border disabled:opacity-60 whitespace-nowrap ${
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
        title={`The ${agreement.role_label} agreement`}
        hint={editing ? undefined : `Version ${agreement.version} · what they read before signing`}
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
            {agreement.acks.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
                  Tick boxes before signing
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {agreement.acks.map((a, i) => (
                    <li key={i} className="text-[11px] text-[#6B7280] leading-snug">{a}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={startEdit}
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3C5A87] hover:bg-[#EEF2F8] px-3 py-1.5 rounded-[10px]"
            >
              Edit agreement
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] font-semibold border border-[#E5E7EB] rounded-[8px] bg-white"
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
                    placeholder="What this section says"
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

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
                Tick boxes shown before they sign
              </div>
              {dAcks.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a}
                    onChange={(e) => setDAcks(dAcks.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder="I understand ..."
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white"
                  />
                  <button
                    onClick={() => setDAcks(dAcks.filter((_, j) => j !== i))}
                    className="text-[#9CA3AF] hover:text-[#EF4444] p-1.5 rounded"
                    title="Remove tick box"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setDAcks([...dAcks, ''])}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3C5A87] hover:bg-[#EEF2F8] px-2.5 py-1.5 rounded-[10px]"
              >
                <Plus className="w-3.5 h-3.5" /> Add tick box
              </button>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-[#E5E7EB]">
              <button
                onClick={() => void saveEdit()}
                disabled={saving}
                className="bg-[#3C5A87] text-white text-[12px] font-semibold px-4 py-1.5 rounded-[10px] hover:bg-[#33507a] disabled:opacity-60"
              >
                {saving ? 'Saving' : 'Save agreement'}
              </button>
              <button onClick={() => setEditing(false)} className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]">
                Cancel
              </button>
            </div>
            <div className="text-[11px] text-[#6B7280]">
              Saving bumps this agreement to version {agreement.version + 1}. Copies already signed keep the exact
              wording they were signed on, so nothing already agreed can change.
            </div>
          </div>
        )}
      </Card>

      {/* Signed copies (immutable snapshots) */}
      <Card title="Signed agreements" hint="Open one to read or print exactly what was signed">
        {signatures.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF] italic py-2">
            Nobody has signed the {agreement.role_label} agreement yet. Share the link above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                <tr>
                  <th className="text-left py-2">Name</th>
                  <th className="text-left py-2">Email used</th>
                  <th className="text-left py-2">Signed</th>
                  <th className="text-right py-2">Copy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {signatures.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 font-semibold text-[#1A1A1A] align-top">{s.full_name}</td>
                    <td className="py-2 text-[#6B7280] align-top">
                      {s.email}
                      {/* Which CRM login this email actually belongs to. Somebody
                          with two accounts can sign with either, so name it
                          rather than let it be assumed. */}
                      <div className="text-[10px] text-[#9CA3AF] mt-0.5">
                        {s.linked_account
                          ? `CRM account: ${s.linked_account.name}`
                          : 'No CRM account matches this email'}
                      </div>
                    </td>
                    <td className="py-2 text-[#6B7280] whitespace-nowrap align-top">
                      {formatSignedAt(s.signed_at)}
                      <span className="text-[10px] text-[#9CA3AF] ml-1.5">v{s.agreement_version}</span>
                      {s.agreement_version !== agreement.version && (
                        <div className="text-[10px] text-[#B45309] mt-0.5">
                          Agreement is now v{agreement.version}
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right align-top">
                      <button
                        onClick={() =>
                          openSignedAgreement({
                            company: s.agreement_company,
                            title: s.agreement_title,
                            intro: s.agreement_intro,
                            terms: s.terms,
                            acks: s.acks,
                            fullName: s.full_name,
                            email: s.email,
                            signedAt: s.signed_at,
                            signaturePng: s.signature_png,
                            slug: s.agreement_slug,
                            version: s.agreement_version,
                          })
                        }
                        className="inline-flex items-center gap-1.5 border border-[#E5E7EB] text-[#1A1A1A] text-[11px] font-semibold px-2.5 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
                      >
                        <FileText className="w-3.5 h-3.5" /> View / print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button onClick={() => void refreshSignatures()} className="mt-3 text-[11px] text-[#3C5A87] hover:underline">
          Refresh
        </button>
      </Card>

      {/* Account-creating flow only: where each new hire is in the funnel. */}
      {!signOnly && (
        <Card title="Onboarding progress" hint="Who is part way through creating their login">
          {roleSignups.length === 0 ? (
            <div className="text-[12px] text-[#9CA3AF] italic py-2">
              No one has started yet. Share the link above to onboard your first agent.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                  {roleSignups.map((s) => {
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
            </div>
          )}
          <button onClick={() => void refresh()} className="mt-3 text-[11px] text-[#3C5A87] hover:underline">
            Refresh
          </button>
        </Card>
      )}
    </>
  );
}
