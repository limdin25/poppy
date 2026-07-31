// Projects home: app shell (wordmark, credits, buy, sign out), the ad grid,
// and the manual product entry that creates a new project (name, category,
// description, selling points, then straight onto the pre-built canvas).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, LogOut, Plus, Clapperboard, X } from 'lucide-react';
import { backend } from '../../core/persistence';
import type { ProjectSummary } from '../../core/persistence/backend';
import { supabase } from '../../lib/supabaseClient';
import { startCheckout } from '../auth/AuthGate';
import { TID } from '../../testids';

export default function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState<string[]>(['']);
  const navigate = useNavigate();
  const hasAccount = supabase() !== null;

  useEffect(() => {
    void backend().listProjects().then(setProjects);
    void backend()
      .getCredits()
      .then((c) => setBalance(c.balance));
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    const project = await backend().createProject(name.trim());
    navigate(`/canvas/${project.id}`, {
      state: { product: { name, category, description, sellingPoints: points.filter(Boolean) } },
    });
  };

  return (
    <div className="min-h-full bg-page">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
          <span className="text-[15px] font-black tracking-tight text-ink">UGC Factory</span>
          <div className="flex items-center gap-2">
            {balance !== null && (
              <span className="flex items-center gap-1.5 rounded-full border border-hairline bg-page px-3 py-1.5 text-[12px] font-semibold text-ink">
                <Coins size={13} className="text-ink-muted" />
                {balance.toLocaleString()}
              </span>
            )}
            {hasAccount && (
              <button
                type="button"
                onClick={() => void startCheckout()}
                className="rounded-full border border-hairline bg-white px-3.5 py-1.5 text-[12px] font-semibold text-ink shadow-card transition-shadow hover:shadow-selected"
              >
                Buy credits
              </button>
            )}
            {hasAccount && (
              <button
                type="button"
                onClick={() => void supabase()?.auth.signOut()}
                aria-label="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-subtle hover:bg-page hover:text-ink"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-ink">Your ads</h1>
            <p className="mt-0.5 text-[12px] text-ink-muted">Photo in, finished ad out.</p>
          </div>
          <button
            type="button"
            data-testid={TID.newProjectButton}
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black"
          >
            <Plus size={14} />
            New ad
          </button>
        </div>

        {creating && (
          <div className="mb-8 rounded-2xl border border-hairline bg-white p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-ink">What are we advertising?</h2>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close">
                <X size={15} className="text-ink-subtle" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                data-testid={TID.productName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Product name"
                className="w-full rounded-slot border border-hairline px-3 py-2.5 text-[13px] outline-none focus:border-live"
              />
              <input
                data-testid={TID.productCategory}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Category (skincare, coffee, an app...)"
                className="w-full rounded-slot border border-hairline px-3 py-2.5 text-[13px] outline-none focus:border-live"
              />
              <textarea
                data-testid={TID.productDescription}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One or two sentences about it"
                rows={2}
                className="w-full resize-none rounded-slot border border-hairline px-3 py-2.5 text-[13px] outline-none focus:border-live"
              />
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                  Selling points
                </p>
                {points.map((point, i) => (
                  <div key={i} className="mb-1.5 flex gap-1.5">
                    <input
                      data-testid={TID.productSellingPoint}
                      value={point}
                      onChange={(e) => setPoints(points.map((p, j) => (j === i ? e.target.value : p)))}
                      placeholder={`Why people buy it #${i + 1}`}
                      className="flex-1 rounded-slot border border-hairline px-3 py-2 text-[12px] outline-none focus:border-live"
                    />
                    {points.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPoints(points.filter((_, j) => j !== i))}
                        aria-label="Remove selling point"
                        className="text-ink-subtle hover:text-failed"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  data-testid={TID.productAddPoint}
                  onClick={() => setPoints([...points, ''])}
                  className="text-[11px] font-semibold text-live"
                >
                  + Add another
                </button>
              </div>
              <button
                type="button"
                data-testid={TID.productCreate}
                onClick={() => void create()}
                disabled={!name.trim()}
                className="w-full rounded-btn bg-ink py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                Open the canvas
              </button>
            </div>
          </div>
        )}

        <div data-testid={TID.projectList} className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/canvas/${p.id}`)}
              className="group rounded-2xl border border-hairline bg-white p-5 text-left shadow-card transition-shadow hover:shadow-selected"
            >
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-page">
                <Clapperboard size={15} className="text-ink-muted" />
              </span>
              <p className="truncate text-[14px] font-bold tracking-tight text-ink">{p.title}</p>
              <p className="mt-0.5 text-[11px] text-ink-subtle">
                Edited {new Date(p.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
        {!projects.length && !creating && (
          <div className="rounded-2xl border border-dashed border-hairline py-16 text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-card">
              <Clapperboard size={17} className="text-ink-muted" />
            </span>
            <p className="text-[14px] font-bold text-ink">No ads yet</p>
            <p className="mt-1 text-[12px] text-ink-subtle">
              Hit New ad: two photos and a script is all it takes.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
