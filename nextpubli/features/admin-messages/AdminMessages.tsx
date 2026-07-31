"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Search,
  Wifi,
  WifiOff,
  Plus,
  User,
  Paperclip,
  X,
  Bot,
  Check,
  RefreshCw,
  Trash2,
  Pencil,
  FileText,
  Download,
  Smartphone,
  Loader2,
  Settings,
} from "lucide-react";
import type { Conversation, InboxMessage, Channel } from "@/types/database";

interface AdminMessagesProps {
  conversations: Conversation[];
  channels: Channel[];
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function displayName(convo: Conversation): string {
  if (convo.is_group && convo.group_name) return convo.group_name;
  if (convo.profile) {
    const p = convo.profile;
    const name = `${p.first_name} ${p.last_name}`.trim();
    if (name) return name;
    return p.email || convo.subject || "Sem nome";
  }
  return convo.subject || "Sem nome";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return (
      "Ontem " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    );
  }
  return (
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

function ConnectWhatsAppModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(false);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/unipile/connect", { method: "POST" });
        const data = await res.json();
        if (data.url) setUrl(data.url);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Once the wizard tab is open, poll until a WhatsApp channel turns up
  // connected (the QR page lives in another tab — auth pages don't iframe).
  useEffect(() => {
    if (!opened || connected) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/unipile/status");
        const data = await res.json();
        if (data.connected) {
          setConnected(true);
          clearInterval(interval);
          setTimeout(() => {
            onConnected();
            onClose();
          }, 1500);
        }
      } catch {
        // keep polling
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [opened, connected, onClose, onConnected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="mb-4 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-[#E1306C]" />
          <h2 className="text-lg font-semibold">Conectar WhatsApp</h2>
        </div>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#E1306C]" />
          </div>
        ) : connected ? (
          <div className="py-10 text-center">
            <p className="text-lg font-semibold text-success">WhatsApp conectado! ✅</p>
          </div>
        ) : url ? (
          <div className="space-y-4 py-2">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground-secondary">
              <li>Clique no botão abaixo — o QR code abre em uma nova aba.</li>
              <li>
                No celular, abra o WhatsApp → Configurações → Dispositivos conectados →
                Conectar dispositivo.
              </li>
              <li>Escaneie o QR code. Depois volte para esta aba.</li>
            </ol>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
              className="block w-full rounded-lg bg-accent px-6 py-3 text-center text-sm font-medium text-white hover:bg-accent/90"
            >
              Abrir QR code em nova aba
            </a>
            {opened && (
              <p className="flex items-center justify-center gap-2 text-sm text-foreground-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Aguardando o scan... esta janela atualiza sozinha.
              </p>
            )}
          </div>
        ) : (
          <p className="py-12 text-center text-gray-500">Erro ao gerar link de conexão</p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onApprove,
  onRewrite,
  onDiscard,
}: {
  msg: InboxMessage;
  onApprove: (id: string) => void;
  onRewrite: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const isOutbound = msg.direction === "outbound";
  const isDraft = msg.status === "draft";
  const isAi = msg.sender === "ai";
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState(msg.body || "");
  const [saving, setSaving] = useState(false);
  const reactions =
    (msg.metadata?.reactions as Array<{ emoji: string; sender: string }>) || [];

  async function handleEditSave() {
    setSaving(true);
    try {
      await fetch("/api/inbox/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: msg.id, body: editBody }),
      });
      onApprove(msg.id);
    } finally {
      setSaving(false);
      setEditMode(false);
    }
  }

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} mb-2`}>
      <div className="max-w-[75%]">
        {/* Sender label */}
        {msg.sender_name && !isOutbound && (
          <p className="mb-0.5 text-xs font-medium text-[#6B7280]">{msg.sender_name}</p>
        )}
        {isAi && (
          <p className="mb-0.5 flex items-center gap-1 text-xs font-medium text-purple-600">
            <Bot className="h-3 w-3" /> IA
          </p>
        )}

        <div
          className={`rounded-2xl px-4 py-2 ${
            isDraft
              ? "border-2 border-amber-300 bg-amber-50"
              : isOutbound
                ? "bg-[#E1306C] text-white"
                : "bg-[#F9FAFB] text-[#1A1A1A]"
          }`}
        >
          {/* Media content */}
          {msg.content_type === "image" && msg.media_url && (
            <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
              <img
                src={msg.media_url}
                alt="Imagem"
                className="mb-2 max-h-[300px] rounded-lg object-contain"
              />
            </a>
          )}

          {msg.content_type === "audio" && msg.media_url && (
            <audio controls className="mb-2 w-full max-w-[280px]">
              <source src={msg.media_url} />
            </audio>
          )}

          {msg.content_type === "video" && msg.media_url && (
            <video controls className="mb-2 max-h-[300px] rounded-lg">
              <source src={msg.media_url} />
            </video>
          )}

          {msg.content_type === "file" && msg.media_url && (
            <a
              href={msg.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                isOutbound
                  ? "border-white/30 text-white hover:bg-white/10"
                  : "border-[#E5E7EB] text-[#1A1A1A] hover:bg-gray-100"
              }`}
            >
              <FileText className="h-4 w-4" />
              <span>Arquivo</span>
              <Download className="h-4 w-4 ml-auto" />
            </a>
          )}

          {/* Text body */}
          {editMode ? (
            <div className="space-y-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="w-full rounded border px-2 py-1 text-sm text-[#1A1A1A]"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={saving}
                  className="rounded bg-green-500 px-3 py-1 text-xs text-white"
                >
                  {saving ? "..." : "Enviar"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  className="rounded bg-gray-200 px-3 py-1 text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            msg.body && <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
          )}

          {/* Timestamp */}
          <p
            className={`mt-1 text-right text-[10px] ${
              isDraft ? "text-amber-600" : isOutbound ? "text-white/70" : "text-[#6B7280]"
            }`}
          >
            {formatDate(msg.created_at)}
          </p>
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className="mt-0.5 flex gap-0.5">
            {reactions.map((r, i) => (
              <span
                key={i}
                className="rounded-full bg-white px-1.5 py-0.5 text-sm shadow-sm border border-gray-200"
              >
                {r.emoji}
              </span>
            ))}
          </div>
        )}

        {/* Draft actions */}
        {isDraft && !editMode && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-medium text-amber-600">Rascunho IA</span>
            <button
              type="button"
              onClick={() => onApprove(msg.id)}
              className="flex items-center gap-1 rounded bg-green-500 px-2 py-1 text-xs text-white hover:bg-green-600"
            >
              <Check className="h-3 w-3" /> Aprovar
            </button>
            <button
              type="button"
              onClick={() => onRewrite(msg.id)}
              className="flex items-center gap-1 rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
            >
              <RefreshCw className="h-3 w-3" /> Reescrever
            </button>
            <button
              type="button"
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1 rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300"
            >
              <Pencil className="h-3 w-3" /> Editar
            </button>
            <button
              type="button"
              onClick={() => onDiscard(msg.id)}
              className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs text-red-600 hover:bg-red-200"
            >
              <Trash2 className="h-3 w-3" /> Descartar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadView({
  conversation,
  messages,
  onBack,
  onMessageSent,
}: {
  conversation: Conversation;
  messages: InboxMessage[];
  onBack: () => void;
  onMessageSent: () => void;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [localAi, setLocalAi] = useState(conversation.ai_handling);
  const [togglingAi, setTogglingAi] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if ((!reply.trim() && !attachment) || sending) return;
    setSending(true);
    try {
      if (attachment) {
        const form = new FormData();
        form.append("conversationId", conversation.id);
        form.append("body", reply || attachment.name);
        form.append("attachment", attachment);
        await fetch("/api/inbox/send", { method: "POST", body: form });
      } else {
        await fetch("/api/inbox/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversation.id, body: reply }),
        });
      }
      setReply("");
      setAttachment(null);
      onMessageSent();
    } finally {
      setSending(false);
    }
  }

  async function handleApprove(messageId: string) {
    await fetch("/api/inbox/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    onMessageSent();
  }

  async function handleRewrite(messageId: string) {
    await fetch("/api/inbox/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    onMessageSent();
  }

  async function handleDiscard(messageId: string) {
    await fetch("/api/inbox/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    onMessageSent();
  }

  async function handleToggleAi() {
    setTogglingAi(true);
    const newVal = !localAi;
    try {
      await fetch("/api/inbox/ai-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          enabled: newVal,
        }),
      });
      setLocalAi(newVal);
    } finally {
      setTogglingAi(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#E5E7EB] px-4 py-3">
        <button type="button" onClick={onBack} className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F9FAFB]">
          {conversation.is_group ? (
            <MessageSquare className="h-5 w-5 text-[#6B7280]" />
          ) : (
            <User className="h-5 w-5 text-[#6B7280]" />
          )}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-[#1A1A1A]">{displayName(conversation)}</p>
          {conversation.is_group && <p className="text-xs text-[#6B7280]">Grupo</p>}
        </div>
        <button
          type="button"
          onClick={handleToggleAi}
          disabled={togglingAi}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            localAi ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"
          }`}
          title={localAi ? "IA ativada" : "IA desativada"}
        >
          <Bot className="h-3.5 w-3.5" />
          {localAi ? "IA ON" : "IA OFF"}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#6B7280]">
            Nenhuma mensagem ainda
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onApprove={handleApprove}
              onRewrite={handleRewrite}
              onDiscard={handleDiscard}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment preview */}
      {attachment && (
        <div className="flex items-center gap-2 border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2">
          {attachment.type.startsWith("image/") ? (
            <img
              src={URL.createObjectURL(attachment)}
              alt="Preview"
              className="h-12 w-12 rounded-lg object-cover"
            />
          ) : (
            <FileText className="h-6 w-6 text-[#6B7280]" />
          )}
          <span className="flex-1 truncate text-sm text-[#6B7280]">
            {attachment.name}
          </span>
          <button type="button" onClick={() => setAttachment(null)}>
            <X className="h-4 w-4 text-[#6B7280]" />
          </button>
        </div>
      )}

      {/* Reply bar */}
      <div className="flex items-center gap-2 border-t border-[#E5E7EB] px-4 py-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full p-2 text-[#6B7280] hover:bg-[#F9FAFB]"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => setAttachment(e.target.files?.[0] || null)}
        />
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Digite uma mensagem..."
          className="flex-1 rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2 text-sm focus:border-[#E1306C] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || (!reply.trim() && !attachment)}
          className="rounded-full bg-[#E1306C] p-2.5 text-white hover:bg-[#C13584] disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function AdminMessages({ conversations: initial, channels }: AdminMessagesProps) {
  const [conversations, setConversations] = useState(initial);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [search, setSearch] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const connected = channels.find(
    (c) => c.type === "whatsapp" && c.status === "connected",
  );

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = displayName(c).toLowerCase();
    const preview = (c.last_message_preview || "").toLowerCase();
    return name.includes(q) || preview.includes(q);
  });

  const loadMessages = useCallback(async (convoId: string) => {
    const res = await fetch(`/api/inbox/messages?conversationId=${convoId}`);
    const data = await res.json();
    setMessages(data.messages || []);
  }, []);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/inbox/conversations");
    const data = await res.json();
    if (data.conversations) setConversations(data.conversations);
  }, []);

  function selectConversation(convo: Conversation) {
    setSelected(convo);
    loadMessages(convo.id);
    fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: convo.id }),
    });
  }

  function handleMessageSent() {
    if (selected) {
      loadMessages(selected.id);
      refreshConversations();
    }
  }

  // Poll for new messages
  useEffect(() => {
    pollRef.current = setInterval(() => {
      refreshConversations();
      if (selected) loadMessages(selected.id);
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [selected, loadMessages, refreshConversations]);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      {/* Sidebar */}
      <div
        className={`w-full border-r border-[#E5E7EB] md:w-80 lg:w-96 ${
          selected ? "hidden md:block" : ""
        }`}
      >
        {/* Sidebar header */}
        <div className="border-b border-[#E5E7EB] px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#1A1A1A]">Mensagens</h2>
            <div className="flex items-center gap-2">
              {connected ? (
                <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs text-green-600">
                  <Wifi className="h-3 w-3" /> Conectado
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConnect(true)}
                  className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs text-red-500 hover:bg-red-100"
                >
                  <WifiOff className="h-3 w-3" /> Conectar
                </button>
              )}
              <a
                href="/admin/ai-settings"
                className="rounded-full p-1.5 text-[#6B7280] hover:bg-gray-100"
                title="Configurações de IA"
              >
                <Settings className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="rounded-full p-1.5 text-[#6B7280] hover:bg-gray-100"
                title="Adicionar WhatsApp"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-2 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#6B7280]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversas..."
              className="w-full rounded-full bg-[#F9FAFB] py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-[#E1306C]"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="overflow-y-auto" style={{ height: "calc(100% - 110px)" }}>
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#6B7280]">
              <MessageSquare className="mb-3 h-10 w-10" />
              <p className="text-sm">Nenhuma conversa</p>
            </div>
          ) : (
            filteredConversations.map((convo) => (
              <button
                key={convo.id}
                type="button"
                onClick={() => selectConversation(convo)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#F9FAFB] transition-colors ${
                  selected?.id === convo.id ? "bg-[#F9FAFB]" : ""
                }`}
              >
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F56040] to-[#C13584]">
                  {convo.is_group ? (
                    <MessageSquare className="h-5 w-5 text-white" />
                  ) : (
                    <User className="h-5 w-5 text-white" />
                  )}
                  {convo.ai_handling && (
                    <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-purple-500 p-0.5">
                      <Bot className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-semibold text-[#1A1A1A]">
                      {displayName(convo)}
                    </p>
                    <span className="ml-2 shrink-0 text-xs text-[#6B7280]">
                      {timeAgo(convo.last_message_at)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[#6B7280]">
                    {convo.last_message_preview || "—"}
                  </p>
                </div>
                {convo.unread_count > 0 && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E1306C] text-[10px] font-bold text-white">
                    {convo.unread_count}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread panel */}
      <div className={`flex-1 ${!selected ? "hidden md:flex" : "flex"} flex-col`}>
        {selected ? (
          <ThreadView
            conversation={selected}
            messages={messages}
            onBack={() => setSelected(null)}
            onMessageSent={handleMessageSent}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[#6B7280]">
            <MessageSquare className="mb-4 h-16 w-16" />
            <p className="text-lg font-medium">Selecione uma conversa</p>
            <p className="text-sm">Escolha uma conversa na lista para visualizar</p>
          </div>
        )}
      </div>

      {/* Connect modal */}
      {showConnect && (
        <ConnectWhatsAppModal
          onClose={() => setShowConnect(false)}
          onConnected={() => window.location.reload()}
        />
      )}
    </div>
  );
}
