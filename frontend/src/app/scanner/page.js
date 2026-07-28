"use client";

import { useState, useEffect, useCallback } from "react";
import { RotateCw, HelpCircle, Eye, ShieldAlert, Cpu, Clipboard, ThumbsUp, ThumbsDown, FlaskConical, History } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button,
  Field, Input, Textarea, Select, cn, toast, StarRating,
} from "../components/ui";

export default function ScannerPage() {
  const api = useApi();
  const [scanText, setScanText] = useState("");
  const [perspective, setPerspective] = useState("Standard");
  const [byokKey, setByokKey] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [feedbackSent, setFeedbackSent] = useState(null); // "up" | "down" | null
  const [transparencyRating, setTransparencyRating] = useState(null);
  const [limeLoading, setLimeLoading] = useState(false);
  const [limeResult, setLimeResult] = useState(null);
  const [limeError, setLimeError] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeLogId, setActiveLogId] = useState(null);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.get("/api/logs");
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      // history is a convenience panel — a failed fetch shouldn't block scanning
    }
  }, [api]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const loadFromHistory = (log) => {
    setScanText(log.scanned_text || "");
    setActiveLogId(log.id);
    setFeedbackSent(null);
    setTransparencyRating(null);
    setLimeResult(null);
    setLimeError(null);
    setResult({
      id: log.id,
      timestamp: log.timestamp,
      decision: log.decision,
      category: log.category,
      confidence: null,
      justification: log.justification,
      attributions: [],
      reasoning_trace: [],
      is_encrypted: log.is_encrypted,
    });
  };

  const handleScan = async (e) => {
    e.preventDefault();
    if (!scanText.trim()) return;
    setScanning(true);
    setResult(null);
    setFeedbackSent(null);
    setTransparencyRating(null);
    setLimeResult(null);
    setLimeError(null);
    setActiveLogId(null);
    try {
      const data = await api.post("/api/scan", {
        text: scanText,
        perspective,
        byok_key: byokKey || null,
      });
      setResult(data);
      setActiveLogId(data.id);
      fetchHistory();
    } catch {
      toast.error("Failed to scan. Backend offline.");
    } finally {
      setScanning(false);
    }
  };

  const handleFeedback = async (rating) => {
    if (!result || feedbackSent) return;
    setFeedbackSent(rating);
    try {
      await api.post("/api/feedback", {
        source: "scan",
        input_text: scanText,
        output_decision: result.decision,
        output_explanation: result.justification?.reasoning || "",
        rating,
      });
    } catch {
      setFeedbackSent(null); // let them retry if the call failed
    }
  };

  const handleTransparencyRate = async (stars) => {
    if (!result || !feedbackSent || transparencyRating) return;
    setTransparencyRating(stars);
    try {
      await api.post("/api/feedback", {
        source: "scan",
        input_text: scanText,
        output_decision: result.decision,
        output_explanation: result.justification?.reasoning || "",
        rating: feedbackSent,
        transparency_rating: stars,
      });
    } catch {
      setTransparencyRating(null);
      toast.error("Failed to record rating.");
    }
  };

  const handleLimeExplain = async () => {
    if (!scanText.trim()) return;
    setLimeLoading(true);
    setLimeError(null);
    setLimeResult(null);
    try {
      const data = await api.post("/api/xai/lime-explain", { text: scanText, perspective });
      setLimeResult(data);
    } catch (err) {
      setLimeError(err.message || "LIME explanation failed.");
    } finally {
      setLimeLoading(false);
    }
  };

  const verdictVariant = (d) => (d === "COMPLIANT" ? "success" : d === "VIOLATION" ? "danger" : "neutral");
  const confidencePct = result?.confidence != null ? Math.round(result.confidence * 100) : null;
  const topSignal =
    result?.attributions?.length
      ? [...result.attributions].sort((a, b) => b.attribution - a.attribution)[0]?.word
      : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Audit Scanner"
        title="Compliance Scanner"
        description="Scan configurations, transactions, or log entries and evaluate them against regulatory rules with explainable attributions."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input + history */}
        <div className="space-y-5">
        <Card className="h-fit space-y-5">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-100">New Compliance Scan</h3>
          </div>
          <form onSubmit={handleScan} className="space-y-4">
            <Field label="Configuration / log text">
              <Textarea
                value={scanText}
                onChange={(e) => setScanText(e.target.value)}
                placeholder={"Paste configs, SWIFT routing logs, or audit records…\nTry: 'The bank CET1 ratio of 5.5% is registered on ledger.'"}
                rows={5}
                required
                className="font-mono resize-none"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Perspective">
                <Select value={perspective} onChange={(e) => setPerspective(e.target.value)}>
                  <option value="Standard">Standard / Auditor</option>
                  <option value="Attacker">Attacker Profile</option>
                  <option value="User">User Profile</option>
                </Select>
              </Field>
              <Field label="BYOK encryption key">
                <Input
                  type="password"
                  value={byokKey}
                  onChange={(e) => setByokKey(e.target.value)}
                  placeholder="Optional decryption key"
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
              <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
              <span>The BYOK key hashes logs on database insertion, securing privacy boundaries.</span>
            </div>
            <Button type="submit" variant="primary" loading={scanning} disabled={!scanText.trim()} className="w-full">
              {scanning ? "Scanning regulations…" : "Scan parameters"}
            </Button>
          </form>
        </Card>

        {/* History */}
        <Card className="h-fit space-y-3">
          <div className="flex items-center gap-2">
            <History size={16} className="text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Recent Scans</h3>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
            {history.length === 0 && (
              <p className="text-xs text-zinc-600 px-1 py-1">No past scans yet.</p>
            )}
            {history.map((log) => (
              <button
                key={log.id}
                type="button"
                onClick={() => loadFromHistory(log)}
                className={cn(
                  "w-full flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer",
                  log.id === activeLogId
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200"
                    : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                <Badge variant={verdictVariant(log.decision)} className="shrink-0">{log.decision}</Badge>
                <span className="truncate flex-1">{log.is_encrypted ? "[Encrypted]" : log.category}</span>
                <span className="text-zinc-600 shrink-0">{new Date(log.timestamp * 1000).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </Card>
        </div>

        {/* Results */}
        <div className="space-y-5">
          {scanning ? (
            <Card className="p-12 text-center flex flex-col items-center justify-center gap-3 h-full min-h-[350px]">
              <RotateCw size={22} className="animate-spin text-zinc-500" />
              <p className="text-xs text-zinc-500">Scanning against regulations and the evidence corpus…</p>
            </Card>
          ) : result ? (
            <Card className="space-y-6 ui-fade-in">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-100">Scan Verdict</h3>
                  <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Category: {result.category}</span>
                </div>
                <Badge variant={verdictVariant(result.decision)}>{result.decision}</Badge>
              </div>

              {result.reasoning_trace?.length > 0 && (
                <ReasoningTraceCard trace={result.reasoning_trace} embedded />
              )}

              {/* XAI heatmap */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
                  <Eye size={12} /> XAI Feature Attribution Heatmap
                </h4>
                {!result.attributions?.length && (
                  <p className="text-xs text-zinc-600 italic">Loaded from history — re-scan to regenerate the live attribution heatmap and LIME explanation.</p>
                )}
                <div className="p-3 bg-[#09090b] border border-zinc-800 rounded-xl leading-relaxed font-mono text-sm flex flex-wrap gap-1">
                  {result.attributions?.map((attr, idx) => {
                    const w = attr.attribution;
                    const cls =
                      w >= 0.7
                        ? "bg-rose-500/25 text-rose-300 font-bold rounded px-0.5"
                        : w >= 0.4
                        ? "bg-amber-500/20 text-amber-200 rounded px-0.5"
                        : "text-zinc-300";
                    return (
                      <span key={idx} className={cn("transition-all", cls)} title={`Attribution weight: ${w}`}>
                        {attr.word}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Real metrics (no hardcoded confidence) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <MetricTile label="Decision Confidence" value={confidencePct != null ? `${confidencePct}%` : "—"} hint="Signal + RAG consistency" />
                <MetricTile label="Top Signal" value={topSignal || "None"} hint="Highest local attribution" truncate />
                <MetricTile label="Auditor Mode" value="Explainable" hint="Detailed reasoning included" />
              </div>

              {/* Justification */}
              <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="font-semibold text-zinc-200 text-sm flex items-center gap-1.5">
                    <Clipboard size={14} className="text-zinc-400" />
                    {result.justification?.title || "Auditor Report"}
                  </span>
                  {result.justification?.severity && (
                    <Badge variant={result.justification.severity === "CRITICAL" ? "danger" : "success"}>
                      {result.justification.severity}
                    </Badge>
                  )}
                </div>
                <div className="space-y-3 text-sm leading-relaxed text-zinc-300">
                  <ReportField label="Summary" text={result.justification?.summary} />
                  <ReportField label="Reasoning" text={result.justification?.reasoning} />
                </div>
              </div>

              {/* Auditor feedback — data collection for future DPO/RLHF fine-tuning */}
              <div className="flex items-center justify-between gap-3 bg-[#09090b] border border-zinc-800 rounded-xl p-3">
                <span className="text-xs text-zinc-500">Was this verdict correct?</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!!feedbackSent}
                    onClick={() => handleFeedback("up")}
                    className={cn(
                      "p-1.5 rounded-lg border transition-colors",
                      feedbackSent === "up" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700",
                      feedbackSent && feedbackSent !== "up" ? "opacity-40" : ""
                    )}
                    title="Correct"
                  >
                    <ThumbsUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={!!feedbackSent}
                    onClick={() => handleFeedback("down")}
                    className={cn(
                      "p-1.5 rounded-lg border transition-colors",
                      feedbackSent === "down" ? "bg-rose-500/20 border-rose-500/40 text-rose-400" : "border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700",
                      feedbackSent && feedbackSent !== "down" ? "opacity-40" : ""
                    )}
                    title="Incorrect"
                  >
                    <ThumbsDown size={14} />
                  </button>
                </div>
              </div>

              {feedbackSent && (
                <div className="flex items-center justify-between gap-3 bg-[#09090b] border border-zinc-800 rounded-xl p-3">
                  <span className="text-xs text-zinc-500">Rate this explanation&apos;s transparency for audit sign-off</span>
                  <StarRating value={transparencyRating} onRate={handleTransparencyRate} disabled={!!transparencyRating} />
                </div>
              )}

              {/* Opt-in real LIME — separate from the automatic attribution heatmap above,
                  which is IR/relevance-based, not perturbation LIME. */}
              <div className="space-y-2">
                <Button
                  icon={FlaskConical}
                  loading={limeLoading}
                  onClick={handleLimeExplain}
                  className="w-full"
                >
                  {limeLoading ? "Running perturbation LIME (multiple model calls)…" : "Explain with real LIME (verified)"}
                </Button>
                {limeError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">{limeError}</p>
                )}
                {limeResult && (
                  <div className="bg-[#09090b] border border-indigo-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wide">
                        Perturbation-Based LIME — Verified
                      </span>
                      <span className="text-xs text-zinc-500">{limeResult.candidates_tested} tokens tested</span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Model&apos;s own baseline: <strong className="text-zinc-300">{limeResult.baseline_decision}</strong> ({limeResult.baseline_violation_confidence}% violation confidence). Each row below removed that token and re-queried the live model.
                    </p>
                    <div className="divide-y divide-zinc-800/60">
                      {limeResult.attributions?.map((attr, idx) => (
                        <div key={idx} className="py-2 flex items-start justify-between gap-3">
                          <div>
                            <span className="font-mono text-sm text-zinc-200">{attr.feature}</span>
                            {attr.decision_flip && (
                              <Badge variant="danger" className="ml-2">Flipped decision</Badge>
                            )}
                            <p className="text-xs text-zinc-500 mt-0.5">{attr.explanation}</p>
                          </div>
                          <span className="text-xs font-semibold text-zinc-400 shrink-0">Δ{attr.weight}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-12 text-center flex flex-col items-center justify-center gap-3 h-full min-h-[350px]">
              <HelpCircle size={32} className="text-zinc-700" />
              <div className="space-y-1">
                <h4 className="font-semibold text-zinc-200 text-sm">No active scan result</h4>
                <p className="text-xs text-zinc-500 max-w-xs leading-normal">
                  Paste configuration attributes or logs on the left and trigger a scan to see attributions.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function MetricTile({ label, value, hint, truncate }) {
  return (
    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-3">
      <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{label}</span>
      <div className={cn("text-zinc-100 font-semibold mt-1", truncate ? "text-sm truncate" : "text-lg")}>{value}</div>
      <p className="text-xs text-zinc-500 mt-1">{hint}</p>
    </div>
  );
}

function ReportField({ label, text }) {
  return (
    <div>
      <span className="font-semibold text-zinc-500 block uppercase tracking-wide text-xs mb-0.5">{label}</span>
      <p>{text}</p>
    </div>
  );
}

// Renders the REAL reasoning_trace returned by /api/scan — the stages the
// backend actually executed. No client-side simulated progress.
function ReasoningTraceCard({ trace, embedded = false }) {
  return (
    <div className={cn("border rounded-xl space-y-5 ui-fade-in", embedded ? "bg-[#09090b] border-zinc-800 p-4" : "ui-card p-6")}>
      <div>
        <span className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Analysis Trace</span>
        <h3 className="font-semibold text-zinc-100 text-sm mt-1">Scan Reasoning Summary</h3>
      </div>

      <div className="space-y-3">
        {trace.map((step, idx) => (
          <div key={`${step.stage}-${idx}`} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-zinc-100">{step.stage}</span>
              <span className="text-xs uppercase tracking-wider font-bold text-emerald-400">{step.status || "completed"}</span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed mt-1">{step.detail}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-600 leading-relaxed border-t border-zinc-800 pt-3">
        This is a user-facing audit trace of the workflow stages and evidence used, not private model chain-of-thought.
      </p>
    </div>
  );
}
