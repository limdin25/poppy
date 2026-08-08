"use client";

// Hugo's numbers page. His words, 08 Aug 2026: "we should see all the creators
// there, filter by creators, all the videos that are posted, the amount of
// views, views per creator... most viewed video... all type of filters there",
// and "how many followers, people following etc, how many followers gained,
// everything we should be tracking."
//
// ONE THING TO BE HONEST ABOUT ON SCREEN: views are per ACCOUNT, not per video.
// Outstand has no per-post metrics endpoint (404) and the post payload carries
// no counts, so "views on this one video" does not exist to be shown. The page
// says so rather than implying the number means something it does not.

import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Users, Eye, Heart, Film, ExternalLink } from "lucide-react";
import type { CreatorStatsRow } from "@/lib/data/creator-stats";
import { summarise } from "@/lib/data/creator-stats";

type SortKey = "followers" | "views" | "likes" | "reach" | "gained" | "posts";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "followers", label: "Followers" },
  { key: "gained", label: "Followers gained" },
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "reach", label: "Reach" },
  { key: "posts", label: "Posts" },
];

function n(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toLocaleString("en-GB");
}

function Delta({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-foreground-secondary text-xs">not measured yet</span>;
  }
  if (value === 0) return <span className="text-foreground-secondary text-xs">no change</span>;
  const up = value > 0;
  return (
    <span className={`text-xs font-semibold inline-flex items-center gap-0.5 ${up ? "text-green-700" : "text-red-700"}`}>
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toLocaleString("en-GB")}
    </span>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-background-secondary">
      <div className="flex items-center gap-2 text-foreground-secondary text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

export function AdminStats({ rows }: { rows: CreatorStatsRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("followers");
  const [connectedOnly, setConnectedOnly] = useState(true);

  const visible = useMemo(() => {
    const base = connectedOnly ? rows.filter((r) => r.isConnected) : rows;
    // An empty selection means everyone, which is the sane default for a
    // filter: nobody wants a blank page before they have clicked anything.
    return selected.size ? base.filter((r) => selected.has(r.profileId)) : base;
  }, [rows, selected, connectedOnly]);

  const sorted = useMemo(() => {
    const val = (r: CreatorStatsRow): number => {
      switch (sort) {
        case "followers": return r.followers ?? -1;
        case "views": return r.views ?? -1;
        case "likes": return r.likes ?? -1;
        case "reach": return r.reach ?? -1;
        case "gained": return r.followersGained24h ?? -Infinity;
        case "posts": return r.postsPublished;
      }
    };
    return [...visible].sort((a, b) => val(b) - val(a));
  }, [visible, sort]);

  const total = useMemo(() => summarise(visible), [visible]);
  const topByViews = sorted.length
    ? [...visible].sort((a, b) => (b.views ?? -1) - (a.views ?? -1))[0]
    : null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="p-6 max-w-6xl space-y-6" data-testid="admin-stats">
      <div>
        <h1 className="text-2xl font-bold">Creator numbers</h1>
        <p className="text-sm text-foreground-secondary mt-1">
          Everything Instagram gives us, per creator. Pick creators to narrow it down; picking none
          shows them all.
        </p>
      </div>

      {/* Totals across whatever is selected */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="stats-totals">
        <Tile
          icon={<Users className="w-3.5 h-3.5" />}
          label={selected.size ? `${total.creators} selected` : "Creators"}
          value={n(total.creators)}
          sub={
            <span className="text-xs text-foreground-secondary">
              {total.measured} with numbers in
            </span>
          }
        />
        <Tile
          icon={<Users className="w-3.5 h-3.5" />}
          label="Followers"
          value={n(total.followers)}
          sub={<Delta value={total.followersGained24h} />}
        />
        <Tile icon={<Eye className="w-3.5 h-3.5" />} label="Views" value={n(total.views)} />
        <Tile
          icon={<Film className="w-3.5 h-3.5" />}
          label="Posts published"
          value={n(total.postsPublished)}
          sub={
            <span className="text-xs text-foreground-secondary">
              {n(total.likes)} likes, {n(total.reach)} reach
            </span>
          }
        />
      </div>

      {topByViews && topByViews.views != null && (
        <div className="text-sm" data-testid="stats-top">
          Most viewed account:{" "}
          <a
            href={`https://instagram.com/${topByViews.igUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            @{topByViews.igUsername}
          </a>{" "}
          with {n(topByViews.views)} views.
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-foreground-secondary">Sort by</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSort(s.key)}
            aria-pressed={sort === s.key}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              sort === s.key ? "bg-accent text-white" : "border border-border hover:bg-background-secondary"
            }`}
            data-testid={`sort-${s.key}`}
          >
            {s.label}
          </button>
        ))}
        <label className="ml-auto text-xs flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={connectedOnly}
            onChange={(e) => setConnectedOnly(e.target.checked)}
            data-testid="connected-only"
          />
          Connected only
        </label>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs underline text-foreground-secondary"
            data-testid="clear-selection"
          >
            Clear {selected.size} selected
          </button>
        )}
      </div>

      {/* The creators */}
      <div className="border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-background-secondary text-left text-xs text-foreground-secondary">
              <th className="p-3 font-medium">Creator</th>
              <th className="p-3 font-medium">Followers</th>
              <th className="p-3 font-medium">Gained 24h / 7d</th>
              <th className="p-3 font-medium">Following</th>
              <th className="p-3 font-medium">Views</th>
              <th className="p-3 font-medium">Likes</th>
              <th className="p-3 font-medium">Reach</th>
              <th className="p-3 font-medium">Posts</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.profileId}
                className={`border-t border-border ${selected.has(r.profileId) ? "bg-accent/5" : ""}`}
                data-testid={`stats-row-${r.igUsername}`}
              >
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.profileId)}
                      onChange={() => toggle(r.profileId)}
                      aria-label={`Select ${r.igUsername}`}
                      data-testid={`select-${r.igUsername}`}
                    />
                    <div className="min-w-0">
                      <a
                        href={`https://instagram.com/${r.igUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:text-accent hover:underline"
                      >
                        @{r.igUsername}
                      </a>
                      {!r.isConnected && (
                        <span className="ml-1.5 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                          DISCONNECTED
                        </span>
                      )}
                      <div className="text-[11px] text-foreground-secondary">
                        {r.firstName}
                        {r.measuredAt
                          ? ""
                          : " - no numbers yet, first reading at the next 07:00 or 20:00"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="p-3 font-semibold">{n(r.followers)}</td>
                <td className="p-3">
                  <Delta value={r.followersGained24h} />
                  <span className="text-foreground-secondary text-xs"> / </span>
                  <Delta value={r.followersGained7d} />
                </td>
                <td className="p-3">{n(r.following)}</td>
                <td className="p-3">{n(r.views)}</td>
                <td className="p-3">{n(r.likes)}</td>
                <td className="p-3">{n(r.reach)}</td>
                <td className="p-3">{r.postsPublished}</td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-foreground-secondary">
                  No creators match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Every video that went out */}
      <section className="space-y-2">
        <h2 className="font-semibold">Videos posted</h2>
        <div className="border border-border rounded-xl divide-y divide-border" data-testid="stats-posts">
          {sorted.flatMap((r) =>
            r.posts
              .filter((p) => p.status === "published")
              .map((p, i) => (
                <div
                  key={`${r.profileId}-${p.masterSeq}-${i}`}
                  className="p-3 flex items-center gap-3 text-sm flex-wrap"
                >
                  <span className="font-medium">#{p.masterSeq}</span>
                  <span className="text-foreground-secondary truncate max-w-[220px]">
                    {p.masterTitle}
                  </span>
                  <a
                    href={`https://instagram.com/${r.igUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    @{r.igUsername}
                  </a>
                  <span className="text-foreground-secondary text-xs">
                    {p.publishedAt ? new Date(p.publishedAt).toLocaleString("en-GB") : ""}
                  </span>
                  {p.platformPostUrl && (
                    <a
                      href={p.platformPostUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-xs inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      View post <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )),
          )}
          {!sorted.some((r) => r.posts.some((p) => p.status === "published")) && (
            <div className="p-6 text-center text-foreground-secondary text-sm">
              Nothing published yet for this selection.
            </div>
          )}
        </div>
      </section>

      <p className="text-xs text-foreground-secondary">
        <Heart className="w-3 h-3 inline" /> Views, likes and reach are whole-account figures from
        Instagram, not per video. Instagram does not give us a view count for an individual post,
        so the numbers above move as the account moves. Readings are taken at 07:00 and 20:00, and
        growth is the difference between two of them, so a brand new account shows nothing until
        its second reading.
      </p>
    </div>
  );
}
