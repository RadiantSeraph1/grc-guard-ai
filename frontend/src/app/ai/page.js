"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus, Send, Trash2, Loader2, Brain, Wrench, ChevronDown, ChevronRight,
  Network, RefreshCw, MessageSquare, Sparkles, ArrowUpRight, Cpu, Check, AlertTriangle
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

// Human labels + suggested model ids per provider. The model field is a free
// text input backed by these suggestions, so any model id still works.
const PROVIDER_META = {
  claude: { label: "Anthropic Claude", models: ["claude-sonnet-4-5", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-opus-4-1"] },
  openai: { label: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"] },
  gemini: { label: "Google Gemini", models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"] },
  groq: { label: "Groq", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"] },
  openrouter: { label: "OpenRouter", models: ["google/gemini-2.5-flash", "anthropic/claude-3.5-sonnet"] },
  mistral: { label: "Mistral", models: ["mistral-large-latest", "mistral-small-latest"] },
  deepseek: { label: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
  perplexity: { label: "Perplexity", models: ["sonar-pro", "sonar"] },
  xai: { label: "xAI Grok", models: ["grok-3-mini", "grok-2-latest"] },
  azure_openai: { label: "Azure OpenAI", models: ["gpt-4o"] },
  ollama: { label: "Ollama (local)", models: ["llama3.1", "qwen2.5"] },
  local: { label: "Local server", models: ["local-model"] },
  vast_ai: { label: "Vast.ai", models: ["custom-vllm"] },
  custom: { label: "Custom endpoint", models: [] },
  local_evidence: { label: "Local Evidence (offline)", models: [] },
};
const providerLabel = (id) => PROVIDER_META[id]?.label || (id || "").replace(/_/g, " ");
const NO_KEY_NEEDED = ["local_evidence", "ollama", "local"];

const AGENTS = [
  { id: "compliance_agent", name: "Compliance Agent", emoji: "📋", blurb: "Audits policy drafts against framework controls (Basel, GDPR, SOC 2, ISO 27001, PCI-DSS).", greeting: "Compliance Agent ready. Paste a policy draft or ask how a requirement maps to your controls." },
  { id: "tprm_agent", name: "TPRM Vendor Agent", emoji: "🤝", blurb: "Evaluates third-party vendor security questionnaires and risk tiers.", greeting: "TPRM Agent ready. Share a vendor's questionnaire answers and I'll assess inherent risk and a recommended status." },
  { id: "trust_agent", name: "Customer Trust Agent", emoji: "🛡️", blurb: "Answers customer security questions grounded in your real controls.", greeting: "Customer Trust Agent ready. Ask a customer-style security question and I'll answer from your actual posture." },
  { id: "risk_agent", name: "Risk Propagation Agent", emoji: "🕸️", blurb: "Traces how failing controls cascade risk across the GRC graph.", greeting: "Risk Propagation Agent ready. Name a control, asset, or integration and I'll trace its risk path." },
];

const agentById = (id) => AGENTS.find((a) => a.id === id) || AGENTS[0];
const STORAGE_PREFIX = "grc_ai_chats:";

function newSession(agentId = "compliance_agent", createdAt = 0) {
  const id = `chat_${createdAt || ""}_${Math.round((createdAt || 1) * 1000) % 100000}`;
  return {
    id,
    title: "New chat",
    agent: agentId,
    createdAt,
    messages: [{ role: "assistant", text: agentById(agentId).greeting }],
  };
}

export default function AiPage() {
  const { getToken } = useAuth();
  const { user } = useUser();

  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [querying, setQuerying] = useState(false);
  const [view, setView] = useState("chat"); // "chat" | "graph"
  const [hydrated, setHydrated] = useState(false);

  const threadRef = useRef(null);
  const storageKey = STORAGE_PREFIX + (user?.id || "anon");

  // ---- persistence -------------------------------------------------------
  useEffect(() => {
    let loaded = [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) loaded = JSON.parse(raw);
    } catch { loaded = []; }
    if (!Array.isArray(loaded) || loaded.length === 0) {
      loaded = [newSession("compliance_agent", Date.now())];
    }
    setSessions(loaded);
    setActiveId(loaded[0].id);
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(sessions)); } catch {}
  }, [sessions, hydrated, storageKey]);

  const active = sessions.find((s) => s.id === activeId) || null;

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [active?.messages, querying]);

  // ---- actions -----------------------------------------------------------
  const createChat = () => {
    const s = newSession(active?.agent || "compliance_agent", Date.now());
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setView("chat");
  };

  const deleteChat = (id) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = newSession("compliance_agent", Date.now());
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const setAgentForActive = (agentId) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      const onlyGreeting = s.messages.length <= 1;
      return {
        ...s,
        agent: agentId,
        messages: onlyGreeting ? [{ role: "assistant", text: agentById(agentId).greeting }] : s.messages,
      };
    }));
  };

  const patchActive = useCallback((updater) => {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? updater(s) : s)));
  }, [activeId]);

  const send = async (e) => {
    e?.preventDefault?.();
    const prompt = input.trim();
    if (!prompt || querying || !active) return;
    const agentId = active.agent;

    patchActive((s) => ({
      ...s,
      title: s.messages.length <= 1 ? prompt.slice(0, 48) : s.title,
      messages: [...s.messages, { role: "user", text: prompt }],
    }));
    setInput("");
    setQuerying(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/ai/agent-query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, prompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      patchActive((s) => ({
        ...s,
        messages: [...s.messages, { role: "assistant", text: data.response || "(empty response)", steps: data.steps || [] }],
      }));
    } catch (err) {
      patchActive((s) => ({
        ...s,
        messages: [...s.messages, {
          role: "assistant",
          text: "⚠️ The agent runtime is unavailable. Make sure the backend is running (port 8001) and an AI provider (Claude by default) is configured in Settings.",
          steps: [],
        }],
      }));
    } finally {
      setQuerying(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ---- trust graph (secondary view) -------------------------------------
  const [graphNodes, setGraphNodes] = useState([]);
  const fetchGraph = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/ai/trust-graph`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setGraphNodes(Array.isArray(data.nodes) ? data.nodes : []);
    } catch {
      setGraphNodes([]);
    }
  }, [getToken]);
  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // ---- RAG corpus status (semantic vs lexical) --------------------------
  const [corpus, setCorpus] = useState(null);
  const fetchCorpus = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/rag/corpus`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Fetch failed");
      setCorpus(await res.json());
    } catch {
      setCorpus(null);
    }
  }, [getToken]);
  useEffect(() => { fetchCorpus(); }, [fetchCorpus]);

  // ---- AI provider / model selection ------------------------------------
  const [providers, setProviders] = useState([]);
  const [modelMsg, setModelMsg] = useState(null);
  const fetchProviders = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/settings/ai-providers`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setProviders(Array.isArray(data) ? data : []);
    } catch {
      setProviders([]);
    }
  }, [getToken]);
  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const activeProvider = providers.find((p) => p.is_active) || null;

  const selectProvider = async (id) => {
    setModelMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/settings/ai-providers/${id}/activate`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `Could not activate ${providerLabel(id)}`);
      await fetchProviders();
      setModelMsg({ ok: true, text: `${providerLabel(id)} is now the active model provider.` });
    } catch (err) {
      setModelMsg({ ok: false, text: err.message });
    }
  };

  const saveModel = async (id, model) => {
    setModelMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/settings/ai-providers/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model_override: model || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Could not save model");
      await fetchProviders();
      setModelMsg({ ok: true, text: model ? `Model set to ${model}.` : "Model reset to provider default." });
    } catch (err) {
      setModelMsg({ ok: false, text: err.message });
    }
  };

  const nodeColor = (status, type) => {
    if (type === "integration") return status === "Connected" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5" : "border-zinc-800 text-zinc-500 bg-zinc-900/50";
    if (status === "Passing" || status === "Mitigated") return "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
    if (status === "Warning") return "border-amber-500/40 text-amber-400 bg-amber-500/5";
    return "border-rose-500/40 text-rose-400 bg-rose-500/5";
  };
  const nodeIcon = (type) => (type === "integration" ? "🔌" : type === "asset" ? "💾" : type === "control" ? "🛡️" : "⚠️");

  const currentAgent = agentById(active?.agent);

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* ---- Sidebar: history + agents ---- */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-[#0c0c0f] min-h-0">
        <div className="p-3">
          <button
            onClick={createChat}
            className="w-full flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold text-xs rounded-lg py-2.5 cursor-pointer active:scale-[0.98] transition-all"
          >
            <Plus size={14} /> New chat
          </button>
        </div>

        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">History</div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar min-h-0">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => { setActiveId(s.id); setView("chat"); }}
              className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                s.id === activeId ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900/70"
              }`}
            >
              <MessageSquare size={13} className="shrink-0 opacity-70" />
              <span className="flex-1 truncate text-xs">{s.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteChat(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 transition-opacity"
                title="Delete chat"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-800/80 p-3 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1">Agent</div>
          {AGENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAgentForActive(a.id)}
              className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                active?.agent === a.id ? "bg-zinc-800/80 text-zinc-100 border border-zinc-700" : "text-zinc-400 hover:bg-zinc-900/70 border border-transparent"
              }`}
            >
              <span className="text-base">{a.emoji}</span>
              <span className="text-xs font-medium truncate">{a.name}</span>
            </button>
          ))}
          <button
            onClick={() => { setView(view === "graph" ? "chat" : "graph"); fetchGraph(); }}
            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors mt-1 ${
              view === "graph" ? "bg-zinc-800/80 text-zinc-100 border border-zinc-700" : "text-zinc-400 hover:bg-zinc-900/70 border border-transparent"
            }`}
          >
            <Network size={15} /> <span className="text-xs font-medium">Trust Graph</span>
          </button>
        </div>
      </aside>

      {/* ---- Main panel ---- */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/80 bg-[#0c0c0f]/60 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl">{currentAgent.emoji}</span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">{view === "graph" ? "Relational Trust Graph" : currentAgent.name}</h2>
              <p className="text-[11px] text-zinc-500 truncate">{view === "graph" ? "GRC nodes and links from your live data." : currentAgent.blurb}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ModelPicker
              providers={providers}
              activeProvider={activeProvider}
              onSelect={selectProvider}
              onSaveModel={saveModel}
              message={modelMsg}
            />
            {corpus && (
              <span
                title={
                  corpus.search_mode === "semantic"
                    ? `Semantic vector search active — ${corpus.embedded_chunks}/${corpus.total_chunks} chunks embedded`
                    : corpus.embeddings_available
                      ? "Embedding provider configured, but ingested chunks are not vectorized yet. Re-ingest documents."
                      : "Lexical search — set OPENAI_API_KEY or GEMINI_API_KEY to enable semantic search"
                }
                className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
                  corpus.search_mode === "semantic"
                    ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5"
                    : "border-zinc-700 text-zinc-400 bg-zinc-900/50"
                }`}
              >
                <Sparkles size={11} />
                {corpus.search_mode === "semantic" ? "Semantic RAG" : "Lexical RAG"}
                <span className="text-zinc-500">· {corpus.total_chunks} chunks</span>
              </span>
            )}
            <button onClick={createChat} className="md:hidden text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg p-2"><Plus size={15} /></button>
          </div>
        </header>

        {view === "graph" ? (
          <GraphView nodes={graphNodes} onRefresh={fetchGraph} nodeColor={nodeColor} nodeIcon={nodeIcon} />
        ) : (
          <>
            {/* Thread */}
            <div ref={threadRef} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
              <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
                {active?.messages.map((m, i) => (
                  <Message key={i} message={m} agent={currentAgent} />
                ))}
                {querying && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-base shrink-0">{currentAgent.emoji}</div>
                    <div className="flex items-center gap-2 text-zinc-400 text-sm pt-1.5">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="animate-pulse">Thinking — retrieving controls, evidence, and graph context…</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="border-t border-zinc-800/80 bg-[#0c0c0f]/60 backdrop-blur px-4 py-4">
              <form onSubmit={send} className="max-w-3xl mx-auto w-full">
                <div className="flex items-end gap-2 bg-zinc-900/80 border border-zinc-800 focus-within:border-zinc-600 rounded-2xl px-3 py-2 transition-colors">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    placeholder={`Message the ${currentAgent.name}…  (Shift+Enter for newline)`}
                    className="flex-1 bg-transparent resize-none max-h-40 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none py-1.5 custom-scrollbar"
                  />
                  <button
                    type="submit"
                    disabled={querying || !input.trim()}
                    className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 rounded-xl p-2 cursor-pointer active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {querying ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600 text-center mt-2">
                  Agents run on agno. Responses are grounded in your ingested corpus and live GRC graph — verify before acting.
                </p>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ModelPicker({ providers, activeProvider, onSelect, onSaveModel, message }) {
  const [open, setOpen] = useState(false);
  const [draftModel, setDraftModel] = useState("");
  const ref = useRef(null);

  const activeId = activeProvider?.id || "local_evidence";
  const meta = PROVIDER_META[activeId] || { label: activeId, models: [] };
  const currentModel = activeProvider?.model_override || (PROVIDER_META[activeId]?.models?.[0]) || "default";

  useEffect(() => {
    setDraftModel(activeProvider?.model_override || "");
  }, [activeProvider?.id, activeProvider?.model_override]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const usable = (p) => p.has_key || NO_KEY_NEEDED.includes(p.id) || (p.api_key && p.api_key.length > 0);
  const sorted = [...providers].sort((a, b) => providerLabel(a.id).localeCompare(providerLabel(b.id)));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Choose AI provider and model"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600 transition-colors"
      >
        <Cpu size={12} className="text-zinc-400" />
        <span className="hidden sm:inline">{meta.label}</span>
        <span className="text-zinc-500 max-w-[120px] truncate hidden md:inline">· {currentModel}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl shadow-black/50 z-50 p-3 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Provider</label>
            <select
              value={activeId}
              onChange={(e) => onSelect(e.target.value)}
              className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2.5 py-2 focus:outline-none focus:border-zinc-600 cursor-pointer"
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id} disabled={!usable(p)}>
                  {providerLabel(p.id)}{usable(p) ? "" : " (no key)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Model</label>
            <input
              list="model-suggestions"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              placeholder={meta.models?.[0] || "provider default"}
              className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2.5 py-2 focus:outline-none focus:border-zinc-600"
            />
            <datalist id="model-suggestions">
              {(meta.models || []).map((m) => <option key={m} value={m} />)}
            </datalist>
            <div className="flex flex-wrap gap-1 mt-2">
              {(meta.models || []).map((m) => (
                <button
                  key={m}
                  onClick={() => { setDraftModel(m); onSaveModel(activeId, m); }}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    currentModel === m
                      ? "border-zinc-500 text-zinc-100 bg-zinc-800"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onSaveModel(activeId, draftModel.trim())}
            className="w-full flex items-center justify-center gap-1.5 text-xs bg-zinc-100 hover:bg-white text-zinc-950 font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            <Check size={12} /> Apply model
          </button>

          {message && (
            <div className={`flex items-start gap-1.5 text-[10px] ${message.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {message.ok ? <Check size={11} className="mt-0.5 shrink-0" /> : <AlertTriangle size={11} className="mt-0.5 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}
          <p className="text-[9px] text-zinc-600 leading-relaxed">
            Providers without an API key are disabled — add keys in Settings → AI Gateway. Changes apply to your next message.
          </p>
        </div>
      )}
    </div>
  );
}

function Message({ message, agent }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex items-start gap-3 justify-end">
        <div className="bg-zinc-100 text-zinc-900 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[80%] whitespace-pre-wrap break-words">
          {message.text}
        </div>
        <div className="w-8 h-8 rounded-lg bg-zinc-700 text-zinc-100 flex items-center justify-center text-xs font-bold shrink-0">You</div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-base shrink-0">{agent.emoji}</div>
      <div className="min-w-0 flex-1 space-y-2">
        {Array.isArray(message.steps) && message.steps.length > 0 && <ThinkingPanel steps={message.steps} />}
        <div className="bg-[#16161a] border border-zinc-800/80 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-zinc-200 break-words leading-relaxed">
          <MarkdownView text={message.text} />
        </div>
      </div>
    </div>
  );
}

// Renders assistant output as formatted markdown (tables, headings, lists,
// code) with a dark theme — the ChatGPT/Claude-style readable layout.
const MD_COMPONENTS = {
  h1: (p) => <h1 className="text-base font-semibold text-zinc-100 mt-4 mb-2 first:mt-0" {...p} />,
  h2: (p) => <h2 className="text-sm font-semibold text-zinc-100 mt-4 mb-2 first:mt-0" {...p} />,
  h3: (p) => <h3 className="text-[13px] font-semibold text-zinc-100 mt-3 mb-1.5 first:mt-0" {...p} />,
  p: (p) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 ml-1 space-y-1 list-disc list-inside marker:text-zinc-500" {...p} />,
  ol: (p) => <ol className="my-2 ml-1 space-y-1 list-decimal list-inside marker:text-zinc-500" {...p} />,
  li: (p) => <li className="leading-relaxed pl-1" {...p} />,
  strong: (p) => <strong className="font-semibold text-zinc-100" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  a: (p) => <a className="text-sky-400 underline underline-offset-2 hover:text-sky-300" target="_blank" rel="noreferrer" {...p} />,
  blockquote: (p) => <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic" {...p} />,
  hr: () => <hr className="my-3 border-zinc-800" />,
  code: ({ inline, className, children, ...rest }) =>
    inline ? (
      <code className="bg-[#0c0c0f] border border-zinc-800 rounded px-1.5 py-0.5 text-[12px] font-mono text-zinc-200" {...rest}>{children}</code>
    ) : (
      <code className="block bg-[#0c0c0f] border border-zinc-800 rounded-lg p-3 my-2 text-[12px] font-mono text-zinc-200 overflow-x-auto custom-scrollbar" {...rest}>{children}</code>
    ),
  pre: (p) => <pre className="my-2" {...p} />,
  table: (p) => (
    <div className="my-3 overflow-x-auto custom-scrollbar rounded-lg border border-zinc-800">
      <table className="w-full text-xs border-collapse" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-zinc-900/60" {...p} />,
  th: (p) => <th className="text-left font-semibold text-zinc-200 px-3 py-2 border-b border-zinc-800" {...p} />,
  td: (p) => <td className="px-3 py-2 border-b border-zinc-800/60 text-zinc-300 align-top" {...p} />,
  tr: (p) => <tr className="even:bg-zinc-900/20" {...p} />,
};

function MarkdownView({ text }) {
  return (
    <div className="text-sm text-zinc-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text || ""}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingPanel({ steps }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-900/60 transition-colors"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Brain size={13} className="text-violet-400" />
        Thought process
        <span className="text-zinc-600 font-normal">· {steps.length} step{steps.length === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-zinc-800/60">
          {steps.map((s, i) => (
            <div key={i} className="text-xs">
              <div className="flex items-center gap-1.5 text-zinc-300 font-semibold">
                {s.type === "tool" ? <Wrench size={12} className="text-sky-400" /> : <Brain size={12} className="text-violet-400" />}
                {s.title}
              </div>
              {s.args && Object.keys(s.args).length > 0 && (
                <pre className="mt-1 text-[10px] text-zinc-500 bg-[#0c0c0f] border border-zinc-800/60 rounded-md p-2 overflow-x-auto custom-scrollbar">
                  {JSON.stringify(s.args, null, 2)}
                </pre>
              )}
              {s.detail && (
                <div className="mt-1 text-[11px] text-zinc-400 bg-[#0c0c0f] border border-zinc-800/60 rounded-md p-2 whitespace-pre-wrap break-words max-h-44 overflow-y-auto custom-scrollbar">
                  {s.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GraphView({ nodes, onRefresh, nodeColor, nodeIcon }) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 p-6">
      <div className="max-w-5xl mx-auto w-full space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">Live GRC nodes generated from your integrations, assets, controls, and risks.</p>
          <button onClick={onRefresh} className="text-zinc-400 hover:text-zinc-100 p-1.5 bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 rounded-lg cursor-pointer transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
        {nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-24 text-zinc-500 gap-3">
            <Network size={28} className="opacity-50" />
            <p className="text-sm">The trust graph is empty.</p>
            <p className="text-xs max-w-sm">Connect integrations and add controls, assets, and risks to populate the relational map.</p>
            <a href="/integrations" className="text-zinc-300 hover:text-zinc-100 text-xs font-semibold flex items-center gap-1 mt-1">Go to Integrations <ArrowUpRight size={12} /></a>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {nodes.map((node) => (
              <div key={node.id} className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-3 ${nodeColor(node.status, node.type)}`}>
                <div className="flex items-start justify-between">
                  <span className="text-base">{nodeIcon(node.type)}</span>
                  <span className="text-[8px] font-extrabold uppercase tracking-widest text-zinc-500">{node.type}</span>
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-zinc-200 line-clamp-1 leading-tight">{node.label}</h4>
                  <span className="text-[9px] text-zinc-500 font-mono tracking-wider truncate block mt-0.5">ID: {node.id}</span>
                </div>
                <div className="flex justify-between items-center text-[9px] font-bold border-t border-zinc-800/30 pt-2 text-zinc-500 uppercase tracking-wide">
                  <span>State</span>
                  <span className="text-zinc-200 font-extrabold">{node.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
