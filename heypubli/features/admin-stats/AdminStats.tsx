"use client";

// Hugo's decision dashboard. His words, 08 Aug 2026: "this is our dash, where
// we see everything, where we make decisions on the business... everything is
// very metrified, so the more metrics you can get the better."
//
// TWO DIFFERENT VIEW COUNTS APPEAR HERE AND THEY MUST STAY LABELLED APART:
// a creator's ACCOUNT views (all their content, most of it nothing to do with
// us) and OUR views (the videos this pipeline made for them). Only the second
// says whether any of this is working, so it leads.
//
// The account figure is a ROLLING 30 DAYS, not a lifetime. Outstand's metrics
// response carries a `period` block spanning exactly 2,592,000 seconds with the
// note "Engagement data reflects the specified period". This page called it
// "all-time" for a day, which overstated nothing but described the wrong thing:
// 859k in a month and 859k ever are different businesses. Followers and post
// count in the same payload ARE current values, not period ones.
//
// This page briefly carried a line saying per-video numbers did not exist. They
// do: /posts/{id}/analytics serves them. Only /metrics and /insights 404.
//
// The one rule the whole page obeys: a number we have not measured shows as
// "not measured", never as 0. Zero is a claim, and on a dashboard people act
// on claims.

import { useMemo, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Users,
  Eye,
  Heart,
  Film,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Download,
  Trophy,
  Activity,
} from "lucide-react";
import type {
  CreatorStatsRow,
  FlatPost,
  MasterTotals,
  TimelinePoint,
} from "@/lib/data/creator-stats";
import {
  summarise,
  summarisePosts,
  summariseByMaster,
  flattenPosts,
  inRange,
} from "@/lib/data/creator-stats";
import { WINDOWS, type WindowKey } from "@/lib/data/post-metrics";
import { ViewsChart } from "./ViewsChart";

type SortKey =
  | "followers"
  | "views"
  | "ourViews"
  | "likes"
  | "reach"
  | "gained"
  | "posts";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "ourViews", label: "Views on our videos" },
  { key: "followers", label: "Followers" },
  { key: "gained", label: "Followers gained" },
  { key: "views", label: "Account views (30d)" },
  { key: "likes", label: "Likes" },
  { key: "reach", label: "Reach" },
  { key: "posts", label: "Posts" },
];

type PostSortKey = "published" | "views" | "gained" | "likes" | "reach" | "engagement";

/** How many of a creator's videos show before the row offers "show all".
 *  Hugo: "always shows the last two, and then when expands see the earlier
 *  posts." */
const PREVIEW_POSTS = 2;

function n(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toLocaleString("en-GB");
}

/** Short form for the big tiles, where 858,894 is noise and 859k is the point. */
function compact(v: number | null | undefined): string {
  if (v == null) return "-";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`;
  return v.toLocaleString("en-GB");
}

function pct(v: number | null): string {
  if (v == null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function Delta({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value == null) {
    return <span className="text-foreground-secondary text-xs">not measured yet</span>;
  }
  if (value === 0) return <span className="text-foreground-secondary text-xs">no change</span>;
  const up = value > 0;
  return (
    <span
      className={`text-xs font-semibold inline-flex items-center gap-0.5 ${up ? "text-green-700" : "text-red-700"}`}
    >
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toLocaleString("en-GB")}
      {suffix ? <span className="font-normal text-foreground-secondary"> {suffix}</span> : null}
    </span>
  );
}

/** A bar showing this row against the best row on screen. Reading twenty
 *  numbers in a column is work; reading twenty bars is a glance. */
function Bar({ value, max }: { value: number | null; max: number }) {
  if (value == null || max <= 0) return null;
  const w = Math.max(2, Math.round((value / max) * 100));
  return (
    <div className="h-1 mt-1 rounded-full bg-border overflow-hidden" aria-hidden>
      <div className="h-full rounded-full bg-accent" style={{ width: `${w}%` }} />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  strong,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`border rounded-xl p-4 ${
        strong ? "border-accent/40 bg-accent/5" : "border-border bg-background-secondary"
      }`}
    >
      <div className="flex items-center gap-2 text-foreground-secondary text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

function csvEscape(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null>>) {
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminStats({
  rows,
  timeline = [],
}: {
  rows: CreatorStatsRow[];
  timeline?: TimelinePoint[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [masters, setMasters] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("ourViews");
  const [postSort, setPostSort] = useState<PostSortKey>("published");
  const [connectedOnly, setConnectedOnly] = useState(true);
  const [period, setPeriod] = useState<WindowKey>("h24");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());

  const periodLabel = WINDOWS.find((w) => w.key === period)?.label ?? "";
  const dated = Boolean(from || to);

  const visible = useMemo(() => {
    const base = connectedOnly ? rows.filter((r) => r.isConnected) : rows;
    // An empty selection means everyone, which is the sane default for a
    // filter: nobody wants a blank page before they have clicked anything.
    return selected.size ? base.filter((r) => selected.has(r.profileId)) : base;
  }, [rows, selected, connectedOnly]);

  /** Every published video on screen, after the creator, video and date
   *  filters. Everything below reads from this one list. */
  const posts = useMemo(() => {
    let list = flattenPosts(visible);
    if (masters.size) list = list.filter((p) => p.masterVideoId && masters.has(p.masterVideoId));
    if (dated) list = list.filter((p) => inRange(p, from, to));
    return list;
  }, [visible, masters, dated, from, to]);

  const sortedPosts = useMemo(() => {
    const val = (p: FlatPost): number => {
      switch (postSort) {
        case "views": return p.views ?? -1;
        case "gained": return p.deltas[period].views ?? -1;
        case "likes": return p.likes ?? -1;
        case "reach": return p.reach ?? -1;
        case "engagement":
          return p.views
            ? ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / p.views
            : -1;
        case "published": return Date.parse(p.publishedAt ?? "") || 0;
      }
    };
    return [...posts].sort((a, b) => val(b) - val(a));
  }, [posts, postSort, period]);

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
  const postTotals = useMemo(() => summarisePosts(posts, period), [posts, period]);
  const masterRows = useMemo(() => summariseByMaster(posts, period), [posts, period]);

  // Every video a creator has, ignoring the video and date filters, because a
  // drill-down into one creator should show that creator's whole run.
  const byCreator = useMemo(() => {
    const m = new Map<string, FlatPost[]>();
    for (const p of flattenPosts(visible)) {
      const list = m.get(p.profileId) ?? [];
      list.push(p);
      m.set(p.profileId, list);
    }
    return m;
  }, [visible]);

  const topByViews = sorted.length
    ? [...visible].sort((a, b) => (b.views ?? -1) - (a.views ?? -1))[0]
    : null;

  const topVideo = useMemo(() => {
    const read = posts.filter((p) => p.views != null);
    return read.length ? read.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a)) : null;
  }, [posts]);

  // When the newest number on screen was actually read. A dashboard that does
  // not say how old it is invites people to act on a stale figure.
  const readAt = useMemo(() => {
    const stamps = posts.map((p) => p.metricsCapturedAt).filter((s): s is string => Boolean(s));
    return stamps.length ? stamps.sort().at(-1)! : null;
  }, [posts]);

  const maxPostViews = Math.max(0, ...posts.map((p) => p.views ?? 0));
  const maxMasterViews = Math.max(0, ...masterRows.map((m) => m.views ?? 0));
  const maxCreatorViews = Math.max(0, ...visible.map((r) => r.ourViews ?? 0));

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const clearFilters = () => {
    setSelected(new Set());
    setMasters(new Set());
    setFrom("");
    setTo("");
  };

  const filterCount = selected.size + masters.size + (dated ? 1 : 0);

  const exportVideos = () =>
    downloadCsv("heypubli-videos.csv", [
      ["Video", "Title", "Creator", "Posted", "Views", `Views ${periodLabel}`, "Likes", "Comments", "Shares", "Saves", "Reach", "Link"],
      ...sortedPosts.map((p) => [
        p.masterSeq,
        p.masterTitle,
        p.igUsername,
        p.publishedAt,
        p.views,
        p.deltas[period].views,
        p.likes,
        p.comments,
        p.shares,
        p.saves,
        p.reach,
        p.platformPostUrl,
      ]),
    ]);

  const exportCreators = () =>
    downloadCsv("heypubli-creators.csv", [
      ["Creator", "Name", "Connected", "Followers", "Gained 24h", "Gained 7d", "Following", "Our views", "Our likes", "Account views 30d", "Posts"],
      ...sorted.map((r) => [
        r.igUsername,
        r.firstName,
        r.connectedAt,
        r.followers,
        r.followersGained24h,
        r.followersGained7d,
        r.following,
        r.ourViews,
        r.ourLikes,
        r.views,
        r.postsPublished,
      ]),
    ]);

  return (
    <div className="p-6 max-w-7xl space-y-6" data-testid="admin-stats">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Creator numbers</h1>
          <p className="text-sm text-foreground-secondary mt-1">
            Every creator, every video, and what each one did. Pick creators or videos to narrow it
            down; picking none shows them all.
          </p>
          {readAt && (
            <p className="text-xs text-foreground-secondary mt-1" data-testid="read-at">
              Numbers read {new Date(readAt).toLocaleString("en-GB")}, refreshed on the hour.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={exportCreators}
          className="text-xs inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-2 hover:bg-background-secondary"
        >
          <Download className="w-3.5 h-3.5" /> Creators CSV
        </button>
      </div>

      {/* Period */}
      <div className="flex flex-wrap gap-2 items-center border border-border rounded-xl p-3 bg-background-secondary">
        <span className="text-xs font-medium text-foreground-secondary">Period</span>
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            onClick={() => setPeriod(w.key)}
            aria-pressed={period === w.key}
            data-testid={`period-${w.key}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              period === w.key
                ? "bg-accent text-white"
                : "border border-border bg-background hover:bg-background-secondary"
            }`}
          >
            {w.label}
          </button>
        ))}
        <span className="text-xs text-foreground-secondary ml-2">or pick dates</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          data-testid="date-from"
          aria-label="Posted from"
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
        />
        <span className="text-xs text-foreground-secondary">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          data-testid="date-to"
          aria-label="Posted to"
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
        />
        {filterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            data-testid="clear-filters"
            className="ml-auto text-xs underline text-foreground-secondary"
          >
            Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* Totals across whatever is selected */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="stats-totals">
        <Tile
          icon={<Eye className="w-3.5 h-3.5" />}
          label="Views on our videos"
          value={compact(postTotals.views)}
          strong
          sub={
            <span className="text-xs text-foreground-secondary">
              <Delta value={postTotals.gainedViews} /> {dated ? "" : periodLabel.toLowerCase()}
            </span>
          }
        />
        <Tile
          icon={<Film className="w-3.5 h-3.5" />}
          label="Videos posted"
          value={n(postTotals.videos)}
          sub={
            <span className="text-xs text-foreground-secondary">
              {n(postTotals.avgViews)} views each on average
            </span>
          }
        />
        <Tile
          icon={<Activity className="w-3.5 h-3.5" />}
          label="Engagement"
          value={pct(postTotals.engagementRate)}
          sub={
            <span className="text-xs text-foreground-secondary">
              {n(postTotals.likes)} likes, {n(postTotals.saves)} saves
            </span>
          }
        />
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
          value={compact(total.followers)}
          sub={<Delta value={total.followersGained24h} suffix="24h" />}
        />
      </div>

      {/* The trend. Deliberately NOT filtered: it is the whole operation over
          time, and a chart that silently changed meaning with the filters
          above it would be read wrong more often than right. */}
      <div className="space-y-1">
        <ViewsChart points={timeline} />
        <p className="text-[11px] text-foreground-secondary">
          Every video we have ever posted, day by day. This one chart ignores the filters above on
          purpose, so it always answers the same question.
        </p>
      </div>

      {/* Highlights */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {topByViews && topByViews.views != null && (
          <div data-testid="stats-top">
            <Trophy className="w-3.5 h-3.5 inline text-accent" /> Biggest account:{" "}
            <a
              href={`https://instagram.com/${topByViews.igUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-accent hover:underline"
            >
              @{topByViews.igUsername}
            </a>{" "}
            <span className="text-foreground-secondary">
              ({n(topByViews.views)} account views in 30 days)
            </span>
          </div>
        )}
        {topVideo && (
          <div data-testid="stats-top-video">
            <Trophy className="w-3.5 h-3.5 inline text-accent" /> Most viewed video:{" "}
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
            </a>{" "}
            <span className="text-foreground-secondary">({n(topVideo.views)} views)</span>
            {topVideo.platformPostUrl && (
              <>
                {" "}
                <a
                  href={topVideo.platformPostUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  watch
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {/* Creator sort controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-foreground-secondary">Sort creators by</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSort(s.key)}
            aria-pressed={sort === s.key}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              sort === s.key
                ? "bg-accent text-white"
                : "border border-border hover:bg-background-secondary"
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
      </div>

      {/* The creators, each expanding into their own videos */}
      <div className="border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1040px]">
          <thead>
            <tr className="bg-background-secondary text-left text-xs text-foreground-secondary">
              <th className="p-3 font-medium w-8" />
              <th className="p-3 font-medium">Creator</th>
              <th className="p-3 font-medium">Followers</th>
              <th className="p-3 font-medium">Gained 24h / 7d</th>
              <th className="p-3 font-medium">Following</th>
              <th className="p-3 font-medium">Views on our videos</th>
              <th className="p-3 font-medium">Engagement</th>
              <th className="p-3 font-medium">Account views (30d)</th>
              <th className="p-3 font-medium">Likes</th>
              <th className="p-3 font-medium">Reach</th>
              <th className="p-3 font-medium">Posts</th>
              <th className="p-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {/* flatMap, not a Fragment per creator: table rows stay ONE flat
                array so React keys them by row and an expand never remounts
                the rows around it. */}
            {sorted.flatMap((r) => {
              const mine = byCreator.get(r.profileId) ?? [];
              const isOpen = expanded.has(r.profileId);
              const seeAll = showAll.has(r.profileId);
              const shown = seeAll ? mine : mine.slice(0, PREVIEW_POSTS);
              return [
                  <tr
                    key={r.profileId}
                    className={`border-t border-border ${selected.has(r.profileId) ? "bg-accent/5" : ""}`}
                    data-testid={`stats-row-${r.igUsername}`}
                  >
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => toggleIn(expanded, setExpanded, r.profileId)}
                        data-testid={`expand-${r.profileId}`}
                        aria-expanded={isOpen}
                        aria-label={`Show videos for ${r.igUsername}`}
                        className="text-foreground-secondary hover:text-accent disabled:opacity-30"
                        disabled={!mine.length}
                      >
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(r.profileId)}
                          onChange={() => toggleIn(selected, setSelected, r.profileId)}
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
                            {r.measuredAt ? "" : " - not measured yet"}
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
                      <Bar value={r.ourViews} max={maxCreatorViews} />
                    </td>
                    <td className="p-3">
                      {pct(
                        r.ourViews && r.ourLikes != null ? r.ourLikes / r.ourViews : null,
                      )}
                    </td>
                    <td className="p-3">{n(r.views)}</td>
                    <td className="p-3">{n(r.likes)}</td>
                    <td className="p-3">{n(r.reach)}</td>
                    <td className="p-3">{r.postsPublished}</td>
                    <td className="p-3 text-xs text-foreground-secondary whitespace-nowrap">
                      {r.connectedAt
                        ? new Date(r.connectedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "-"}
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${r.profileId}-posts`} className="bg-background-secondary/60">
                      <td />
                      <td colSpan={11} className="p-3">
                        <div data-testid={`creator-posts-${r.profileId}`} className="space-y-1">
                          {!mine.length && (
                            <div className="text-xs text-foreground-secondary">
                              Nothing published for this creator yet.
                            </div>
                          )}
                          {shown.map((p, i) => (
                            <div
                              key={`${p.masterSeq}-${p.publishedAt}-${i}`}
                              className="flex flex-wrap items-center gap-3 text-xs py-1"
                            >
                              <span className="font-medium w-8">#{p.masterSeq}</span>
                              <span className="text-foreground-secondary truncate max-w-[180px]">
                                {p.masterTitle}
                              </span>
                              <span className="text-foreground-secondary">
                                {p.publishedAt
                                  ? new Date(p.publishedAt).toLocaleDateString("en-GB", {
                                      day: "numeric",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : ""}
                              </span>
                              <span className="font-semibold">
                                {p.metricsCapturedAt ? `${n(p.views)} views` : "not read yet"}
                              </span>
                              <Delta value={p.deltas[period].views} />
                              <span className="text-foreground-secondary">
                                {p.metricsCapturedAt ? `${n(p.likes)} likes` : ""}
                              </span>
                              {p.platformPostUrl && (
                                <a
                                  href={p.platformPostUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent hover:underline inline-flex items-center gap-1"
                                >
                                  watch <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ))}
                          {mine.length > PREVIEW_POSTS && (
                            <button
                              type="button"
                              onClick={() => toggleIn(showAll, setShowAll, r.profileId)}
                              data-testid={`show-all-${r.profileId}`}
                              className="text-xs underline text-accent"
                            >
                              {seeAll
                                ? "Show fewer"
                                : `Show all ${mine.length} videos, including earlier posts`}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null,
              ];
            })}
            {!sorted.length && (
              <tr>
                <td colSpan={12} className="p-6 text-center text-foreground-secondary">
                  No creators match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Which video works best, across everyone who posted it */}
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">Which video works best</h2>
            <p className="text-xs text-foreground-secondary">
              The same master across every creator who posted it. Tick one to filter the whole page
              to it. This is the row that decides what to make more of.
            </p>
          </div>
        </div>
        <div className="border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]" data-testid="master-table">
            <thead>
              <tr className="bg-background-secondary text-left text-xs text-foreground-secondary">
                <th className="p-3 font-medium w-8" />
                <th className="p-3 font-medium">Video</th>
                <th className="p-3 font-medium">Creators posting it</th>
                <th className="p-3 font-medium">Views</th>
                <th className="p-3 font-medium">Average each</th>
                <th className="p-3 font-medium">{periodLabel}</th>
                <th className="p-3 font-medium">Likes</th>
                <th className="p-3 font-medium">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {masterRows.map((m: MasterTotals) => (
                <tr
                  key={m.masterVideoId ?? String(m.seq)}
                  data-testid={`master-row-${m.masterVideoId ?? m.seq}`}
                  className={`border-t border-border ${
                    m.masterVideoId && masters.has(m.masterVideoId) ? "bg-accent/5" : ""
                  }`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={Boolean(m.masterVideoId && masters.has(m.masterVideoId))}
                      onChange={() =>
                        m.masterVideoId && toggleIn(masters, setMasters, m.masterVideoId)
                      }
                      aria-label={`Filter to video ${m.seq}`}
                      data-testid={`select-master-${m.masterVideoId ?? m.seq}`}
                    />
                  </td>
                  <td className="p-3">
                    <span className="font-medium">#{m.seq}</span>{" "}
                    <span className="text-foreground-secondary">{m.title}</span>
                  </td>
                  <td className="p-3">{m.posts}</td>
                  <td className="p-3 font-semibold">
                    {n(m.views)}
                    <Bar value={m.views} max={maxMasterViews} />
                  </td>
                  <td className="p-3">{n(m.avgViews)}</td>
                  <td className="p-3">
                    <Delta value={m.gainedViews} />
                  </td>
                  <td className="p-3">{n(m.likes)}</td>
                  <td className="p-3">{pct(m.engagementRate)}</td>
                </tr>
              ))}
              {!masterRows.length && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-foreground-secondary text-sm">
                    No videos match that filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Every video that went out, with what it actually did */}
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Videos posted</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-foreground-secondary">Sort by</span>
            {(
              [
                ["published", "Newest"],
                ["views", "Views"],
                ["gained", periodLabel],
                ["likes", "Likes"],
                ["reach", "Reach"],
                ["engagement", "Engagement"],
              ] as Array<[PostSortKey, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPostSort(k)}
                aria-pressed={postSort === k}
                data-testid={`post-sort-${k}`}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                  postSort === k
                    ? "bg-accent text-white"
                    : "border border-border hover:bg-background-secondary"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={exportVideos}
              className="text-xs inline-flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1 hover:bg-background-secondary"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>

        {/* The totals Hugo asked for, on the videos actually on screen */}
        <div
          className="flex flex-wrap gap-x-6 gap-y-1 text-sm border border-border rounded-xl px-4 py-3 bg-background-secondary"
          data-testid="posts-totals"
        >
          <span>
            <strong>{n(postTotals.videos)}</strong> video{postTotals.videos === 1 ? "" : "s"}
          </span>
          <span>
            <strong>{n(postTotals.views)}</strong> views
          </span>
          <span>
            <strong>{n(postTotals.likes)}</strong> likes
          </span>
          <span>
            <strong>{n(postTotals.reach)}</strong> reach
          </span>
          <span>
            <strong>{n(postTotals.comments)}</strong> comments
          </span>
          <span>
            <strong>{n(postTotals.saves)}</strong> saves
          </span>
          <span>
            <strong>{pct(postTotals.engagementRate)}</strong> engagement
          </span>
          <span className="text-foreground-secondary">
            across {postTotals.creators} creator{postTotals.creators === 1 ? "" : "s"}
          </span>
          {!dated && (
            <span className="ml-auto">
              <Delta value={postTotals.gainedViews} /> views {periodLabel.toLowerCase()}
            </span>
          )}
        </div>

        <div className="border border-border rounded-xl overflow-x-auto" data-testid="stats-posts">
          <table className="w-full text-sm min-w-[840px]">
            <thead>
              <tr className="bg-background-secondary text-left text-xs text-foreground-secondary">
                <th className="p-3 font-medium">Video</th>
                <th className="p-3 font-medium">Creator</th>
                <th className="p-3 font-medium">Posted</th>
                <th className="p-3 font-medium">Views</th>
                <th className="p-3 font-medium">{periodLabel}</th>
                <th className="p-3 font-medium">Likes</th>
                <th className="p-3 font-medium">Reach</th>
                <th className="p-3 font-medium">Engagement</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sortedPosts.map((p, i) => {
                const inter =
                  (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
                return (
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
                        <>
                          {n(p.views)}
                          <Bar value={p.views} max={maxPostViews} />
                        </>
                      ) : (
                        <span className="text-xs font-normal text-foreground-secondary">
                          not read yet
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <Delta value={p.deltas[period].views} />
                    </td>
                    <td className="p-3">{p.metricsCapturedAt ? n(p.likes) : "-"}</td>
                    <td className="p-3">{p.metricsCapturedAt ? n(p.reach) : "-"}</td>
                    <td className="p-3">{p.views ? pct(inter / p.views) : "-"}</td>
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
                );
              })}
              {!sortedPosts.length && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-foreground-secondary text-sm">
                    No videos match that filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-foreground-secondary">
        <Heart className="w-3 h-3 inline" /> <strong>Views on our videos</strong> is the sum of the
        videos this pipeline made, read one post at a time, counted since each went out.{" "}
        <strong>Account views (30d)</strong> is all that creator&apos;s content over a rolling
        thirty days, most of it nothing to do with us, so the two will never match. Instagram gives
        us no geography for either, so there is no country breakdown to show. Every number is read hourly. A period column is the difference between two
        readings, except for a video posted inside that period, where its whole count is the
        period&apos;s gain because it did not exist before. Picking dates filters by when a video
        went out and shows its totals since. Anything read only once says so rather than showing a
        zero.
      </p>
    </div>
  );
}
