"use client";

import { useState } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  subMonths,
  getDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Image,
  Film,
  Play,
  X,
  Eye,
  Heart,
  MessageCircle,
  Share2,
} from "lucide-react";
import type { ScheduledPost } from "@/types/database";

interface DashboardCalendarProps {
  posts: ScheduledPost[];
}

const STATUS_COLORS = {
  published: "bg-success",
  pending: "bg-warning",
  failed: "bg-error",
} as const;

const STATUS_LABELS = {
  published: "Publicado",
  pending: "Agendado",
  failed: "Falhou",
} as const;

const MEDIA_LABELS: Record<string, string> = {
  feed: "Feed",
  story_image: "Story",
  story_video: "Story (vídeo)",
  reel: "Reel",
  carousel: "Carrossel",
};

function PostIcon({ type }: { type: string }) {
  if (type === "reel" || type === "story_video") return <Play size={10} />;
  if (type === "story_image") return <Film size={10} />;
  return <Image size={10} />;
}

export function DashboardCalendar({ posts }: DashboardCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);

  const getPostsForDay = (day: Date) =>
    posts.filter((p) => isSameDay(new Date(p.scheduled_at), day));

  const selectedPosts = selectedDay ? getPostsForDay(selectedDay) : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendário</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="rounded-lg border border-border p-2 hover:bg-background-secondary"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] text-center font-medium capitalize">
            {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="rounded-lg border border-border p-2 hover:bg-background-secondary"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-success" />
          <span>Publicado</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-warning" />
          <span>Agendado</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-error" />
          <span>Falhou</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-xl border border-border bg-border overflow-hidden">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <div
            key={d}
            className="bg-background-secondary p-2 text-center text-xs font-medium text-foreground-secondary"
          >
            {d}
          </div>
        ))}
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-background p-2 min-h-[80px]" />
        ))}
        {days.map((day) => {
          const dayPosts = getPostsForDay(day);
          const isSelected = selectedDay && isSameDay(day, selectedDay);
          const isToday = isSameDay(day, new Date());
          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDay(dayPosts.length > 0 ? day : null)}
              className={`bg-background p-2 min-h-[80px] text-left transition-colors hover:bg-background-secondary ${
                isSelected ? "ring-2 ring-inset ring-accent" : ""
              } ${dayPosts.length > 0 ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className={`text-xs ${
                  isToday
                    ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white font-medium"
                    : "text-foreground-secondary"
                }`}
              >
                {format(day, "d")}
              </span>
              <div className="mt-1 space-y-1">
                {dayPosts.map((post) => (
                  <div
                    key={post.id}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white ${STATUS_COLORS[post.status]}`}
                  >
                    <PostIcon type={post.media_type} />
                    <span className="truncate">
                      {MEDIA_LABELS[post.media_type] ?? "Post"}
                    </span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDay && selectedPosts.length > 0 && (
        <div className="rounded-2xl border border-border bg-background p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {format(selectedDay, "d 'de' MMMM", { locale: ptBR })} ·{" "}
              {selectedPosts.length}{" "}
              {selectedPosts.length === 1 ? "publicação" : "publicações"}
            </h2>
            <button
              onClick={() => setSelectedDay(null)}
              className="rounded-lg p-1.5 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3">
            {selectedPosts.map((post) => (
              <div
                key={post.id}
                className="flex gap-4 rounded-xl border border-border p-4"
              >
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-background-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.media_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div
                    className={`absolute bottom-1 left-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLORS[post.status]}`}
                  >
                    <PostIcon type={post.media_type} />
                    {MEDIA_LABELS[post.media_type] ?? "Post"}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white ${STATUS_COLORS[post.status]}`}
                    >
                      {STATUS_LABELS[post.status]}
                    </span>
                    <span className="text-xs text-foreground-secondary">
                      {format(new Date(post.scheduled_at), "HH:mm")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-foreground line-clamp-2">
                    {post.caption}
                  </p>
                  {post.status === "published" &&
                    (post.reach ?? post.likes ?? post.comments ?? post.shares) !==
                      null && (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {post.reach != null && (
                          <span className="flex items-center gap-1 text-xs text-foreground-secondary">
                            <Eye size={13} />
                            {post.reach.toLocaleString("pt-BR")}
                          </span>
                        )}
                        {post.likes != null && (
                          <span className="flex items-center gap-1 text-xs text-foreground-secondary">
                            <Heart size={13} />
                            {post.likes.toLocaleString("pt-BR")}
                          </span>
                        )}
                        {post.comments != null && (
                          <span className="flex items-center gap-1 text-xs text-foreground-secondary">
                            <MessageCircle size={13} />
                            {post.comments.toLocaleString("pt-BR")}
                          </span>
                        )}
                        {post.shares != null && (
                          <span className="flex items-center gap-1 text-xs text-foreground-secondary">
                            <Share2 size={13} />
                            {post.shares.toLocaleString("pt-BR")}
                          </span>
                        )}
                      </div>
                    )}
                  {post.error_message && (
                    <p className="mt-1 text-xs text-error">{post.error_message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
