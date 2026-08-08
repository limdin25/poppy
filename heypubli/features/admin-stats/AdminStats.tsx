"use client";

// Hugo's numbers page. His words, 08 Aug 2026: "we should see all the creators
// there, filter by creators, all the videos that are posted, the amount of
// views, views per creator... most viewed video... all type of filters there",
// and "how many followers, people following etc, how many followers gained,
// everything we should be tracking."
//
// TWO DIFFERENT VIEW COUNTS APPEAR HERE AND THEY MUST STAY LABELLED APART:
// a creator's ACCOUNT views (everything they have ever posted, most of it
// nothing to do with us) and OUR views (the videos this pipeline made for
// them). Only the second says whether any of this is working.
//
// This page briefly carried a line saying per-video numbers did not exist. They
// do: /posts/{id}/analytics serves them. Only /metrics and /insights 404.

import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Users, Eye, Heart, Film, ExternalLink } from "lucide-react";
import type { CreatorStatsRow } from "@/lib/data/creator-stats";
import { summarise } from "@/lib/data/creator-stats";

type SortKey =
  | "followers"
  | "views"
  | "ourViews"
  | "likes"
  | "reach"
  | "gained"
  | "posts";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "followers", label: "Followers" },
  { key: "gained", label: "Followers gained" },
  { key: "ourViews", label: "Views on our videos" },
  { key: "views", label: "Account views" },
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
        case "ourViews": return r.ourViews ?? -1;
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

  // One flat list of every published video across whoever is selected, newest
  // first, each carrying the handle it went out on.
  const published = useMemo(
    () =>
      visible
        .flatMap((r) =>
          r.posts
            .filter((p) => p.status === "published")
            .map((p) => ({ ...p, igUsername: r.igUsername })),
        )
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    [visible],
  );

  // The single best video, which is a different question from the best account
  // and the one Hugo actually asked for.
  const topVideo = useMemo(() => {
    const read = published.filter((p) => p.views != null);
    return read.length ? read.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a)) : null;
  }, [published]);

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
        <Tile
          icon={<Eye className="w-3.5 h-3.5" />}
          label="Views on our videos"
          value={n(total.ourViews)}
          sub={
            <span className="text-xs text-foreground-secondary">
              <Delta value={total.ourViews24h || null} /> in 24h, {n(total.ourLikes)} likes
            </span>
          }
        />
        <Tile
          icon={<Film className="w-3.5 h-3.5" />}
          label="Posts published"
          value={n(total.postsPublished)}
          sub={
            <span className="text-xs text-foreground-secondary">
              {n(total.views)} account views all-time
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

      {topVideo && (
        <div className="text-sm" data-testid="stats-top-video">
          Most viewed video:{" "}
          <span className="font-semibold">
            #{topVideo.masterSeq} {topVideo.masterTitle}
          </span>{" "}
          on{" "}
          <a
            href={`https://instagram.com/${topVideo.igUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            @{topVideo.igUsername}
          </a>
          , {n(topVideo.views)} views
          {topVideo.platformPostUrl && (
            <>
              {" "}
              <a
                href={topVideo.platformPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                (watch it)
              </a>
            </>
          )}
          .
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
              <th className="p-3 font-medium">Views on our videos</th>
              <th className="p-3 font-medium">Account views</th>
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
                <td className="p-3 font-semibold">
                  {n(r.ourViews)}
                  {r.ourViews24h != null && r.ourViews24h > 0 && (
                    <div>
                      <Delta value={r.ourViews24h} />
                    </div>
                  )}
                </td>
                <td className="p-3">{n(r.views)}</td>
                <td className="p-3">{n(r.likes)}</td>
                <td className="p-3">{n(r.reach)}</td>
                <td className="p-3">{r.postsPublished}</td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-foreground-secondary">
                  No creators match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Every video that went out, with what it actually did */}
      <section className="space-y-2">
        <h2 className="font-semibold">Videos posted</h2>
        <div className="border border-border rounded-xl overflow-x-auto" data-testid="stats-posts">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-background-secondary text-left text-xs text-foreground-secondary">
                <th className="p-3 font-medium">Video</th>
                <th className="p-3 font-medium">Creator</th>
                <th className="p-3 font-medium">Posted</th>
                <th className="p-3 font-medium">Views</th>
                <th className="p-3 font-medium">Last 24h</th>
                <th className="p-3 font-medium">Likes</th>
                <th className="p-3 font-medium">Reach</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {published.map((p, i) => (
                <tr key={`${p.profileId}-${p.masterSeq}-${i}`} className="border-t border-border">
                  <td className="p-3">
                    <span className="font-medium">#{p.masterSeq}</span>{" "}
                    <span className="text-foreground-secondary">{p.masterTitle}</span>
                  </td>
                  <td className="p-3">
                    <a
                      href={`https://instagram.com/${p.igUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      @{p.igUsername}
                    </a>
                  </td>
                  <td className="p-3 text-xs text-foreground-secondary whitespace-nowrap">
                    {p.publishedAt ? new Date(p.publishedAt).toLocaleString("en-GB") : ""}
                  </td>
                  <td className="p-3 font-semibold">
                    {p.metricsCapturedAt ? (
                      n(p.views)
                    ) : (
                      <span className="text-xs font-normal text-foreground-secondary">
                        not read yet
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <Delta value={p.views24h} />
                  </td>
                  <td className="p-3">{p.metricsCapturedAt ? n(p.likes) : "-"}</td>
                  <td className="p-3">{p.metricsCapturedAt ? n(p.reach) : "-"}</td>
                  <td className="p-3 text-right">
                    {p.platformPostUrl ? (
                      <a
                        href={p.platformPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs inline-flex items-center gap-1 text-accent hover:underline whitespace-nowrap"
                      >
                        View post <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-foreground-secondary whitespace-nowrap">
                        no link
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!published.length && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-foreground-secondary text-sm">
                    Nothing published yet for this selection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-foreground-secondary">
        <Heart className="w-3 h-3 inline" /> <strong>Views on our videos</strong> is the sum of the
        videos this pipeline made, read one post at a time. <strong>Account views</strong> is
        everything that creator has ever posted, most of it nothing to do with us, so the two will
        never match. Every number is read hourly, and anything &quot;in the last 24h&quot; is the
        difference between two readings, so a video posted in the last hour has nothing to compare
        against yet and says so rather than showing a zero.
      </p>
    </div>
  );
}
