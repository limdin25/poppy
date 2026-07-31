"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck } from "lucide-react";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/actions/notifications";
import { formatSaoPaulo } from "@/lib/timezone";
import type { AppNotification } from "@/types/database";
import { copy } from "./copy";

type Filter = "all" | "unread";

interface AdminNotificationsProps {
  notifications: AppNotification[];
}

function NotificationRow({ notification: n }: { notification: AppNotification }) {
  const [isPending, startTransition] = useTransition();
  const unread = n.read_at === null;

  return (
    <li
      className={`flex items-start gap-3 border-b border-border p-4 last:border-0 sm:p-5 ${
        unread ? "bg-accent/5" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-2 size-2 shrink-0 rounded-full ${
          unread ? "bg-accent" : "bg-transparent"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{n.title}</p>
          {unread && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
              {copy.unreadBadge}
            </span>
          )}
        </div>
        {n.body && <p className="mt-0.5 text-sm text-foreground-secondary">{n.body}</p>}
        <p className="mt-1 text-xs text-foreground-secondary">
          {formatSaoPaulo(n.created_at)}
        </p>
        {n.type === "account_connected" && (
          <Link
            href="/admin/campanha"
            className="mt-2 inline-flex items-center text-sm font-medium text-accent hover:underline"
          >
            {copy.addToCampaign}
          </Link>
        )}
      </div>
      {unread && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => void markNotificationRead(n.id))}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:bg-background-secondary disabled:opacity-50"
        >
          <Check size={14} /> {copy.markRead}
        </button>
      )}
    </li>
  );
}

export function AdminNotifications({ notifications }: AdminNotificationsProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [isPending, startTransition] = useTransition();

  const unreadCount = notifications.filter((n) => n.read_at === null).length;
  const visible =
    filter === "unread" ? notifications.filter((n) => n.read_at === null) : notifications;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{copy.title}</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            {copy.unreadCount(unreadCount)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            aria-label={copy.filterLabel}
            className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="all">{copy.filterAll}</option>
            <option value="unread">{copy.filterUnread}</option>
          </select>
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => void markAllNotificationsRead())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              <CheckCheck size={16} /> {copy.markAllRead}
            </button>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <div className="rounded-lg bg-background-secondary p-2">
              <Bell size={20} className="text-foreground-secondary" />
            </div>
            <p className="text-sm text-foreground-secondary">{copy.empty}</p>
          </div>
        ) : (
          <ul>
            {visible.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
