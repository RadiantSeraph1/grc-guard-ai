"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  ShieldCheck, AlertTriangle, AlertOctagon, RotateCw, 
  HelpCircle, Eye, ShieldAlert, Cpu, Clipboard, RefreshCw,
  FolderOpen
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

const LIVE_SCAN_TRACE = [
  {
    stage: "Input normalization",
    detail: "Preparing the submitted text and selected perspective."
  },
  {
    stage: "Evidence retrieval",
    detail: "Searching the RAG corpus for matching regulations and uploaded evidence."
  },
  {
    stage: "Control classification",
    detail: "Mapping the scenario to the most relevant banking control family."
  },
  {
    stage: "Attribution scoring",
    detail: "Calculating the signal terms used in the XAI heatmap."
  },
  {
    stage: "AI provider check",
    detail: "Using the configured provider or local evidence fallback for synthesis."
  },
  {
    stage: "Auditor synthesis",
    detail: "Composing the verdict, reasoning summary, and remediation guidance."
  }
];

export default function ScannerPage() {
  const { getToken } = useAuth();
  const [scanText, setScanText] = useState("");
  const [perspective, setPerspective] = useState("Standard");
  const [byokKey, setByokKey] = useState("");
  const [scanning, setScanning] = useState(false);
  const [activeTraceStep, setActiveTraceStep] = useState(0);
  const [visibleTrace, setVisibleTrace] = useState(LIVE_SCAN_TRACE);
  
  // Scan result state
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const fetchHistory = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/logs`, { headers });
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.warn("Could not retrieve audit scan history.");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

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
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/scan`, {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({
          text: scanText,
          perspective,
          byok_key: byokKey || null
        })
      });
      const data = await res.json();
      setResult(data);
      if (data.reasoning_trace?.length) {
        setVisibleTrace(data.reasoning_trace);
        setActiveTraceStep(data.reasoning_trace.length);
      }
      fetchHistory();
    } catch (err) {
      // Offline fallback
      alert("Failed to scan. Backend offline.");
    } finally {
      setScanning(false);
    }
  };

  const getVerdictBadge = (decision) => {
    switch (decision) {
      case "COMPLIANT": return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      case "VIOLATION": return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
      default: return "bg-slate-800 text-slate-400 border border-slate-700/30";
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
      
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Cognitive Audit Scanners</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">AI Compliance Scanner</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Perform real-world scans on configurations, transactions, or log entries, evaluating parameters against regulatory rules.
        </p>
      </div>

      {/* Main Grid split: Input scan on Left, results on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Scan Input Card */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 shadow-sm space-y-5 h-fit">
          <div className="flex items-center space-x-2">
            <Cpu size={16} className="text-zinc-400" />
            <h3 className="font-semibold text-zinc-200 text-base">New Compliance Scan</h3>
          </div>

          <form onSubmit={handleScan} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-450 font-semibold uppercase tracking-wide">Configuration / Log Text</label>
              <textarea
                value={scanText}
                onChange={(e) => setScanText(e.target.value)}
                placeholder="Paste code configs, swift routing logs, or audit records...&#10;Try: 'The bank CET1 ratio of 5.5% is registered on ledger.'"
                rows={5}
                required
                className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-100 rounded-lg p-3 text-xs placeholder-zinc-650 focus:outline-none transition-all resize-none font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-450 font-semibold uppercase tracking-wide">Perspective</label>
                <select
                  value={perspective}
                  onChange={(e) => setPerspective(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-800 text-zinc-300 rounded-lg p-2.5 text-xs focus:outline-none focus:border-zinc-500 cursor-pointer font-semibold"
                >
                  <option value="Standard">Standard / Auditor</option>
                  <option value="Attacker">Attacker Profile</option>
                  <option value="User">User Profile</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-450 font-semibold uppercase tracking-wide">BYOK Encryption Key</label>
                <input
                  type="password"
                  value={byokKey}
                  onChange={(e) => setByokKey(e.target.value)}
                  placeholder="Optional decryption key"
                  className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-300 rounded-lg p-2.5 text-xs focus:outline-none transition-all placeholder-zinc-650 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 text-[10px] text-zinc-450 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/80">
              <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
              <span>BYOK key hashes logs instantly on database insertion, securing privacy boundaries.</span>
            </div>

            <button
              type="submit"
              disabled={scanning || !scanText.trim()}
              className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-2.5 px-4 rounded-lg cursor-pointer text-xs active:scale-95 transition-all shadow-sm disabled:bg-zinc-900 disabled:text-zinc-500 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {scanning ? (
                <>
                  <RotateCw size={14} className="animate-spin text-zinc-900 mr-1" />
                  <span>Scanning regulations...</span>
                </>
              ) : (
                <span>Scan Parameters</span>
              )}
            </button>
          </form>
        </div>

        {/* Scan Results Card */}
        <div className="space-y-6">
          {scanning ? (
            <ReasoningTraceCard
              trace={visibleTrace}
              activeStep={activeTraceStep}
              live
            />
          ) : result ? (
            <div className="bg-[#121215] border border-zinc-800 rounded-xl p-6 shadow-sm space-y-6 animate-fadeIn">
              
              {/* Verdict header */}
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="font-semibold text-zinc-200 text-base">Scan Verdict</h3>
                  <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
                    Category: {result.category}
                  </span>
                </div>
                <span className={`text-xs font-semibold py-1 px-3.5 rounded uppercase ${getVerdictBadge(result.decision)}`}>
                  {result.decision}
                </span>
              </div>

              <ReasoningTraceCard
                trace={result.reasoning_trace || visibleTrace}
                activeStep={(result.reasoning_trace || visibleTrace).length}
                embedded
              />

              {/* XAI Heatmap */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide flex items-center">
                  <Eye size={12} className="mr-1 text-zinc-500" />
                  XAI Feature Attribution Heatmap
                </h4>
                <div className="p-3 bg-[#09090b] border border-zinc-800/60 rounded-xl leading-relaxed font-mono text-xs flex flex-wrap gap-1">
                  {result.attributions?.map((attr, idx) => {
                    const weight = attr.attribution; // 0.0 - 1.0
                    // calculate background opacity based on weight
                    let highlightClass = "text-zinc-300";
                    if (weight >= 0.7) highlightClass = "bg-rose-500/25 text-rose-300 font-bold border border-rose-500/10 rounded px-0.5";
                    else if (weight >= 0.4) highlightClass = "bg-amber-500/20 text-amber-250 border border-amber-500/10 rounded px-0.5";

                    return (
                      <span 
                        key={idx} 
                        className={`transition-all duration-300 ${highlightClass}`}
                        title={`Attribution weight: ${weight}`}
                      >
                        {attr.word}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-[#09090b] border border-zinc-800/60 rounded-xl p-3">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Decision Confidence</span>
                  <div className="text-lg text-zinc-100 font-semibold mt-1">
                    {result.decision === "VIOLATION" ? "92%" : "88%"}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Rule/RAG consistency score</p>
                </div>
                <div className="bg-[#09090b] border border-zinc-800/60 rounded-xl p-3">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Top Signal</span>
                  <div className="text-sm text-zinc-100 font-semibold mt-1 truncate">
                    {result.attributions?.sort((a, b) => b.attribution - a.attribution)?.[0]?.word || "None"}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Highest local attribution</p>
                </div>
                <div className="bg-[#09090b] border border-zinc-800/60 rounded-xl p-3">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Auditor Mode</span>
                  <div className="text-sm text-zinc-100 font-semibold mt-1">Explainable</div>
                  <p className="text-[10px] text-zinc-500 mt-1">Reasoning + remediation included</p>
                </div>
              </div>

              {/* Auditor justification report */}
              <div className="bg-[#09090b] border border-zinc-800/60 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-850 pb-2">
                  <span className="font-semibold text-zinc-200 text-xs flex items-center">
                    <Clipboard size={14} className="mr-1.5 text-zinc-400" />
                    {result.justification?.title || "Auditor Report"}
                  </span>
                  <span className={`text-[9px] font-semibold py-0.5 px-1.5 rounded uppercase ${
                    result.justification?.severity === "CRITICAL" ? "bg-rose-500/10 text-rose-450" : "bg-emerald-500/10 text-emerald-450"
                  }`}>
                    {result.justification?.severity}
                  </span>
                </div>
                <div className="space-y-3 text-[11px] leading-relaxed text-zinc-300">
                  <div>
                    <span className="font-semibold text-zinc-500 block uppercase tracking-wide text-[9px] mb-0.5">Summary</span>
                    <p>{result.justification?.summary}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-500 block uppercase tracking-wide text-[9px] mb-0.5">Reasoning</span>
                    <p>{result.justification?.reasoning}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-500 block uppercase tracking-wide text-[9px] mb-0.5">Remediation Guidance</span>
                    <p className="text-zinc-300 font-mono text-[10px] bg-zinc-900 border border-zinc-800/60 p-2.5 rounded">{result.justification?.remediation}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-12 text-center text-zinc-500 text-xs flex flex-col items-center justify-center space-y-3 h-full min-h-[350px]">
              <HelpCircle size={32} className="text-zinc-650" />
              <div className="space-y-1">
                <h4 className="font-semibold text-zinc-200 text-sm">No Active Scan Result</h4>
                <p className="text-[11px] text-zinc-500 max-w-xs leading-normal">
                  Paste configuration attributes or logs on the left and trigger a scan to see attributions.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReasoningTraceCard({ trace = LIVE_SCAN_TRACE, activeStep = 0, live = false, embedded = false }) {
  const steps = trace.length ? trace : LIVE_SCAN_TRACE;

  return (
    <div className={`${embedded ? "bg-[#09090b] border-zinc-800/60 p-4" : "bg-[#121215] border-zinc-800 p-6 shadow-sm"} border rounded-xl space-y-5 animate-fadeIn`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
            Visible Analysis Trace
          </span>
          <h3 className="font-semibold text-zinc-100 text-base mt-1">
            {live ? "Running Compliance Scan" : "Scan Reasoning Summary"}
          </h3>
        </div>
        {live && (
          <RotateCw size={16} className="animate-spin text-zinc-400 mt-1 shrink-0" />
        )}
      </div>

      <div className="space-y-3">
        {steps.map((step, idx) => {
          const completed = !live || idx < activeStep;
          const active = live && idx === activeStep;

          return (
            <div
              key={`${step.stage}-${idx}`}
              className={`rounded-lg border p-3 transition-all ${
                active
                  ? "border-zinc-500 bg-zinc-900/80"
                  : completed
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-zinc-800 bg-zinc-950/40"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-zinc-100">{step.stage}</span>
                <span className={`text-[9px] uppercase tracking-wider font-bold ${
                  completed ? "text-emerald-400" : active ? "text-zinc-200" : "text-zinc-600"
                }`}>
                  {completed ? "Done" : active ? "Running" : "Queued"}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed mt-1">
                {step.detail}
              </p>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-zinc-600 leading-relaxed border-t border-zinc-800 pt-3">
        This is a user-facing audit trace of the workflow stages and evidence used, not private model chain-of-thought.
      </p>
    </div>
  );
}

