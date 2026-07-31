"use client";

import { useState } from "react";
import { Bot, Eye, EyeOff, Save, Zap } from "lucide-react";
import type { AiSettings, Channel } from "@/types/database";

interface AdminAiSettingsProps {
  settings: AiSettings | null;
  channel: Channel | null;
}

export function AdminAiSettings({ settings, channel }: AdminAiSettingsProps) {
  const [apiKey, setApiKey] = useState(settings?.openai_api_key || "");
  const [showKey, setShowKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(settings?.system_prompt || "");
  const [model, setModel] = useState(settings?.model || "gpt-4o-mini");
  const [maxTokens, setMaxTokens] = useState(settings?.max_tokens || 500);
  const [autoReply, setAutoReply] = useState(channel?.auto_reply_enabled ?? false);
  const [draftMode, setDraftMode] = useState(channel?.draft_mode ?? true);
  const [delay, setDelay] = useState(channel?.auto_reply_delay_seconds ?? 120);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/inbox/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openai_api_key: apiKey,
          system_prompt: systemPrompt,
          model,
          max_tokens: maxTokens,
          auto_reply_enabled: autoReply,
          draft_mode: draftMode,
          auto_reply_delay_seconds: delay,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/inbox/ai-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model }),
      });
      const data = await res.json();
      setTestResult(
        res.ok ? `Funcionando! Resposta: "${data.reply}"` : `Erro: ${data.error}`,
      );
    } catch {
      setTestResult("Erro ao testar conexão");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div className="flex items-center gap-3">
        <Bot className="h-7 w-7 text-[#E1306C]" />
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Configurações de IA</h1>
      </div>

      {/* OpenAI API Key */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[#1A1A1A]">Chave da API OpenAI</h2>
        <div className="flex items-center gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="flex-1 rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm focus:border-[#E1306C] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="rounded-lg border border-[#E5E7EB] p-2 hover:bg-gray-50"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            <Zap className="h-4 w-4" />
            {testing ? "Testando..." : "Testar"}
          </button>
        </div>
        {testResult && (
          <p
            className={`text-sm ${testResult.startsWith("Erro") ? "text-red-500" : "text-green-600"}`}
          >
            {testResult}
          </p>
        )}
      </section>

      {/* System Prompt */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[#1A1A1A]">Prompt do Sistema</h2>
        <p className="text-sm text-[#6B7280]">
          Instruções personalizadas para a IA. Descreva como ela deve se comportar ao
          responder mensagens.
        </p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="Ex: Você é a recepcionista virtual da NextPubli. Seja simpática, responda em português..."
          className="w-full rounded-lg border border-[#E5E7EB] px-4 py-3 text-sm focus:border-[#E1306C] focus:outline-none resize-none"
        />
      </section>

      {/* Model & Tokens */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[#1A1A1A]">Modelo</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm text-[#6B7280]">Modelo OpenAI</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#E1306C] focus:outline-none"
            >
              <option value="gpt-4o-mini">GPT-4o Mini (rápido)</option>
              <option value="gpt-4o">GPT-4o (avançado)</option>
              <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
              <option value="gpt-4.1">GPT-4.1</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-[#6B7280]">Max Tokens</label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              min={100}
              max={2000}
              className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#E1306C] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Auto-Reply Settings */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[#1A1A1A]">Resposta Automática</h2>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoReply}
            onChange={(e) => setAutoReply(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-[#E1306C] focus:ring-[#E1306C]"
          />
          <div>
            <span className="text-sm font-medium text-[#1A1A1A]">
              Ativar resposta automática via IA
            </span>
            <p className="text-xs text-[#6B7280]">
              A IA responderá automaticamente quando não houver resposta do admin dentro
              do prazo
            </p>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={draftMode}
            onChange={(e) => setDraftMode(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-[#E1306C] focus:ring-[#E1306C]"
          />
          <div>
            <span className="text-sm font-medium text-[#1A1A1A]">Modo rascunho</span>
            <p className="text-xs text-[#6B7280]">
              Quando ativado, as respostas da IA ficam como rascunho para aprovação antes
              de enviar. Desativado = envio automático.
            </p>
          </div>
        </label>

        <div>
          <label className="mb-1 block text-sm text-[#6B7280]">
            Tempo de espera antes da IA responder (segundos)
          </label>
          <input
            type="number"
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            min={30}
            max={3600}
            className="w-32 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#E1306C] focus:outline-none"
          />
          <p className="mt-1 text-xs text-[#6B7280]">
            A IA espera esse tempo para dar chance ao admin de responder primeiro.
          </p>
        </div>
      </section>

      {/* Save */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E1306C] px-6 py-3 text-sm font-semibold text-white hover:bg-[#C13584] disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar Configurações"}
      </button>
    </div>
  );
}
