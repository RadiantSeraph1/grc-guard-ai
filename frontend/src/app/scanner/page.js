"use client";

import { useState, useEffect, useCallback } from "react";
import { RotateCw, HelpCircle, Eye, ShieldAlert, Cpu, Clipboard } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, CardHeader, Badge, Button,
  Field, Input, Textarea, Select, cn,
} from "../components/ui";

const LIVE_SCAN_TRACE = [
  { stage: "Input normalization", detail: "Preparing the submitted text and selected perspective." },
  { stage: "Evidence retrieval", detail: "Searching the RAG corpus for matching regulations and uploaded evidence." },
  { stage: "Control classification", detail: "Mapping the scenario to the most relevant banking control family." },
  { stage: "Attribution scoring", detail: "Calculating the signal terms used in the XAI heatmap." },
  { stage: "AI provider check", detail: "Using the configured provider or local evidence fallback for synthesis." },
  { stage: "Auditor synthesis", detail: "Composing the verdict, reasoning summary, and remediation guidance." },
];

export default function ScannerPage() {
  const api = useApi();
  const [scanText, setScanText] = useState("");
  const [perspective, setPerspective] = useState("Standard");
  const [byokKey, setByokKey] = useState("");
  const [scanning, setScanning] = useState(false);
  const [activeTraceStep, setActiveTraceStep] = useState(0);
  const [visibleTrace, setVisibleTrace] = useState(LIVE_SCAN_TRACE);
  const [result, setResult] = useState(null);

  // Keep history fetch for parity (sidebar/other surfaces refresh off the same logs).
  const refreshHistory = useCallback(async () => {
    try {
      await api.get("/api/logs");
    } catch {
      /* non-blocking */
    }
  }, [api]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!scanning) return undefined;
    setVisibleTrace(LIVE_SCAN_TRACE);
    setActiveTraceStep(0);
    const interval = window.setInterval(() => {
      setActiveTraceStep((step) => Math.min(step + 1, LIVE_SCAN_TRACE.length - 1));
    }, 900);
    return () => window.clearInterval(interval);
  }, [scanning]);

  const handleScan = async (e) => {
    e.preventDefault();
    if (!scanText.trim()) return;
    setScanning(true);
    setResult(null);
    setVisibleTrace(LIVE_SCAN_TRACE);
    setActiveTraceStep(0);
    try {
      const data = await api.post("/api/scan", {
        text: scanText,
        perspective,
        byok_key: byokKey || null,
      });
      setResult(data);
      if (data.reasoning_trace?.length) {
        setVisibleTrace(data.reasoning_trace);
        setActiveTraceStep(data.reasoning_trace.length);
      }
      refreshHistory();
    } catch {
      alert("Failed to scan. Backend offline.");
    } finally {
      setScanning(false);
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
        {/* Input */}
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

        {/* Results */}
        <div className="space-y-5">
          {scanning ? (
            <ReasoningTraceCard trace={visibleTrace} activeStep={activeTraceStep} live />
          ) : result ? (
            <Card className="space-y-6 ui-fade-in">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-100">Scan Verdict</h3>
                  <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Category: {result.category}</span>
                </div>
                <Badge variant={verdictVariant(result.decision)}>{result.decision}</Badge>
              </div>

              <ReasoningTraceCard
                trace={result.reasoning_trace || visibleTrace}
                activeStep={(result.reasoning_trace || visibleTrace).length}
                embedded
              />

              {/* XAI heatmap */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
                  <Eye size={12} /> XAI Feature Attribution Heatmap
                </h4>
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
                <MetricTile label="Auditor Mode" value="Explainable" hint="Reasoning + remediation included" />
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
                  <div>
                    <span className="font-semibold text-zinc-500 block uppercase tracking-wide text-xs mb-1">Remediation Guidance</span>
                    <p className="text-zinc-300 font-mono text-xs bg-zinc-900 border border-zinc-800 p-2.5 rounded">{result.justification?.remediation}</p>
                  </div>
                </div>
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

function ReasoningTraceCard({ trace = LIVE_SCAN_TRACE, activeStep = 0, live = false, embedded = false }) {
  const steps = trace.length ? trace : LIVE_SCAN_TRACE;
  return (
    <div className={cn("border rounded-xl space-y-5 ui-fade-in", embedded ? "bg-[#09090b] border-zinc-800 p-4" : "ui-card p-6")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Visible Analysis Trace</span>
          <h3 className="font-semibold text-zinc-100 text-sm mt-1">
            {live ? "Running Compliance Scan" : "Scan Reasoning Summary"}
          </h3>
        </div>
        {live && <RotateCw size={16} className="animate-spin text-zinc-400 mt-1 shrink-0" />}
      </div>

      <div className="space-y-3">
        {steps.map((step, idx) => {
          const completed = !live || idx < activeStep;
          const active = live && idx === activeStep;
          return (
            <div
              key={`${step.stage}-${idx}`}
              className={cn(
                "rounded-lg border p-3 transition-all",
                active ? "border-indigo-500/50 bg-zinc-900/80" : completed ? "border-emerald-500/20 bg-emerald-500/5" : "border-zinc-800 bg-zinc-950/40"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-zinc-100">{step.stage}</span>
                <span className={cn("text-xs uppercase tracking-wider font-bold", completed ? "text-emerald-400" : active ? "text-zinc-200" : "text-zinc-600")}>
                  {completed ? "Done" : active ? "Running" : "Queued"}
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed mt-1">{step.detail}</p>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-600 leading-relaxed border-t border-zinc-800 pt-3">
        This is a user-facing audit trace of the workflow stages and evidence used, not private model chain-of-thought.
      </p>
    </div>
  );
}
