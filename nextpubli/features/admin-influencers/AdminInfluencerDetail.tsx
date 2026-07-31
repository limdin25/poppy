"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AtSign,
  Ban,
  Calendar,
  DollarSign,
  Eye,
  Globe,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  ShoppingCart,
  Trash2,
  Unplug,
  User,
  Wallet,
  X,
} from "lucide-react";
import {
  deleteInfluencer,
  disconnectInfluencerInstagram,
  setInfluencerSuspended,
  updateInfluencerProfile,
  updateInfluencerAuth,
} from "@/lib/actions/admin";
import type {
  Profile,
  InstagramConnection,
  OutstandConnection,
  HotmartSale,
  ScheduledPost,
} from "@/types/database";

interface AdminInfluencerDetailProps {
  profile: Profile;
  instagram: InstagramConnection | null;
  outstand: OutstandConnection | null;
  sales: HotmartSale[];
  posts: ScheduledPost[];
  sectors: string[];
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon size={16} className="shrink-0 text-foreground-secondary" />
      <span className="text-sm text-foreground-secondary w-32 shrink-0">{label}</span>
      <span className="text-sm font-medium">{value || "-"}</span>
    </div>
  );
}

function EditField({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-foreground-secondary">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

export function AdminInfluencerDetail({
  profile,
  instagram,
  outstand,
  sales,
  posts,
  sectors,
}: AdminInfluencerDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editAuth, setEditAuth] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  const totalCommission = sales
    .filter((s) => s.status === "confirmed")
    .reduce((sum, s) => sum + s.commission_amount, 0);
  const totalSalesCount = sales.filter((s) => s.status === "confirmed").length;
  const publishedPosts = posts.filter((p) => p.status === "published").length;
  const pendingPosts = posts.filter((p) => p.status === "pending").length;

  const handleDelete = () => {
    startTransition(async () => {
      await deleteInfluencer(profile.id);
      router.push("/admin/influenciadores");
    });
  };

  const handleDisconnect = () => {
    if (!instagram) return;
    startTransition(async () => {
      await disconnectInfluencerInstagram(instagram.id);
      setConfirmDisconnect(false);
      router.refresh();
    });
  };

  const isSuspended = Boolean(profile.suspended_at);

  const handleToggleSuspend = () => {
    startTransition(async () => {
      const result = await setInfluencerSuspended(profile.id, !isSuspended);
      setConfirmSuspend(false);
      if (result && "error" in result) {
        setFeedback({ type: "error", msg: result.error ?? "Erro" });
      } else {
        setFeedback({
          type: "success",
          msg: isSuspended ? "Conta reativada" : "Conta suspensa",
        });
        router.refresh();
      }
    });
  };

  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setFeedback(null);

    startTransition(async () => {
      const result = await updateInfluencerProfile(profile.id, formData);
      if (result.error) {
        setFeedback({ type: "error", msg: result.error });
      } else {
        setFeedback({ type: "success", msg: "Perfil atualizado" });
        setEditMode(false);
        router.refresh();
      }
    });
  };

  const handleSaveAuth = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setFeedback(null);

    startTransition(async () => {
      const result = await updateInfluencerAuth(profile.id, formData);
      if (result.error) {
        setFeedback({ type: "error", msg: result.error });
      } else {
        setFeedback({ type: "success", msg: "Email/senha atualizados" });
        setEditAuth(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/influenciadores"
          className="rounded-lg border border-border p-2 hover:bg-background-secondary transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            {profile.first_name} {profile.last_name}
            {isSuspended && (
              <span className="ml-3 inline-flex rounded-full bg-error/10 px-3 py-1 align-middle text-xs font-medium text-error">
                Suspensa
              </span>
            )}
          </h1>
          <p className="text-sm text-foreground-secondary">{profile.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {profile.whatsapp && (
            <a
              href={`https://wa.me/${profile.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-background-secondary transition-colors"
            >
              <MessageSquare size={16} className="text-success" />
              WhatsApp
            </a>
          )}
          <a
            href={`mailto:${profile.email}`}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-background-secondary transition-colors"
          >
            <Mail size={16} />
            Email
          </a>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${feedback.type === "success" ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <ShoppingCart size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-xs text-foreground-secondary">Vendas</p>
              <p className="text-xl font-bold">{totalSalesCount}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <DollarSign size={20} className="text-success" />
            </div>
            <div>
              <p className="text-xs text-foreground-secondary">Comissão total</p>
              <p className="text-xl font-bold">
                R$ {totalCommission.toFixed(2).replace(".", ",")}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <Calendar size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-xs text-foreground-secondary">Posts publicados</p>
              <p className="text-xl font-bold">{publishedPosts}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Eye size={20} className="text-warning" />
            </div>
            <div>
              <p className="text-xs text-foreground-secondary">Posts pendentes</p>
              <p className="text-xl font-bold">{pendingPosts}</p>
            </div>
          </div>
        </div>
      </div>

      {editAuth ? (
        <form
          onSubmit={handleSaveAuth}
          className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Lock size={16} />
              Alterar email / senha
            </h2>
            <button
              type="button"
              onClick={() => setEditAuth(false)}
              className="rounded-lg p-1.5 hover:bg-background-secondary"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditField
              label="Novo email"
              name="email"
              defaultValue={profile.email}
              type="email"
            />
            <EditField
              label="Nova senha (deixe vazio para manter)"
              name="password"
              defaultValue=""
              type="password"
              placeholder="••••••••"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditAuth(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {isPending ? "Salvando..." : "Salvar credenciais"}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setEditAuth(true)}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-background-secondary transition-colors"
        >
          <Lock size={14} />
          Alterar email / senha
        </button>
      )}

      {editMode ? (
        <form onSubmit={handleSaveProfile} className="space-y-6">
          <section className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Pencil size={16} />
                Editar perfil
              </h2>
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="rounded-lg p-1.5 hover:bg-background-secondary"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <EditField
                label="Nome"
                name="first_name"
                defaultValue={profile.first_name}
              />
              <EditField
                label="Sobrenome"
                name="last_name"
                defaultValue={profile.last_name}
              />
              <EditField
                label="WhatsApp"
                name="whatsapp"
                defaultValue={profile.whatsapp ?? ""}
                placeholder="+55 11 99999-9999"
              />
              <EditField
                label="Celular"
                name="phone"
                defaultValue={profile.phone ?? ""}
                placeholder="+55 11 99999-9999"
              />
              <EditField
                label="Data de nascimento"
                name="date_of_birth"
                defaultValue={profile.date_of_birth ?? ""}
                type="date"
              />
              <EditField
                label="Rua"
                name="address_street"
                defaultValue={profile.address_street ?? ""}
              />
              <EditField
                label="Cidade"
                name="address_city"
                defaultValue={profile.address_city ?? ""}
              />
              <EditField
                label="CEP"
                name="address_postal_code"
                defaultValue={profile.address_postal_code ?? ""}
              />
            </div>

            <h3 className="text-sm font-semibold pt-2">Pagamento</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground-secondary">
                  Tipo PIX
                </label>
                <select
                  name="pix_key_type"
                  defaultValue={profile.pix_key_type ?? ""}
                  className="rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Nenhum</option>
                  <option value="cpf">CPF</option>
                  <option value="cnpj">CNPJ</option>
                  <option value="email">Email</option>
                  <option value="phone">Telefone</option>
                  <option value="random">Aleatória</option>
                </select>
              </div>
              <EditField
                label="Chave PIX"
                name="pix_key"
                defaultValue={profile.pix_key ?? ""}
              />
              <EditField
                label="Hotmart URL"
                name="hotmart_url"
                defaultValue={profile.hotmart_url ?? ""}
              />
              <EditField
                label="Código afiliado"
                name="hotmart_affiliate_code"
                defaultValue={profile.hotmart_affiliate_code ?? ""}
              />
              <EditField
                label="Comissão (%) — vazio = padrão 20%"
                name="commission_rate_pct"
                defaultValue={
                  profile.commission_rate != null
                    ? String(Math.round(profile.commission_rate * 100))
                    : ""
                }
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background-secondary"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {isPending ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </section>
        </form>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Dados pessoais</h2>
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background-secondary transition-colors"
              >
                <Pencil size={12} />
                Editar
              </button>
            </div>
            <div className="divide-y divide-border">
              <InfoRow
                icon={User}
                label="Nome"
                value={`${profile.first_name} ${profile.last_name}`}
              />
              <InfoRow icon={Mail} label="Email" value={profile.email} />
              <InfoRow icon={Phone} label="WhatsApp" value={profile.whatsapp} />
              <InfoRow icon={Calendar} label="Nascimento" value={profile.date_of_birth} />
              <InfoRow icon={Globe} label="Fuso horário" value={profile.timezone} />
            </div>
          </section>

          <section className="rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Endereço</h2>
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background-secondary transition-colors"
              >
                <Pencil size={12} />
                Editar
              </button>
            </div>
            <div className="divide-y divide-border">
              <InfoRow icon={MapPin} label="Rua" value={profile.address_street} />
              <InfoRow icon={MapPin} label="Cidade" value={profile.address_city} />
              <InfoRow icon={MapPin} label="CEP" value={profile.address_postal_code} />
              <InfoRow icon={Globe} label="País" value={profile.address_country} />
            </div>
          </section>

          <section className="rounded-xl border border-border p-5">
            <h2 className="mb-4 text-base font-semibold">Instagram</h2>
            {outstand?.is_connected && (
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
                  <AtSign size={18} className="text-white" />
                </div>
                <div>
                  <p className="font-medium">@{outstand.ig_username}</p>
                  <p className="text-xs text-foreground-secondary">
                    Conectado via Outstand (API oficial)
                  </p>
                </div>
                <span className="ml-auto rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                  Conectado
                </span>
              </div>
            )}
            {instagram ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
                    <AtSign size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="font-medium">@{instagram.ig_username}</p>
                    <p className="text-xs text-foreground-secondary">
                      {instagram.followers_count?.toLocaleString("pt-BR") ?? "?"}{" "}
                      seguidores
                    </p>
                  </div>
                  <span className="ml-auto rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                    Conectado
                  </span>
                </div>
                <div className="divide-y divide-border text-sm">
                  <div className="flex justify-between py-2">
                    <span className="text-foreground-secondary">Token expira</span>
                    <span>
                      {new Date(instagram.token_expires_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-foreground-secondary">Último refresh</span>
                    <span>
                      {instagram.token_refreshed_at
                        ? new Date(instagram.token_refreshed_at).toLocaleDateString(
                            "pt-BR",
                          )
                        : "-"}
                    </span>
                  </div>
                </div>
                <div className="pt-2">
                  {confirmDisconnect ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleDisconnect}
                        disabled={isPending}
                        className="rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/90 disabled:opacity-50"
                      >
                        {isPending ? "Desconectando..." : "Confirmar"}
                      </button>
                      <button
                        onClick={() => setConfirmDisconnect(false)}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background-secondary"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDisconnect(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error/10 transition-colors"
                    >
                      <Unplug size={14} />
                      Desconectar Instagram
                    </button>
                  )}
                </div>
              </div>
            ) : !outstand?.is_connected ? (
              <div className="flex items-center gap-3 rounded-lg bg-error/5 px-4 py-3">
                <AtSign size={18} className="text-error" />
                <span className="text-sm text-error">Instagram não conectado</span>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Pagamento</h2>
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background-secondary transition-colors"
              >
                <Pencil size={12} />
                Editar
              </button>
            </div>
            <div className="divide-y divide-border">
              <InfoRow
                icon={Wallet}
                label="Tipo PIX"
                value={profile.pix_key_type?.toUpperCase() ?? null}
              />
              <InfoRow icon={Wallet} label="Chave PIX" value={profile.pix_key} />
              <InfoRow
                icon={DollarSign}
                label="Hotmart URL"
                value={profile.hotmart_url}
              />
              <InfoRow
                icon={DollarSign}
                label="Código afiliado"
                value={profile.hotmart_affiliate_code}
              />
            </div>
          </section>
        </div>
      )}

      {sectors.length > 0 && (
        <section className="rounded-xl border border-border p-5">
          <h2 className="mb-3 text-base font-semibold">Nichos</h2>
          <div className="flex flex-wrap gap-2">
            {sectors.map((s) => (
              <span
                key={s}
                className="rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent"
              >
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {sales.length > 0 && (
        <section className="rounded-xl border border-border p-5">
          <h2 className="mb-4 text-base font-semibold">Histórico de vendas</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background-secondary">
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Data
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Produto
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Valor
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Comissão
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      {new Date(sale.sold_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-2.5">{sale.product_name}</td>
                    <td className="px-4 py-2.5">
                      R$ {sale.sale_amount.toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-success">
                      R$ {sale.commission_amount.toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          sale.status === "confirmed"
                            ? "bg-success/10 text-success"
                            : sale.status === "refunded"
                              ? "bg-error/10 text-error"
                              : "bg-foreground-secondary/10 text-foreground-secondary"
                        }`}
                      >
                        {sale.status === "confirmed"
                          ? "Confirmada"
                          : sale.status === "refunded"
                            ? "Reembolsada"
                            : "Cancelada"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <section className="rounded-xl border border-border p-5">
          <h2 className="mb-4 text-base font-semibold">Posts recentes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background-secondary">
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Data
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Tipo
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Caption
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-secondary">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {posts.slice(0, 10).map((post) => (
                  <tr key={post.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      {new Date(post.scheduled_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-2.5 capitalize">{post.media_type}</td>
                    <td className="px-4 py-2.5 max-w-xs truncate">{post.caption}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          post.status === "published"
                            ? "bg-success/10 text-success"
                            : post.status === "pending"
                              ? "bg-warning/10 text-warning"
                              : "bg-error/10 text-error"
                        }`}
                      >
                        {post.status === "published"
                          ? "Publicado"
                          : post.status === "pending"
                            ? "Pendente"
                            : "Falhou"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-warning/30 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/10">
            <Ban size={16} className="text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-warning">
              {isSuspended ? "Reativar conta" : "Suspender conta"}
            </h2>
            <p className="text-xs text-foreground-secondary">
              {isSuspended
                ? "A conta volta a acessar a plataforma e a receber agendamentos"
                : "Bloqueia o acesso e os agendamentos sem apagar nada — dá para reativar depois"}
            </p>
          </div>
          {confirmSuspend ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleToggleSuspend}
                disabled={isPending}
                className="rounded-lg bg-warning px-4 py-2 text-sm font-medium text-white hover:bg-warning/90 disabled:opacity-50"
              >
                {isPending
                  ? "Salvando..."
                  : isSuspended
                    ? "Confirmar reativação"
                    : "Confirmar suspensão"}
              </button>
              <button
                onClick={() => setConfirmSuspend(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-background-secondary"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmSuspend(true)}
              className="shrink-0 rounded-lg border border-warning px-3 py-1.5 text-sm font-medium text-warning hover:bg-warning/10"
            >
              {isSuspended ? "Reativar" : "Suspender"}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-error/20 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error/10">
            <Trash2 size={16} className="text-error" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-error">Excluir conta</h2>
            <p className="text-xs text-foreground-secondary">
              Remove o perfil, dados, posts e conexão Instagram permanentemente
            </p>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 disabled:opacity-50"
              >
                {isPending ? "Excluindo..." : "Confirmar exclusão"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-background-secondary"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="shrink-0 rounded-lg border border-error px-3 py-1.5 text-sm font-medium text-error hover:bg-error/10"
            >
              Excluir
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
