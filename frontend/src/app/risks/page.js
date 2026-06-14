"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  AlertTriangle, Shield, CheckCircle, Search, Edit2, Plus,
  X, Check, AlertCircle, Info, Link as LinkIcon
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function RisksPage() {
  const { getToken } = useAuth();
  const [risks, setRisks] = useState([]);
  const [controls, setControls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCell, setSelectedCell] = useState(null); // {likelihood, impact}
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [editingRisk, setEditingRisk] = useState(null);
  const [newLikelihood, setNewLikelihood] = useState(3);
  const [newImpact, setNewImpact] = useState(3);
  const [newStatus, setNewStatus] = useState("Open");
  const [linkingRisk, setLinkingRisk] = useState(null);
  const [selectedControlId, setSelectedControlId] = useState("");

  const fetchData = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      
      const riskRes = await fetch(`${API_BASE_URL}/api/risks`, { headers });
      if (!riskRes.ok) throw new Error(`HTTP ${riskRes.status}`);
      const riskData = await riskRes.json();
      setRisks(Array.isArray(riskData) ? riskData : []);

      const ctrlRes = await fetch(`${API_BASE_URL}/api/controls`, { headers });
      const ctrlData = ctrlRes.ok ? await ctrlRes.json() : [];
      setControls(Array.isArray(ctrlData) ? ctrlData : []);
    } catch (err) {
      console.warn("Risks unavailable; no risks have been registered yet.");
      setRisks([]);
      setControls([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateRisk = async (e) => {
    e.preventDefault();
    if (!editingRisk) return;
    
    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const payload = {
        id: editingRisk.id,
        likelihood: parseInt(newLikelihood),
        impact: parseInt(newImpact),
        status: newStatus
      };
      
      const res = await fetch(`${API_BASE_URL}/api/risks`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === "success") {
        setEditingRisk(null);
        fetchData();
      }
    } catch (err) {
      // Offline fallback
      setRisks(prev => prev.map(r => r.id === editingRisk.id ? { 
        ...r, 
        likelihood: newLikelihood, 
        impact: newImpact, 
        status: newStatus,
        inherent_score: newLikelihood * newImpact,
        residual_score: Math.max(1, (newLikelihood * newImpact) - (r.mitigations.length * 2))
      } : r));
      setEditingRisk(null);
    }
  };

  const handleLinkMitigation = async (e) => {
    e.preventDefault();
    if (!linkingRisk || !selectedControlId) return;

    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const res = await fetch(`${API_BASE_URL}/api/risks/${linkingRisk.id}/mitigate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ control_id: selectedControlId })
      });
      const data = await res.json();
      if (data.status === "success") {
        setLinkingRisk(null);
        setSelectedControlId("");
        fetchData();
      }
    } catch (err) {
      // Offline fallback
      const ctrl = controls.find(c => c.id === selectedControlId);
      setRisks(prev => prev.map(r => {
        if (r.id === linkingRisk.id) {
          const exists = r.mitigations.some(m => m.id === selectedControlId);
          const newMits = exists ? r.mitigations : [...r.mitigations, { id: ctrl.id, control_code: ctrl.control_code }];
          return {
            ...r,
            mitigations: newMits,
            residual_score: Math.max(1, r.inherent_score - (newMits.length * 2))
          };
        }
        return r;
      }));
      setLinkingRisk(null);
      setSelectedControlId("");
    }
  };

  // 5x5 Risk Cell count parser
  const getCellCount = (likelihood, impact) => {
    return risks.filter(r => r.likelihood === likelihood && r.impact === impact).length;
  };

  const getRiskLabelColor = (score) => {
    if (score >= 15) return "text-rose-500 bg-rose-500/10 border-rose-500/20";
    if (score >= 8) return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  };

  // Filter pipeline
  let filtered = risks;
  if (selectedCell) {
    filtered = filtered.filter(r => r.likelihood === selectedCell.likelihood && r.impact === selectedCell.impact);
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r => r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }
  if (categoryFilter !== "ALL") {
    filtered = filtered.filter(r => r.category.toUpperCase() === categoryFilter);
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Risk Management</span>
          <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Risk Register</h2>
          <p className="text-zinc-400 text-xs mt-0.5">
            Conduct risk assessments, track inherent versus residual scores, and map controls as mitigations.
          </p>
        </div>
      </div>

      {/* Main split: Left col Heatmap, Right col Registry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Risk Heatmap Matrix */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 shadow-sm space-y-6 h-fit">
          <div>
            <h3 className="font-semibold text-zinc-200 text-base">Inherent Risk Heatmap</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Click cells to filter the register by severity.</p>
          </div>

          <div className="flex flex-col space-y-1 select-none">
            {[5, 4, 3, 2, 1].map((impact) => (
              <div key={impact} className="flex items-center space-x-1">
                {/* Y Axis Label */}
                <span className="w-5 text-center text-[10px] font-bold text-zinc-500">{impact}</span>
                
                {[1, 2, 3, 4, 5].map((likelihood) => {
                  const score = impact * likelihood;
                  const count = getCellCount(likelihood, impact);
                  const isSelected = selectedCell?.likelihood === likelihood && selectedCell?.impact === impact;
                  
                  let bgClass = "bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10";
                  if (score >= 15) bgClass = "bg-rose-500/15 border-rose-500/25 hover:bg-rose-500/25 text-rose-350";
                  else if (score >= 8) bgClass = "bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20 text-yellow-350";

                  if (isSelected) bgClass += " ring-2 ring-zinc-500 border-transparent scale-105";

                  return (
                    <div 
                      key={likelihood}
                      onClick={() => {
                        if (isSelected) setSelectedCell(null); // Clear filter
                        else setSelectedCell({ likelihood, impact });
                      }}
                      className={`flex-1 aspect-square rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer transition-all ${bgClass}`}
                    >
                      {count > 0 ? (
                        <span className="w-6 h-6 rounded-full bg-[#09090b] border border-zinc-800 flex items-center justify-center font-bold text-xs text-zinc-200 shadow-sm">
                          {count}
                        </span>
                      ) : ""}
                    </div>
                  );
                })}
              </div>
            ))}
            
            {/* X Axis labels */}
            <div className="flex items-center space-x-1 pt-2">
              <span className="w-5" />
              {[1, 2, 3, 4, 5].map((l) => (
                <span key={l} className="flex-1 text-center text-[10px] font-bold text-zinc-500">{l}</span>
              ))}
            </div>
            <div className="text-center text-[9px] font-bold text-zinc-650 tracking-wider mt-2 uppercase">
              Likelihood → (Inherent Threat Matrix)
            </div>
          </div>

          {selectedCell && (
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-400">
              <span>Filtering: Likelihood {selectedCell.likelihood} × Impact {selectedCell.impact}</span>
              <button 
                onClick={() => setSelectedCell(null)}
                className="font-bold underline uppercase tracking-wider text-[10px] cursor-pointer hover:text-zinc-200"
              >
                Clear Filter
              </button>
            </div>
          )}
        </div>

        {/* Risk Registry Table */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between bg-[#121215] border border-zinc-800/80 p-4 rounded-xl">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-3 text-zinc-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search risk register..."
                className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg pl-10 pr-4 py-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
              />
            </div>
            <div className="flex items-center space-x-2 bg-[#09090b] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs">
              <span className="text-zinc-500">Category:</span>
              <select 
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-transparent text-zinc-350 font-semibold border-none focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Categories</option>
                <option value="REGULATORY">Regulatory</option>
                <option value="CYBER">Cyber</option>
                <option value="OPERATIONAL">Operational</option>
                <option value="COMPLIANCE">Compliance</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-900/30 border-b border-zinc-800 text-zinc-500 uppercase tracking-wider font-semibold">
                  <th className="py-4 px-5">Risk Title</th>
                  <th className="py-4 px-5 w-24 text-center">Inherent</th>
                  <th className="py-4 px-5 w-24 text-center">Residual</th>
                  <th className="py-4 px-5 w-36">Mitigations</th>
                  <th className="py-4 px-5 w-28">Status</th>
                  <th className="py-4 px-5 w-24 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/20 transition-colors">
                    <td className="py-4 px-5 space-y-1">
                      <div className="font-semibold text-zinc-200">{r.title}</div>
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{r.category}</span>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className={`py-0.5 px-2 rounded font-semibold ${getRiskLabelColor(r.inherent_score)}`}>
                        {r.inherent_score}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className={`py-0.5 px-2 rounded font-semibold ${getRiskLabelColor(r.residual_score)}`}>
                        {r.residual_score}
                      </span>
                    </td>
                    <td className="py-4 px-5 space-y-1">
                      {r.mitigations?.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {r.mitigations.map((m) => (
                            <span key={m.id} className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 font-semibold py-0.5 px-2 rounded">
                              {m.control_code}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-rose-450 font-medium">Unmitigated</span>
                      )}
                    </td>
                    <td className="py-4 px-5">
                      <span className={`text-[10px] font-semibold py-0.5 px-2 rounded ${
                        r.status === "Mitigated" 
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15" 
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/15"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex items-center justify-center space-x-2">
                        <button
                          onClick={() => {
                            setEditingRisk(r);
                            setNewLikelihood(r.likelihood);
                            setNewImpact(r.impact);
                            setNewStatus(r.status);
                          }}
                          className="text-zinc-550 hover:text-zinc-200 p-1 hover:bg-zinc-900 rounded cursor-pointer transition-colors"
                          title="Score Assessment"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => setLinkingRisk(r)}
                          className="text-zinc-550 hover:text-zinc-200 p-1 hover:bg-zinc-900 rounded cursor-pointer transition-colors"
                          title="Link Mitigations"
                        >
                          <LinkIcon size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Editing score modal */}
      {editingRisk && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl max-w-sm w-full p-6 shadow-2xl space-y-6 relative">
            <button 
              onClick={() => setEditingRisk(null)}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-1">
              <h3 className="font-semibold text-zinc-200 text-lg">Assess Risk Score</h3>
              <p className="text-zinc-400 text-xs truncate">{editingRisk.title}</p>
            </div>

            <form onSubmit={handleUpdateRisk} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Likelihood</label>
                  <select
                    value={newLikelihood}
                    onChange={(e) => setNewLikelihood(e.target.value)}
                    className="w-full bg-[#09090b] border border-zinc-800 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none focus:border-zinc-500"
                  >
                    {[1, 2, 3, 4, 5].map((i) => (
                      <option key={i} value={i}>{i} - {i === 1 ? "Rare" : i === 5 ? "Almost Certain" : "Medium"}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Impact</label>
                  <select
                    value={newImpact}
                    onChange={(e) => setNewImpact(e.target.value)}
                    className="w-full bg-[#09090b] border border-zinc-800 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none focus:border-zinc-500"
                  >
                    {[1, 2, 3, 4, 5].map((i) => (
                      <option key={i} value={i}>{i} - {i === 1 ? "Negligible" : i === 5 ? "Critical/Catastrophic" : "Medium"}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-800 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none focus:border-zinc-500"
                >
                  <option value="Open">Open</option>
                  <option value="Mitigated">Mitigated</option>
                  <option value="Accepted">Accepted / Signed-Off</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-medium py-2 px-4 rounded-lg cursor-pointer text-xs active:scale-95 transition-all shadow-sm"
              >
                Save Assessment Score
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Link Mitigations Modal */}
      {linkingRisk && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl max-w-sm w-full p-6 shadow-2xl space-y-6 relative">
            <button 
              onClick={() => { setLinkingRisk(null); setSelectedControlId(""); }}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-1">
              <h3 className="font-semibold text-zinc-200 text-lg">Map Mitigation Control</h3>
              <p className="text-zinc-400 text-xs truncate">{linkingRisk.title}</p>
            </div>

            <form onSubmit={handleLinkMitigation} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Select Mitigating Control</label>
                <select
                  value={selectedControlId}
                  onChange={(e) => setSelectedControlId(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-800 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none focus:border-zinc-500"
                >
                  <option value="">-- Choose Control --</option>
                  {controls.map((c) => (
                    <option key={c.id} value={c.id}>[{c.control_code}] {c.title}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2 text-[10px] text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/80">
                <Info size={14} className="shrink-0 text-zinc-500" />
                <span>Linking a control mitigates inherent risk, dynamically lowering the residual threat level.</span>
              </div>

              <button
                type="submit"
                disabled={!selectedControlId}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-medium py-2.5 px-4 rounded-lg cursor-pointer text-xs active:scale-95 transition-all shadow-sm disabled:bg-zinc-900 disabled:text-zinc-500 disabled:cursor-not-allowed"
              >
                Link Control & Recalculate
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}



