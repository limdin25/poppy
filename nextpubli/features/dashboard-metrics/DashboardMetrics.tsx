"use client";

import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  Heart,
  MessageCircle,
  UserPlus,
  Users,
  Zap,
  BarChart3,
} from "lucide-react";

export interface ProfileMetrics {
  period: string;
  reach: number;
  reachChange: number;
  views: number;
  viewsChange: number;
  engagement: number;
  engagementChange: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  newFollowers: number;
  followersChange: number;
  profileVisits: number;
  topCities: { name: string; count: number }[];
  topCountries: { name: string; count: number }[];
  ageGender: { range: string; male: number; female: number }[];
  contentBreakdown: { type: string; reach: number; engagement: number }[];
}

interface DashboardMetricsProps {
  profileMetrics: ProfileMetrics[];
  isConnected?: boolean;
  igUsername?: string;
  connectUrl?: string;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  change,
  color = "accent",
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  change?: number;
  color?: string;
}) {
  const colorMap: Record<string, { bg: string; icon: string }> = {
    accent: { bg: "bg-accent/10", icon: "text-accent" },
    purple: { bg: "bg-[#7C3AED]/10", icon: "text-[#7C3AED]" },
    blue: { bg: "bg-[#3B82F6]/10", icon: "text-[#3B82F6]" },
    green: { bg: "bg-success/10", icon: "text-success" },
    orange: { bg: "bg-[#F97316]/10", icon: "text-[#F97316]" },
    pink: { bg: "bg-[#EC4899]/10", icon: "text-[#EC4899]" },
  };
  const c = colorMap[color] ?? colorMap.accent;

  return (
    <div className="rounded-xl border border-border p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2.5">
        <div className={`rounded-lg ${c.bg} p-2`}>
          <Icon size={18} className={c.icon} />
        </div>
        <span className="text-xs font-medium text-foreground-secondary">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-bold">{value}</p>
      {change !== undefined && (
        <div
          className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${change >= 0 ? "text-success" : "text-error"}`}
        >
          {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {change >= 0 ? "+" : ""}
          {change}% vs período anterior
        </div>
      )}
    </div>
  );
}

function HorizontalBar({
  data,
  maxValue,
}: {
  data: { label: string; value: number }[];
  maxValue: number;
}) {
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-foreground-secondary truncate">
            {item.label}
          </span>
          <div className="flex-1 h-5 rounded-full bg-background-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584]"
              style={{ width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%` }}
            />
          </div>
          <span className="w-12 text-right text-xs font-medium">
            {item.value.toLocaleString("pt-BR")}
          </span>
        </div>
      ))}
    </div>
  );
}

function AgeGenderChart({ data }: { data: ProfileMetrics["ageGender"] }) {
  const max = Math.max(...data.flatMap((d) => [d.male, d.female]), 1);
  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={row.range} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-xs text-foreground-secondary text-right">
            {row.range}
          </span>
          <div className="flex flex-1 gap-1">
            <div className="flex-1 flex justify-end">
              <div
                className="h-5 rounded-l-full bg-blue-400"
                style={{ width: `${(row.male / max) * 100}%` }}
              />
            </div>
            <div className="flex-1">
              <div
                className="h-5 rounded-r-full bg-accent"
                style={{ width: `${(row.female / max) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
      <div className="flex justify-center gap-6 pt-2 text-xs text-foreground-secondary">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> Masculino
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" /> Feminino
        </span>
      </div>
    </div>
  );
}

export function DashboardMetrics({
  profileMetrics,
  isConnected = false,
  igUsername,
  connectUrl = "/api/instagram/connect",
}: DashboardMetricsProps) {
  const [periodIndex, setPeriodIndex] = useState(0);
  const metrics = profileMetrics[periodIndex];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Métricas do Perfil</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            Dados do Instagram em tempo real
          </p>
        </div>
        {profileMetrics.length > 0 && (
          <select
            value={periodIndex}
            onChange={(e) => setPeriodIndex(Number(e.target.value))}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {profileMetrics.map((m, i) => (
              <option key={m.period} value={i}>
                {m.period}
              </option>
            ))}
          </select>
        )}
      </div>

      {metrics ? (
        <>
          <div className="rounded-xl border border-accent/20 bg-gradient-to-r from-accent/5 via-[#C13584]/5 to-[#F56040]/5 p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent/10 p-2.5">
                <Zap size={22} className="text-accent" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Taxa de Engajamento</p>
                <p className="text-3xl font-bold text-accent">
                  {metrics.engagement.toFixed(1)}%
                </p>
              </div>
              {metrics.engagementChange !== 0 && (
                <div
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${
                    metrics.engagementChange >= 0
                      ? "bg-success/10 text-success"
                      : "bg-error/10 text-error"
                  }`}
                >
                  {metrics.engagementChange >= 0 ? (
                    <TrendingUp size={14} />
                  ) : (
                    <TrendingDown size={14} />
                  )}
                  {metrics.engagementChange >= 0 ? "+" : ""}
                  {metrics.engagementChange}%
                </div>
              )}
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] transition-all"
                style={{ width: `${Math.min(metrics.engagement * 10, 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-foreground-secondary">
              Média acima de 3% é considerada excelente para o Instagram
            </p>
          </div>

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon={Heart}
              label="Curtidas"
              value={metrics.likes.toLocaleString("pt-BR")}
              color="accent"
            />
            <MetricCard
              icon={MessageCircle}
              label="Comentários"
              value={metrics.comments.toLocaleString("pt-BR")}
              color="purple"
            />
            {metrics.reach > 0 && (
              <MetricCard
                icon={Eye}
                label="Interações totais"
                value={metrics.reach.toLocaleString("pt-BR")}
                color="blue"
              />
            )}
            {metrics.newFollowers > 0 && (
              <MetricCard
                icon={UserPlus}
                label="Novos seguidores"
                value={`+${metrics.newFollowers}`}
                change={metrics.followersChange || undefined}
                color="green"
              />
            )}
            {metrics.profileVisits > 0 && (
              <MetricCard
                icon={Users}
                label="Visitas ao perfil"
                value={metrics.profileVisits.toLocaleString("pt-BR")}
                color="orange"
              />
            )}
          </div>

          {metrics.contentBreakdown.length > 0 && (
            <div className="rounded-xl border border-border p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={18} className="text-[#7C3AED]" />
                <h3 className="text-sm font-semibold">
                  Performance por tipo de conteúdo
                </h3>
              </div>
              <div className="space-y-3">
                {metrics.contentBreakdown.map((item, i) => {
                  const colors = [
                    "from-[#F56040] to-[#E1306C]",
                    "from-[#7C3AED] to-[#6366F1]",
                    "from-[#3B82F6] to-[#0EA5E9]",
                    "from-[#10B981] to-[#14B8A6]",
                  ];
                  const maxReach = Math.max(
                    ...metrics.contentBreakdown.map((c) => c.reach),
                    1,
                  );
                  return (
                    <div key={item.type} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{item.type}</span>
                        <div className="flex gap-3 text-xs text-foreground-secondary">
                          <span>{item.reach.toLocaleString("pt-BR")} interações</span>
                          <span className="font-semibold text-accent">
                            {item.engagement.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2.5 rounded-full bg-background-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${colors[i % colors.length]} transition-all`}
                          style={{
                            width: `${(item.reach / maxReach) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {metrics.topCities.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-border p-4 sm:p-5">
                <h3 className="mb-3 text-sm font-semibold">Principais cidades</h3>
                <HorizontalBar
                  data={metrics.topCities.map((c) => ({ label: c.name, value: c.count }))}
                  maxValue={Math.max(...metrics.topCities.map((c) => c.count), 1)}
                />
              </div>
              {metrics.topCountries.length > 0 && (
                <div className="rounded-xl border border-border p-4 sm:p-5">
                  <h3 className="mb-3 text-sm font-semibold">Principais países</h3>
                  <HorizontalBar
                    data={metrics.topCountries.map((c) => ({
                      label: c.name,
                      value: c.count,
                    }))}
                    maxValue={Math.max(...metrics.topCountries.map((c) => c.count), 1)}
                  />
                </div>
              )}
              {metrics.ageGender.length > 0 && (
                <div className="rounded-xl border border-border p-4 sm:p-5 sm:col-span-2 lg:col-span-1">
                  <h3 className="mb-3 text-sm font-semibold">Idade e gênero</h3>
                  <AgeGenderChart data={metrics.ageGender} />
                </div>
              )}
            </div>
          )}
        </>
      ) : isConnected ? (
        <div className="rounded-xl border border-border bg-background-secondary p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <Eye size={28} className="text-success" />
          </div>
          <p className="mt-4 text-lg font-semibold">
            Instagram conectado{igUsername ? ` — @${igUsername}` : ""}
          </p>
          <p className="mt-2 text-sm text-foreground-secondary">
            As métricas detalhadas do seu perfil aparecerão aqui em breve. Estamos
            coletando os dados da sua conta.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <Eye size={32} className="mx-auto text-foreground-secondary/40" />
          <p className="mt-3 font-medium text-foreground-secondary">
            Conecte seu Instagram para ver as métricas do perfil
          </p>
          <a
            href={connectUrl}
            className="mt-4 inline-block rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-2.5 text-sm font-medium text-white"
          >
            Conectar Instagram
          </a>
        </div>
      )}
    </div>
  );
}
