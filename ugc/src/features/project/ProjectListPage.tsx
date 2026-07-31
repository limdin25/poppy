// Projects home: the list plus the manual product entry that creates a new
// project (name, category, description, selling points, then straight onto
// the pre-built canvas). Import-from-URL is phase 2 and slots in beside the
// manual path.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { backend } from '../../core/persistence';
import type { ProjectSummary } from '../../core/persistence/backend';
import { TID } from '../../testids';

export default function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState<string[]>(['']);
  const navigate = useNavigate();

  useEffect(() => {
    void backend().listProjects().then(setProjects);
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    const project = await backend().createProject(name.trim());
    navigate(`/canvas/${project.id}`, {
      state: { product: { name, category, description, sellingPoints: points.filter(Boolean) } },
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">UGC Factory</h1>
          <p className="text-[12px] text-ink-muted">Photo in, finished ad out.</p>
        </div>
        <button
          type="button"
          data-testid={TID.newProjectButton}
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:bg-black"
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

      <div data-testid={TID.projectList} className="space-y-2">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/canvas/${p.id}`)}
            className="flex w-full items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3 text-left shadow-card transition-shadow hover:shadow-selected"
          >
            <span className="text-[13px] font-semibold text-ink">{p.title}</span>
            <span className="text-[11px] text-ink-subtle">{new Date(p.updatedAt).toLocaleDateString()}</span>
          </button>
        ))}
        {!projects.length && !creating && (
          <p className="py-10 text-center text-[12px] text-ink-subtle">
            No ads yet. Hit New ad to make your first one.
          </p>
        )}
      </div>
    </div>
  );
}
