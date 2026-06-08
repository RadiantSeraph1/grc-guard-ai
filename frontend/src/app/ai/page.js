"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  Cpu, MessageSquare, Send, Radio, Library, ShieldCheck, 
  AlertTriangle, GitMerge, Loader2, ArrowUpRight, HelpCircle,
  Network, RefreshCw
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function AiPage() {
  const { getToken } = useAuth();
  const [activeAgent, setActiveAgent] = useState("compliance_agent");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [chatLogs, setChatLogs] = useState({
    compliance_agent: [{ role: "assistant", text: "Compliance Agent online. Paste policy text to map against framework controls." }],
    tprm_agent: [{ role: "assistant", text: "TPRM Vendor Risk Agent online. Submit vendor risk audits to pre-populate answers." }],
    trust_agent: [{ role: "assistant", text: "Customer Trust Agent online. Ask me security questions to auto-respond based on RAG controls." }],
    risk_agent: [{ role: "assistant", text: "Risk Propagation Agent online. Query threat node relationships to calculate vulnerability scores." }]
  });
  const [querying, setQuerying] = useState(false);

  // Trust Graph state
  const [graphNodes, setGraphNodes] = useState([]);
  const [graphLinks, setGraphLinks] = useState([]);
  const [loadingGraph, setLoadingGraph] = useState(true);

  const fetchGraph = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/ai/trust-graph`, { headers });
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      if (!data.nodes || !data.links) throw new Error("Invalid response format");
      setGraphNodes(data.nodes);
      setGraphLinks(data.links);
    } catch (err) {
      console.warn("Using fallback local trust graph dataset.");
      // Fallback node links matching seeded database
      setGraphNodes([
        { id: "aws", label: "Amazon Web Services", type: "integration", status: "Disconnected" },
        { id: "okta", label: "Okta Identity Manager", type: "integration", status: "Connected" },
        { id: "asset-01", label: "Production Ledger RDS", type: "asset", status: "Failing" },
        { id: "asset-02", label: "Corporate Git Repo", type: "asset", status: "Failing" },
        { id: "basel-iii-01", label: "CET1 Capital Adequacy", type: "control", status: "Passing" },
        { id: "gdpr-01", label: "Database Encryption at Rest", type: "control", status: "Failing" },
        { id: "risk-03", label: "Core Database Breach", type: "risk", status: "Mitigated" }
      ]);
      setGraphLinks([
        { source: "aws", target: "asset-01", type: "provides" },
        { source: "asset-01", target: "gdpr-01", type: "secures" },
        { source: "gdpr-01", target: "risk-03", type: "mitigates" }
      ]);
    } finally {
      setLoadingGraph(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  const handleAgentQuery = async (e) => {
    e.preventDefault();
    if (!agentPrompt.trim()) return;

    const prompt = agentPrompt;
    setChatLogs(prev => ({
      ...prev,
      [activeAgent]: [...prev[activeAgent], { role: "user", text: prompt }]
    }));
    setAgentPrompt("");
    setQuerying(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/ai/agent-query`, {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({ agent_id: activeAgent, prompt })
      });
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setChatLogs(prev => ({
        ...prev,
        [activeAgent]: [...prev[activeAgent], { role: "assistant", text: data.response }]
      }));
    } catch (err) {
      // offline fallback responses based on agent
      let responseText = "Local Fallback: GRC compliance controls processed successfully.";
      if (activeAgent === "compliance_agent") {
        responseText = "Compliance Agent Fallback: I have evaluated your policy draft against control GDPR-PII-01. Recommend adding details on AES-256 data backup encryption.";
      } else if (activeAgent === "tprm_agent") {
        responseText = "TPRM Agent Fallback: Pre-populated answers completed. CoreBankingTech Ltd is verified as Approved under Tier 1 Critical risk settings.";
      } else if (activeAgent === "trust_agent") {
        responseText = "Trust Agent Fallback: Answer: Yes, we utilize AES-256 encryption for data at rest on AWS S3, verified under control GDPR-PII-01.";
      } else if (activeAgent === "risk_agent") {
        responseText = "Risk Agent Fallback: Risk Propagation path: Integration AWS -> Asset Ledger RDS -> Control GDPR-PII-01 (Failing) -> Risk Database Breach (Inherent Score: 20 -> Residual: 8). The risk mitigation is active but failing.";
      }

      setChatLogs(prev => ({
        ...prev,
        [activeAgent]: [...prev[activeAgent], { role: "assistant", text: responseText }]
      }));
    } finally {
      setQuerying(false);
    }
  };

  const getStatusColor = (status, type) => {
    if (type === "integration") {
      return status === "Connected" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5" : "border-zinc-800 text-zinc-500 bg-zinc-900/50";
    }
    if (status === "Passing" || status === "Mitigated") return "border-emerald-500/40 text-emerald-400 bg-emerald-500/5";
    if (status === "Warning") return "border-amber-500/40 text-amber-400 bg-amber-500/5";
    return "border-rose-500/40 text-rose-400 bg-rose-500/5";
  };

  const getIcon = (type) => {
    switch (type) {
      case "integration": return "🔌";
      case "asset": return "💾";
      case "control": return "🛡️";
      default: return "⚠️";
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Trust Graph Cognitive Engines</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">AI Agents Center</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Interact with specialized AI Agents and explore relational security pathways dynamically across GRC components.
        </p>
      </div>

      {/* Main Grid: Left col Agents Console, Right col Trust Graph */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left col: Agents Chat */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4 h-[450px]">
          
          {/* Agent tabs header */}
          <div className="space-y-3">
            <h3 className="font-semibold text-zinc-200 text-sm">GRC AI Agents</h3>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
              {[
                { id: "compliance_agent", name: "Compliance Agent" },
                { id: "tprm_agent", name: "TPRM Agent" },
                { id: "trust_agent", name: "Trust Agent" },
                { id: "risk_agent", name: "Risk Agent" }
              ].map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setActiveAgent(agent.id)}
                  className={`py-2 px-3 rounded-lg border text-left cursor-pointer transition-all ${
                    activeAgent === agent.id 
                      ? "bg-zinc-800/80 border-zinc-600 text-zinc-100 font-semibold" 
                      : "bg-zinc-900/50 border-zinc-800/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  {agent.name}
                </button>
              ))}
            </div>
          </div>

          {/* Active Chat Log */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar bg-zinc-950/50 p-3.5 rounded-lg border border-zinc-800/40 text-[10px]">
            {chatLogs[activeAgent]?.map((log, idx) => (
              <div 
                key={idx} 
                className={`flex flex-col space-y-1 p-2.5 rounded-lg border max-w-[85%] ${
                  log.role === "user" 
                    ? "bg-zinc-800/50 border-zinc-700/40 text-zinc-200 ml-auto" 
                    : "bg-zinc-900/60 border-zinc-800/40 text-zinc-300 mr-auto"
                }`}
              >
                <span className="font-bold text-[8px] uppercase text-zinc-500">
                  {log.role === "user" ? "You" : activeAgent.replace("_", " ").toUpperCase()}
                </span>
                <p className="leading-relaxed text-[11px]">{log.text}</p>
              </div>
            ))}
            {querying && (
              <div className="flex items-center space-x-1.5 text-zinc-500 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/40 mr-auto max-w-[85%]">
                <Loader2 size={10} className="animate-spin text-zinc-400" />
                <span className="text-[10px]">Agent reasoning in progress...</span>
              </div>
            )}
          </div>

          {/* Prompt input Form */}
          <form onSubmit={handleAgentQuery} className="flex items-center space-x-2 pt-3 border-t border-zinc-800/40">
            <input
              type="text"
              required
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              placeholder={
                activeAgent === "compliance_agent" 
                  ? "Scan draft policy against GDPR controls..." 
                  : activeAgent === "tprm_agent"
                  ? "Audit CoreBankingTech questionnaire..."
                  : activeAgent === "trust_agent"
                  ? "Ask customer security questionnaire..."
                  : "Trace database breach propagation path..."
              }
              className="flex-1 bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-600 text-zinc-200 rounded-lg px-3.5 py-2 text-xs focus:outline-none transition-all placeholder-zinc-600"
            />
            <button
              type="submit"
              disabled={querying || !agentPrompt.trim()}
              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold p-2 rounded-lg cursor-pointer active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={14} />
            </button>
          </form>
        </div>

        {/* Right 2 cols: Relational Trust Graph node map directory */}
        <div className="lg:col-span-2 bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-zinc-200 text-sm">Relational Trust Graph Directory</h3>
              <p className="text-[10px] text-zinc-500 mt-0.5">Explore GRC node links and vulnerabilities mapped by the AI Risk Agent.</p>
            </div>
            <button 
              onClick={fetchGraph}
              className="text-zinc-400 hover:text-zinc-100 p-1.5 bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 rounded-lg cursor-pointer transition-colors"
              title="Refresh Graph"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Node directory canvas layout */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 h-[300px] overflow-y-auto pr-1 custom-scrollbar">
            {graphNodes.map((node) => (
              <div 
                key={node.id} 
                className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-3 hover:scale-[1.02] active:scale-98 transition-all ${getStatusColor(node.status, node.type)}`}
              >
                <div className="flex items-start justify-between">
                  <span className="text-base">{getIcon(node.type)}</span>
                  <span className="text-[8px] font-extrabold uppercase tracking-widest text-zinc-500">
                    {node.type}
                  </span>
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

          {/* Link dependencies information footer */}
          <div className="pt-3 border-t border-zinc-800/40 text-[10px] text-zinc-500 flex justify-between items-center">
            <span className="flex items-center">
              <Network size={12} className="mr-1 text-zinc-500" />
              Showing active connection map links generated from Integrations.
            </span>
            <a href="/risks" className="text-zinc-400 hover:text-zinc-200 font-semibold flex items-center cursor-pointer transition-colors">
              Assess Risk Matrix <ArrowUpRight size={12} className="ml-0.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}



