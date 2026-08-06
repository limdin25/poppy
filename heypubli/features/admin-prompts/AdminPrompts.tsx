"use client";

import { useMemo, useState } from "react";
import { Search, Copy, Check, ExternalLink, Sparkles, Inbox } from "lucide-react";
import { adminPromptsCopy } from "./copy";
import type { PromptEntry, PromptStyle } from "./types";

type StyleFilter = "all" | PromptStyle;
type Sort = "followers" | "views" | "recent";

const STYLE_FILTERS: StyleFilter[] = ["all", "post", "likely", "replies", "named"];
const SORTS: Sort[] = ["followers", "views", "recent"];

const STYLE_CLASS: Record<PromptStyle, string> = {
  post: "bg-success/10 text-success",
  likely: "bg-accent/10 text-accent",
  replies: "bg-warning/10 text-warning",
  named: "bg-background-secondary text-foreground-secondary",
};

/** Certain prompts first, guesses next, then the ones you have to go and fetch. */
const STYLE_RANK: Record<PromptStyle, number> = {
  post: 4,
  likely: 3,
  replies: 2,
  named: 1,
};

const CLAMP = 340;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".0", "")}K`;
  return String(n);
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? adminPromptsCopy.copied : adminPromptsCopy.copy}
    </button>
  );
}

function PromptCard({ entry }: { entry: PromptEntry }) {
  const [open, setOpen] = useState(false);
  const long = entry.text.length > CLAMP;
  const shown = open || !long ? entry.text : `${entry.text.slice(0, CLAMP).trimEnd()}...`;

  return (
    <li className="rounded-xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={`https://x.com/${entry.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="prompt-handle"
            className="text-sm font-bold text-foreground hover:underline"
          >
            @{entry.handle}
          </a>
          {entry.name && (
            <span className="ml-2 text-xs text-foreground-secondary">{entry.name}</span>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-secondary">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${STYLE_CLASS[entry.style]}`}
              title={adminPromptsCopy.styleHint[entry.style]}
            >
              {adminPromptsCopy.style[entry.style]}
            </span>
            {entry.followers > 0 && (
              <span className="tabular-nums">
                {compact(entry.followers)} {adminPromptsCopy.followers}
              </span>
            )}
            {entry.views > 0 && (
              <span className="tabular-nums">
                {compact(entry.views)} {adminPromptsCopy.views}
              </span>
            )}
            <span className="tabular-nums">{entry.postedAt}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(entry.style === "post" || entry.style === "likely") && (
            <CopyButton text={entry.text} />
          )}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary transition hover:bg-background-secondary hover:text-foreground"
          >
            <ExternalLink size={13} />
            {adminPromptsCopy.open}
          </a>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {shown}
      </p>
      {long && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-2 text-xs font-semibold text-accent hover:underline"
        >
          {open ? adminPromptsCopy.showLess : adminPromptsCopy.showMore}
        </button>
      )}
    </li>
  );
}

export function AdminPrompts({ prompts }: { prompts: PromptEntry[] }) {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<StyleFilter>("all");
  const [sort, setSort] = useState<Sort>("followers");

  const stats = useMemo(
    () => ({
      total: prompts.length,
      inPost: prompts.filter((p) => p.style === "post").length,
      creators: new Set(prompts.map((p) => p.handle.toLowerCase())).size,
    }),
    [prompts],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = prompts.filter((p) => {
      if (style !== "all" && p.style !== style) return false;
      if (!term) return true;
      return `${p.handle} ${p.name} ${p.text}`.toLowerCase().includes(term);
    });
    return [...filtered].sort((a, b) => {
      if (sort === "views") return b.views - a.views;
      if (sort === "recent") return b.postedAt.localeCompare(a.postedAt);
      return STYLE_RANK[b.style] - STYLE_RANK[a.style] || b.followers - a.followers;
    });
  }, [prompts, query, style, sort]);

  return (
    <div className="p-4 lg:p-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-accent" />
          <h1 className="text-2xl font-bold text-foreground">{adminPromptsCopy.title}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-foreground-secondary">
          {adminPromptsCopy.subtitle}
        </p>
      </header>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-white p-4">
          <div data-testid="stat-total" className="text-2xl font-bold tabular-nums">
            {stats.total}
          </div>
          <div className="text-xs text-foreground-secondary">
            {adminPromptsCopy.stats.total}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <div data-testid="stat-in-post" className="text-2xl font-bold tabular-nums">
            {stats.inPost}
          </div>
          <div className="text-xs text-foreground-secondary">
            {adminPromptsCopy.stats.inPost}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <div data-testid="stat-creators" className="text-2xl font-bold tabular-nums">
            {stats.creators}
          </div>
          <div className="text-xs text-foreground-secondary">
            {adminPromptsCopy.stats.creators}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={adminPromptsCopy.search}
            className="w-full rounded-lg border border-border bg-white py-2.5 pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STYLE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStyle(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                style === f
                  ? "bg-accent text-white"
                  : "border border-border bg-white text-foreground-secondary hover:text-foreground"
              }`}
            >
              {adminPromptsCopy.filters[f]}
            </button>
          ))}
          <span className="mx-1 hidden w-px bg-border sm:block" />
          {SORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                sort === s
                  ? "bg-foreground text-white"
                  : "border border-border bg-white text-foreground-secondary hover:text-foreground"
              }`}
            >
              {adminPromptsCopy.sort[s]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-white p-10 text-center">
          <Inbox size={28} className="mx-auto mb-3 text-foreground-secondary" />
          <p className="font-semibold text-foreground">{adminPromptsCopy.emptyTitle}</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {adminPromptsCopy.emptyBody}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((entry) => (
            <PromptCard key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-foreground-secondary">{adminPromptsCopy.source}</p>
    </div>
  );
}
