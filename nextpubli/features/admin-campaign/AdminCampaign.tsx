"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CalendarClock,
  CheckCircle,
  Clapperboard,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  addMembersToCampaign,
  createCampaignItem,
  deleteCampaignItem,
  removeMemberFromCampaign,
  updateCampaign,
  updateCampaignItem,
} from "@/lib/actions/campaigns";
import {
  formatSaoPaulo,
  utcIsoToLocal,
  SCHEDULING_TIMEZONES,
  DEFAULT_TIMEZONE,
} from "@/lib/timezone";
import { MediaUpload } from "@/components/media-upload";
import type { Campaign, CampaignItem, PostMediaType } from "@/types/database";
import type { CampaignMemberRow, ConnectedAccountRow } from "@/lib/data/campaigns";
import { copy } from "./copy";

interface BrandOption {
  id: string;
  name: string;
}

interface AdminCampaignProps {
  campaign: Campaign;
  items: CampaignItem[];
  members: CampaignMemberRow[];
  candidates: ConnectedAccountRow[];
  brands: BrandOption[];
  defaultTimezone?: string;
}

const POST_TYPES: { value: PostMediaType; label: string }[] = [
  { value: "story_image", label: copy.postTypes.story_image },
  { value: "story_video", label: copy.postTypes.story_video },
  { value: "reel", label: copy.postTypes.reel },
  { value: "feed", label: copy.postTypes.feed },
  { value: "carousel", label: copy.postTypes.carousel },
];

function typeLabel(type: PostMediaType) {
  return copy.postTypes[type];
}

// --- Item add/edit modal ---

const STORY_TYPES: PostMediaType[] = ["story_image", "story_video"];

function ItemModal({
  campaign,
  brands,
  item,
  defaultTimezone,
  onClose,
}: {
  campaign: Campaign;
  brands: BrandOption[];
  item: CampaignItem | null;
  defaultTimezone: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<PostMediaType>(
    item?.media_type ?? "story_image",
  );
  const [mediaUrl, setMediaUrl] = useState(item?.media_url ?? "");

  const isStory = STORY_TYPES.includes(mediaType);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("campaign_id", campaign.id);
    setError(null);
    startTransition(async () => {
      const r = item
        ? await updateCampaignItem(item.id, formData)
        : await createCampaignItem(formData);
      if (r && "error" in r) setError(r.error);
      else onClose();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {item ? copy.itemModal.editTitle : copy.itemModal.addTitle}
          </h2>
          <button
            onClick={onClose}
            className="text-foreground-secondary hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="item-media-type"
              className="text-sm font-medium text-foreground-secondary"
            >
              {copy.itemModal.mediaType}
            </label>
            <select
              id="item-media-type"
              name="media_type"
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as PostMediaType)}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {POST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="item-brand"
              className="text-sm font-medium text-foreground-secondary"
            >
              {copy.itemModal.brand}
            </label>
            <select
              id="item-brand"
              name="brand_id"
              defaultValue={item?.brand_id ?? campaign.brand_id ?? brands[0]?.id ?? ""}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground-secondary">
              {copy.itemModal.media}
            </span>
            <MediaUpload onUploaded={setMediaUrl} />
            <input
              id="item-media-url"
              name="media_url"
              type="url"
              required
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder={copy.itemModal.mediaUrl}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>

          {isStory ? (
            <p className="rounded-lg bg-background-secondary px-3 py-2 text-xs text-foreground-secondary">
              {copy.itemModal.storyNote}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="item-caption"
                className="text-sm font-medium text-foreground-secondary"
              >
                {copy.itemModal.caption}
              </label>
              <textarea
                id="item-caption"
                name="caption"
                rows={3}
                defaultValue={item?.caption ?? ""}
                placeholder="Escreva a legenda do post..."
                className="resize-none rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {!isStory && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="item-collaborators"
                className="text-sm font-medium text-foreground-secondary"
              >
                {copy.itemModal.collaborators}
              </label>
              <input
                id="item-collaborators"
                name="collaborators"
                type="text"
                defaultValue={item?.instagram_options?.collaborators?.join(", ") ?? ""}
                placeholder={copy.itemModal.collaboratorsPlaceholder}
                className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {!isStory && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="item-first-comment"
                className="text-sm font-medium text-foreground-secondary"
              >
                {copy.itemModal.firstComment}
              </label>
              <textarea
                id="item-first-comment"
                name="first_comment"
                rows={2}
                defaultValue={item?.instagram_options?.first_comment ?? ""}
                placeholder={copy.itemModal.firstCommentPlaceholder}
                className="resize-none rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {mediaType === "reel" && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="item-reel-cover"
                className="text-sm font-medium text-foreground-secondary"
              >
                {copy.itemModal.reelCover}
              </label>
              <input
                id="item-reel-cover"
                name="reel_cover_seconds"
                type="number"
                min="0"
                step="0.1"
                defaultValue={item?.instagram_options?.reel_cover_seconds ?? ""}
                placeholder="ex: 2.5"
                className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="item-scheduled-at"
                className="text-sm font-medium text-foreground-secondary"
              >
                {copy.itemModal.scheduledAt}
              </label>
              <input
                id="item-scheduled-at"
                name="scheduled_at"
                type="datetime-local"
                required
                defaultValue={
                  item ? utcIsoToLocal(item.scheduled_at, defaultTimezone) : ""
                }
                className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="item-timezone"
                className="text-sm font-medium text-foreground-secondary"
              >
                {copy.itemModal.timezone}
              </label>
              <select
                id="item-timezone"
                name="timezone"
                defaultValue={defaultTimezone}
                className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                {SCHEDULING_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? copy.itemModal.saving : copy.itemModal.save}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- Add accounts modal ---

function AddAccountsModal({
  campaign,
  candidates,
  onClose,
}: {
  campaign: Campaign;
  candidates: ConnectedAccountRow[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [startNow, setStartNow] = useState(false);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = candidates.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.ig_username ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await addMembersToCampaign(campaign.id, selected, startNow);
      if (r && "error" in r) setError(r.error);
      else onClose();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{copy.addModal.title}</h2>
          <button
            onClick={onClose}
            className="text-foreground-secondary hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-foreground-secondary">
            {copy.addModal.empty}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={copy.members.search}
                className="w-full rounded-lg border border-border py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() =>
                  setSelected(
                    selected.length === filtered.length
                      ? []
                      : filtered.map((c) => c.profile_id),
                  )
                }
                className="text-accent hover:underline"
              >
                {selected.length === filtered.length
                  ? copy.addModal.deselectAll
                  : copy.addModal.selectAll}
              </button>
              <span className="text-foreground-secondary">
                {selected.length} selecionada(s)
              </span>
            </div>

            <div className="max-h-60 space-y-1 overflow-y-auto">
              {filtered.map((c) => (
                <label
                  key={c.profile_id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-background-secondary"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(c.profile_id)}
                    onChange={() => toggle(c.profile_id)}
                    className="rounded border-border"
                  />
                  <span className="flex-1 text-sm">
                    <span className="font-medium">{c.name}</span>
                    {c.ig_username && (
                      <span className="ml-2 text-foreground-secondary">
                        @{c.ig_username}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-foreground-secondary">
                    {copy.addModal.connectedAt} {formatSaoPaulo(c.connected_at)}
                  </span>
                </label>
              ))}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(e) => setStartNow(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <span className="text-sm">
                <span className="flex items-center gap-1 font-medium">
                  <Zap size={14} className="text-warning" />
                  {copy.addModal.startNowLabel}
                </span>
                <span className="text-xs text-foreground-secondary">
                  {copy.addModal.startNowHint}
                </span>
              </span>
            </label>

            {error && <p className="text-sm text-error">{error}</p>}
            <button
              onClick={submit}
              disabled={isPending || selected.length === 0}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {isPending ? copy.addModal.adding : copy.addModal.add}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Campaign settings modal ---

function SettingsModal({
  campaign,
  brands,
  onClose,
}: {
  campaign: Campaign;
  brands: BrandOption[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const r = await updateCampaign(campaign.id, formData);
      if (r && "error" in r) setError(r.error);
      else onClose();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{copy.settings.title}</h2>
          <button
            onClick={onClose}
            className="text-foreground-secondary hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="campaign-name"
              className="text-sm font-medium text-foreground-secondary"
            >
              {copy.settings.name}
            </label>
            <input
              id="campaign-name"
              name="name"
              required
              defaultValue={campaign.name}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="campaign-description"
              className="text-sm font-medium text-foreground-secondary"
            >
              {copy.settings.description}
            </label>
            <textarea
              id="campaign-description"
              name="description"
              rows={2}
              defaultValue={campaign.description ?? ""}
              className="resize-none rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="campaign-brand"
              className="text-sm font-medium text-foreground-secondary"
            >
              {copy.settings.brand}
            </label>
            <select
              id="campaign-brand"
              name="brand_id"
              defaultValue={campaign.brand_id ?? ""}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">—</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? copy.settings.saving : copy.settings.save}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- Main component ---

export function AdminCampaign({
  campaign,
  items,
  members,
  candidates,
  brands,
  defaultTimezone = DEFAULT_TIMEZONE,
}: AdminCampaignProps) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("upcoming");
  const [memberSearch, setMemberSearch] = useState("");
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CampaignItem | null>(null);
  const [showAddAccounts, setShowAddAccounts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  // Snapshot of "now" for upcoming/past labels — stable across re-renders.
  const [now] = useState(() => Date.now());

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter !== "all" && item.media_type !== typeFilter) return false;
      const isUpcoming = new Date(item.scheduled_at).getTime() > now;
      if (timeFilter === "upcoming" && !isUpcoming) return false;
      if (timeFilter === "past" && isUpcoming) return false;
      return true;
    });
  }, [items, typeFilter, timeFilter, now]);

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      (m.ig_username ?? "").toLowerCase().includes(memberSearch.toLowerCase()),
  );

  const handleDeleteItem = (item: CampaignItem) => {
    if (!window.confirm(copy.schedule.confirmDelete)) return;
    setActionError(null);
    startTransition(async () => {
      const r = await deleteCampaignItem(item.id);
      if (r && "error" in r) setActionError(r.error);
    });
  };

  const handleRemoveMember = (profileId: string) => {
    if (!window.confirm(copy.members.confirmRemove)) return;
    setActionError(null);
    startTransition(async () => {
      const r = await removeMemberFromCampaign(campaign.id, profileId);
      if (r && "error" in r) setActionError(r.error);
    });
  };

  const brandName = (id: string | null) => brands.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          {campaign.description && (
            <p className="mt-1 text-sm text-foreground-secondary">
              {campaign.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary">
            <CalendarClock size={15} />
            {items.length} {copy.stats.items}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary">
            <Users size={15} />
            {members.length} {copy.stats.members}
          </span>
          <button
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-background-secondary"
          >
            <Settings2 size={15} /> {copy.settings.edit}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
          {actionError}
        </div>
      )}

      {/* Cronograma */}
      <section className="rounded-xl border border-border p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Clapperboard size={18} className="text-accent" />
            {copy.schedule.heading}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="filter-type" className="sr-only">
              {copy.schedule.type}
            </label>
            <select
              id="filter-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="all">{copy.schedule.filterTypeAll}</option>
              {POST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <label htmlFor="filter-time" className="sr-only">
              {copy.schedule.when}
            </label>
            <select
              id="filter-time"
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="upcoming">{copy.schedule.filterUpcoming}</option>
              <option value="past">{copy.schedule.filterPast}</option>
              <option value="all">{copy.schedule.filterAll}</option>
            </select>
            <button
              onClick={() => {
                setEditingItem(null);
                setShowItemModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <Plus size={16} /> {copy.schedule.addItem}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary">
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.schedule.when}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.schedule.type}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.schedule.brand}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.schedule.caption}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.schedule.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const isUpcoming = new Date(item.scheduled_at).getTime() > now;
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-medium">
                        {formatSaoPaulo(item.scheduled_at)}
                      </div>
                      <span
                        className={`text-xs ${isUpcoming ? "text-warning" : "text-success"}`}
                      >
                        {isUpcoming ? copy.schedule.upcoming : copy.schedule.past}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {typeLabel(item.media_type)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-foreground-secondary">
                      {brandName(item.brand_id ?? campaign.brand_id)}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-foreground-secondary">
                      {item.caption || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingItem(item);
                            setShowItemModal(true);
                          }}
                          title={copy.schedule.edit}
                          className="rounded p-1.5 hover:bg-background-secondary"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item)}
                          disabled={isPending}
                          title={copy.schedule.delete}
                          className="rounded p-1.5 text-error hover:bg-error/10"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-foreground-secondary"
                  >
                    {copy.schedule.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Contas */}
      <section className="rounded-xl border border-border p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users size={18} className="text-accent" />
            {copy.members.heading}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
              />
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder={copy.members.search}
                className="rounded-lg border border-border py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <button
              onClick={() => setShowAddAccounts(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <UserPlus size={16} /> {copy.members.addAccounts}
              {candidates.length > 0 && (
                <span className="rounded-full bg-white/20 px-1.5 text-xs">
                  {candidates.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary">
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.members.name}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.members.instagram}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.members.addedAt}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.members.startMode}
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  {copy.schedule.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3">
                    {m.ig_username ? (
                      <a
                        href={`https://instagram.com/${m.ig_username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        @{m.ig_username}
                      </a>
                    ) : (
                      <span className="text-foreground-secondary">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-foreground-secondary">
                    {formatSaoPaulo(m.added_at)}
                  </td>
                  <td className="px-4 py-3">
                    {m.start_mode === "immediate" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
                        <Zap size={11} /> {copy.members.startNow}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                        <CheckCircle size={11} /> {copy.members.startSchedule}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRemoveMember(m.profile_id)}
                      disabled={isPending}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-error hover:bg-error/10"
                    >
                      {copy.members.remove}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredMembers.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-foreground-secondary"
                  >
                    {copy.members.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showItemModal && (
        <ItemModal
          campaign={campaign}
          brands={brands}
          item={editingItem}
          defaultTimezone={defaultTimezone}
          onClose={() => {
            setShowItemModal(false);
            setEditingItem(null);
          }}
        />
      )}
      {showAddAccounts && (
        <AddAccountsModal
          campaign={campaign}
          candidates={candidates}
          onClose={() => setShowAddAccounts(false)}
        />
      )}
      {showSettings && (
        <SettingsModal
          campaign={campaign}
          brands={brands}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
