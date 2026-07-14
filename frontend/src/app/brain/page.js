"use client";

import { useState, useRef, useEffect } from "react";
import { Brain, Send, ShieldAlert, Sparkles, CheckCircle, XCircle, AlertTriangle, Fingerprint, GitMerge, FlipHorizontal, ThumbsUp, ThumbsDown, FlaskConical, Plus, Trash2, MessageSquare } from "lucide-react";
import { useApi } from "../lib/api";
import { PageContainer, PageHeader, Card, Button, cn } from "../components/ui";

// Decisions come back as either a clean enum (COMPLIANT / NON_COMPLIANT /
// ASSESSMENT_REQUIRES_MORE_INFORMATION) or free-form text ("Unable to
// assess..."). A decision that isn't clearly compliant or a violation is
// inconclusive, not a pass — treat it as its own neutral state.
function classifyDecision(decision) {
  const d = (decision || "").toUpperCase();
  if (/(NON.?COMPLIANT|VIOLATION|BREACH|\bFAIL)/.test(d)) return "violation";
  if (/^COMPLIANT\b/.test(d)) return "compliant";
  return "neutral";
}

// Enum-like tokens ("ASSESSMENT_REQUIRES_MORE_INFORMATION") have no spaces,
// so they don't wrap and overflow the card — convert to Title Case. Natural
// sentences ("Unable to assess...") are left untouched.
function humanizeDecision(decision) {
  if (!decision) return "Unknown";
  if (!/^[A-Z0-9_]+$/.test(decision)) return decision;
  return decision.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

const DECISION_STATUS_STYLES = {
  compliant: { card: "bg-emerald-950/20 border-emerald-900/50", text: "text-emerald-400", Icon: CheckCircle, icon: "text-emerald-500" },
  violation: { card: "bg-rose-950/20 border-rose-900/50", text: "text-rose-400", Icon: XCircle, icon: "text-rose-500" },
  neutral: { card: "bg-amber-950/20 border-amber-900/50", text: "text-amber-400", Icon: AlertTriangle, icon: "text-amber-500" },
};

function XAIDashboard({ data, sourceQuery, feedbackState, onFeedback, limeState, onLimeExplain }) {
  if (!data) return null;

  // The backend might return string if it caught an error, or structured JSON for XAI
  if (typeof data === 'string' || data.error) {
    return (
      <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <p className="text-zinc-300">{data.error || data}</p>
      </div>
    );
  }

  const { decision, confidence_score, feature_attributions, jurisdictional_conflicts, counterfactual } = data;

  const status = DECISION_STATUS_STYLES[classifyDecision(decision)];
  const hasConflicts = jurisdictional_conflicts && jurisdictional_conflicts.length > 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Top Banner: Decision & Confidence */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Decision Card */}
        <div className={`p-6 rounded-xl border ${status.card} relative overflow-hidden`}>
          <div className="flex items-center space-x-3 mb-2">
            <status.Icon className={`${status.icon} h-6 w-6 shrink-0`} />
            <h3 className="font-semibold text-lg text-zinc-100">AI Decision</h3>
          </div>
          <p className={`text-xl font-bold leading-snug break-words ${status.text}`}>
            {humanizeDecision(decision)}
          </p>
          <div className="absolute -right-4 -bottom-4 opacity-10">
            <ShieldAlert className="h-32 w-32" />
          </div>
        </div>

        {/* Confidence Gauge */}
        <div className="p-6 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-col justify-center">
          <div className="flex justify-between items-end mb-2">
            <h3 className="font-semibold text-zinc-300 flex items-center">
              <Sparkles className="h-4 w-4 mr-2 text-indigo-400" />
              Model Confidence (self-reported)
            </h3>
            <span className="text-2xl font-bold text-zinc-100">{confidence_score ?? 0}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all duration-1000 ease-out bg-gradient-to-r from-indigo-500 to-purple-500"
              style={{ width: `${confidence_score || 0}%` }}
            ></div>
          </div>
          <p className="text-xs text-zinc-600 mt-2">The LLM&apos;s own stated confidence — not mathematically verified. Use &ldquo;Verify with real LIME&rdquo; below for a perturbation-based check.</p>
        </div>
      </div>

      {/* Jurisdictional Conflicts Panel */}
      {hasConflicts && (
        <div className="p-5 rounded-xl bg-amber-950/20 border border-amber-800/50">
          <div className="flex items-center space-x-2 mb-3">
            <GitMerge className="h-5 w-5 text-amber-400" />
            <h3 className="font-semibold text-amber-300">Cross-Jurisdictional Conflicts Detected</h3>
            <span className="text-xs px-2 py-0.5 bg-amber-900/40 text-amber-400 rounded-full border border-amber-800/40">
              {jurisdictional_conflicts.length} conflict{jurisdictional_conflicts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {jurisdictional_conflicts.map((conflict, idx) => (
              <div key={idx} className="flex items-start space-x-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-amber-200/80 leading-relaxed">{conflict}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-700 mt-3">Reconciliation required before regulatory submission. Consult your compliance officer.</p>
        </div>
      )}

      {/* Feature Attributions — the LLM's own self-described reasoning, NOT
          mathematically-derived LIME/SHAP. Real perturbation LIME is opt-in below. */}
      <Card className="bg-zinc-900/40 border-zinc-800/80">
        <div className="p-5 border-b border-zinc-800 flex items-center space-x-2">
          <Fingerprint className="h-5 w-5 text-zinc-400" />
          <h3 className="font-medium text-zinc-200">Model-Reported Feature Attribution</h3>
          <span className="text-xs text-zinc-600 ml-1">(self-described by the LLM, not mathematically derived)</span>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {feature_attributions && feature_attributions.length > 0 ? (
            feature_attributions.map((attr, idx) => (
              <div key={idx} className="p-5 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 pr-4 flex-1">
                    <div className="flex items-center space-x-2">
                      <p className="font-medium text-zinc-200 font-mono text-sm">{attr.feature}</p>
                      {attr.weight !== undefined && (
                        <span className="text-xs text-zinc-500">Δ{typeof attr.weight === 'number' ? attr.weight.toFixed(3) : attr.weight}</span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 leading-relaxed">{attr.explanation}</p>
                  </div>
                  <div className={`px-2.5 py-1 text-xs font-medium rounded-md shrink-0 border
                    ${attr.importance.toUpperCase() === 'HIGH' ? 'bg-rose-950/40 text-rose-400 border-rose-900/30' : 
                      attr.importance.toUpperCase() === 'MEDIUM' ? 'bg-amber-950/40 text-amber-400 border-amber-900/30' : 
                      'bg-emerald-950/40 text-emerald-400 border-emerald-900/30'}`}
                  >
                    {attr.importance.toUpperCase()} IMPACT
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-zinc-500">
              No attributions generated for this decision.
            </div>
          )}
        </div>
      </Card>

      {/* Counterfactual Explanation (EU AI Act Art. 86) */}
      {counterfactual && (
        <div className="p-5 rounded-xl bg-zinc-900/30 border border-zinc-800/60">
          <div className="flex items-center space-x-2 mb-3">
            <FlipHorizontal className="h-5 w-5 text-indigo-400" />
            <h3 className="font-semibold text-zinc-300">Counterfactual Explanation</h3>
            <span className="text-xs px-2 py-0.5 bg-indigo-900/30 text-indigo-400 rounded-full border border-indigo-800/30">EU AI Act Art. 86</span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">{counterfactual}</p>
        </div>
      )}

      {/* Auditor feedback — data collection for future DPO/RLHF fine-tuning */}
      {onFeedback && (
        <div className="flex items-center justify-between gap-3 bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-3">
          <span className="text-xs text-zinc-500">Was this response correct?</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!!feedbackState}
              onClick={() => onFeedback("up")}
              className={cn(
                "p-1.5 rounded-lg border transition-colors",
                feedbackState === "up" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700",
                feedbackState && feedbackState !== "up" ? "opacity-40" : ""
              )}
              title="Correct"
            >
              <ThumbsUp size={14} />
            </button>
            <button
              type="button"
              disabled={!!feedbackState}
              onClick={() => onFeedback("down")}
              className={cn(
                "p-1.5 rounded-lg border transition-colors",
                feedbackState === "down" ? "bg-rose-500/20 border-rose-500/40 text-rose-400" : "border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700",
                feedbackState && feedbackState !== "down" ? "opacity-40" : ""
              )}
              title="Incorrect"
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Opt-in real, perturbation-based LIME against the live provider —
          verifies (or contradicts) the self-reported attribution above. */}
      {onLimeExplain && (
        <div className="space-y-2">
          <Button icon={FlaskConical} loading={limeState?.loading} onClick={onLimeExplain} className="w-full">
            {limeState?.loading ? "Running perturbation LIME (multiple model calls)…" : "Verify with real LIME"}
          </Button>
          {limeState?.error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">{limeState.error}</p>
          )}
          {limeState?.result && (
            <div className="bg-zinc-900/40 border border-indigo-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wide">
                  Perturbation-Based LIME — Verified
                </span>
                <span className="text-xs text-zinc-500">{limeState.result.candidates_tested} tokens tested</span>
              </div>
              <p className="text-xs text-zinc-500">
                Independent re-query baseline: <strong className="text-zinc-300">{limeState.result.baseline_decision}</strong> ({limeState.result.baseline_violation_confidence}% violation confidence).
              </p>
              <div className="divide-y divide-zinc-800/60">
                {limeState.result.attributions?.map((attr, idx) => (
                  <div key={idx} className="py-2 flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-sm text-zinc-200">{attr.feature}</span>
                      {attr.decision_flip && <span className="ml-2 text-xs text-rose-400">Flipped decision</span>}
                      <p className="text-xs text-zinc-500 mt-0.5">{attr.explanation}</p>
                    </div>
                    <span className="text-xs font-semibold text-zinc-400 shrink-0">Δ{attr.weight}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BrainPage() {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [history, setHistory] = useState([]);
  const [feedbackByIdx, setFeedbackByIdx] = useState({});
  const [limeByIdx, setLimeByIdx] = useState({});
  const bottomRef = useRef(null);

  const refreshConversations = async () => {
    try {
      const data = await api.get("/api/brain/conversations");
      const list = Array.isArray(data) ? data : [];
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  };

  const startNewChat = () => {
    setActiveId(null);
    setHistory([]);
    setFeedbackByIdx({});
    setLimeByIdx({});
  };

  const loadConversation = async (id) => {
    try {
      const data = await api.get(`/api/brain/conversations/${id}`);
      setActiveId(id);
      setHistory(Array.isArray(data.messages) ? data.messages : []);
      setFeedbackByIdx({});
      setLimeByIdx({});
    } catch {
      startNewChat();
    }
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    try {
      await api.del(`/api/brain/conversations/${id}`);
    } catch {
      // list refresh below reconciles either way
    }
    if (id === activeId) startNewChat();
    refreshConversations();
  };

  useEffect(() => {
    (async () => {
      const list = await refreshConversations();
      if (list.length > 0) loadConversation(list[0].id);
    })();
    // Only ever run once on mount - refreshConversations/loadConversation
    // intentionally aren't in the dep array (they'd re-run this on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMsg = query;
    setQuery("");
    const newHistory = [...history, { role: "user", content: userMsg }];
    setHistory(newHistory);
    setLoading(true);

    try {
      const data = await api.post("/api/brain/chat", { query: userMsg, conversation_id: activeId });
      const { conversation_id, ...rest } = data;

      // Data might be wrapped in { response: ... } or return the JSON directly
      const payload = rest.response || rest;

      setHistory([...newHistory, { role: "brain", content: payload }]);
      if (conversation_id && conversation_id !== activeId) setActiveId(conversation_id);
      refreshConversations();
    } catch (err) {
      setHistory([...newHistory, { role: "brain", content: { error: "Failed to connect to GRC Brain." } }]);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (idx, userQuery, brainContent, rating) => {
    if (feedbackByIdx[idx]) return;
    setFeedbackByIdx((prev) => ({ ...prev, [idx]: rating }));
    try {
      await api.post("/api/feedback", {
        source: "brain",
        input_text: userQuery,
        output_decision: brainContent?.decision || "",
        output_explanation: brainContent?.counterfactual || JSON.stringify(brainContent?.feature_attributions || []),
        rating,
      });
    } catch {
      setFeedbackByIdx((prev) => ({ ...prev, [idx]: null }));
    }
  };

  const handleLimeExplain = async (idx, userQuery) => {
    setLimeByIdx((prev) => ({ ...prev, [idx]: { loading: true, error: null, result: null } }));
    try {
      const data = await api.post("/api/xai/lime-explain", { text: userQuery, perspective: "Standard" });
      setLimeByIdx((prev) => ({ ...prev, [idx]: { loading: false, error: null, result: data } }));
    } catch (err) {
      setLimeByIdx((prev) => ({ ...prev, [idx]: { loading: false, error: err.message || "LIME explanation failed.", result: null } }));
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  return (
    <PageContainer>
      <PageHeader
        title="GRC AI Brain"
        description="Multi-agent GRC reasoning engine with LIME-based XAI attributions, cross-jurisdictional conflict detection, and EU AI Act Art. 86 counterfactual explanations."
        icon={Brain}
      />

      <div className="flex gap-5 h-[calc(100vh-220px)] w-full max-w-6xl mx-auto">

        {/* Conversation sidebar */}
        <div className="w-56 shrink-0 flex flex-col gap-2">
          <button
            type="button"
            onClick={startNewChat}
            className="flex items-center gap-2 text-xs font-medium text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 rounded-lg px-3 py-2 transition-colors cursor-pointer"
          >
            <Plus size={14} /> New chat
          </button>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => loadConversation(c.id)}
                className={cn(
                  "group w-full flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer",
                  c.id === activeId
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200"
                    : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                <MessageSquare size={12} className="shrink-0 opacity-60" />
                <span className="truncate flex-1">{c.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => deleteConversation(c.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 shrink-0"
                  title="Delete conversation"
                >
                  <Trash2 size={12} />
                </span>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-zinc-600 px-3 py-2">No past conversations yet.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col flex-1 min-w-0">

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-8 pb-4 scrollbar-thin scrollbar-thumb-zinc-800">

          {history.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
              <Brain className="h-16 w-16 text-zinc-800" />
              <p className="text-lg">Ask the GRC Brain about policies, risks, or frameworks.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Badge label="Are we compliant with SOC 2 CC6.1?" onClick={() => setQuery("Are we compliant with SOC 2 CC6.1?")} />
                <Badge label="What are our critical open risks?" onClick={() => setQuery("What are our critical open risks?")} />
                <Badge label="Do we meet Basel III CET1 requirements?" onClick={() => setQuery("Do we meet Basel III CET1 capital adequacy requirements?")} />
                <Badge label="Any EU CRD vs US Basel III conflicts?" onClick={() => setQuery("Are there any conflicts between EU CRD/CRR and US Basel III Final Rule in our current framework mappings?")} />
              </div>
            </div>
          )}

          {history.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              
              {msg.role === 'user' ? (
                <div className="bg-indigo-600 text-white px-5 py-3 rounded-2xl max-w-[80%] rounded-tr-sm shadow-sm">
                  {msg.content}
                </div>
              ) : (
                <div className="w-full max-w-4xl">
                  <div className="flex items-center space-x-2 mb-3 ml-1">
                    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-1.5 rounded-lg shadow-sm">
                      <Brain className="h-4 w-4 text-white" />
                    </div>
                    <span className="font-semibold text-zinc-300 text-sm">GRC AI Brain</span>
                  </div>

                  <XAIDashboard
                    data={msg.content}
                    sourceQuery={history[idx - 1]?.content}
                    feedbackState={feedbackByIdx[idx]}
                    onFeedback={(rating) => handleFeedback(idx, history[idx - 1]?.content || "", msg.content, rating)}
                    limeState={limeByIdx[idx]}
                    onLimeExplain={() => handleLimeExplain(idx, history[idx - 1]?.content || "")}
                  />
                </div>
              )}
            </div>
          ))}
          
          {loading && (
            <div className="flex justify-start">
              <div className="w-full max-w-4xl">
                <div className="flex items-center space-x-2 mb-3 ml-1">
                  <div className="bg-zinc-800 p-1.5 rounded-lg animate-pulse">
                    <Brain className="h-4 w-4 text-zinc-500" />
                  </div>
                  <span className="font-semibold text-zinc-500 text-sm">Analyzing policies & risks...</span>
                </div>
                <Card className="p-6 bg-zinc-900/20 border-zinc-800/50">
                  <div className="space-y-4 animate-pulse">
                    <div className="h-4 bg-zinc-800 rounded w-1/4"></div>
                    <div className="h-8 bg-zinc-800/50 rounded w-full"></div>
                    <div className="h-8 bg-zinc-800/50 rounded w-full"></div>
                  </div>
                </Card>
              </div>
            </div>
          )}
          
          <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="mt-4 pt-4 border-t border-zinc-800/80 bg-[#09090b]">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask the brain to evaluate compliance or assess risks..."
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-xl px-4 py-4 pr-14 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 placeholder:text-zinc-600 transition-all shadow-inner"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="absolute right-2 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors shadow-sm"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
          <p className="text-center text-xs text-zinc-600 mt-3 font-medium">
            Outputs include LIME attribution weights, cross-jurisdictional conflict detection, and EU AI Act Art. 86 counterfactual explanations.
          </p>
        </div>

        </div>
      </div>
    </PageContainer>
  );
}

// Simple Badge component for quick prompts
function Badge({ label, onClick }) {
  return (
    <button 
      onClick={onClick}
      type="button"
      className="text-xs bg-zinc-900 border border-zinc-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-zinc-400 hover:text-indigo-300 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}
