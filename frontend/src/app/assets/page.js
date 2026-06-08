"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  Database, Server, Laptop, Code, Radio, Search, Check, 
  RotateCw, PlusCircle, AlertCircle, X, ShieldAlert,
  ToggleLeft, ToggleRight, Eye
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function AssetsPage() {
  const { getToken } = useAuth();
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);

  const fetchAssets = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/assets`, { headers });
      const data = await res.json();
      setAssets(data);
    } catch (err) {
      console.warn("Using fallback local asset register.");
      setAssets([
        { id: "asset-01", name: "Production Ledger RDS Cluster", type: "Cloud Resource", owner_id: "user_admin", compliance_status: "Failing", is_in_scope: true, integration_id: "aws" },
        { id: "asset-02", name: "Corporate Git Repo grc-core", type: "Repository", owner_id: "user_editor", compliance_status: "Failing", is_in_scope: true, integration_id: "github" },
        { id: "asset-03", name: "Workstation MAC-0239", type: "Workstation", owner_id: "user_employee", compliance_status: "Passing", is_in_scope: true, integration_id: "jamf" },
        { id: "asset-04", name: "Internal Payroll SaaS", type: "SaaS App", owner_id: "user_employee2", compliance_status: "Passing", is_in_scope: false, integration_id: "workday" }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const handleToggleScope = async (id, currentScope) => {
    setTogglingId(id);
    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const res = await fetch(`${API_BASE_URL}/api/assets/${id}/scope`, {
        method: "POST",
        headers,
        body: JSON.stringify({ is_in_scope: !currentScope })
      });
      const data = await res.json();
      if (data.status === "success") {
        fetchAssets();
      }
    } catch (err) {
      // offline fallback
      setAssets(prev => prev.map(a => a.id === id ? { ...a, is_in_scope: !currentScope } : a));
    } finally {
      setTogglingId(null);
    }
  };

  const getAssetIcon = (type) => {
    switch (type.toUpperCase()) {
      case "CLOUD RESOURCE": return <Server size={16} />;
      case "WORKSTATION": return <Laptop size={16} />;
      case "REPOSITORY": return <Code size={16} />;
      default: return <Database size={16} />;
    }
  };

  const filtered = assets.filter(a => 
    a.name.toLowerCase().includes(search.toLowerCase()) || 
    a.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Inventory Management</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Asset Inventory</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Catalog corporate hardware workstations, repository codebases, SaaS applications, and cloud ledger DB segments.
        </p>
      </div>

      {/* Filter panel */}
      <div className="flex flex-col md:flex-row gap-4 justify-between bg-[#121215] border border-zinc-800/80 p-4 rounded-xl">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3.5 top-3 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset register..."
            className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg pl-10 pr-4 py-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
          />
        </div>
      </div>

      {/* Table grid */}
      <div className="bg-[#121215] border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-zinc-900/30 border-b border-zinc-800 text-zinc-500 uppercase tracking-wider font-semibold">
              <th className="py-4 px-6">Asset Name</th>
              <th className="py-4 px-6 w-44">Type</th>
              <th className="py-4 px-6 w-32">Source</th>
              <th className="py-4 px-6 w-32">Scoping</th>
              <th className="py-4 px-6 w-32">Compliance</th>
              <th className="py-4 px-6 w-28 text-center">Toggle Scope</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/20 transition-colors">
                <td className="py-4 px-6 flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800/80 text-zinc-400">
                    {getAssetIcon(item.type)}
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-200">{item.name}</div>
                    <span className="text-[10px] text-zinc-500">ID: {item.id}</span>
                  </div>
                </td>
                <td className="py-4 px-6 text-zinc-450 font-semibold uppercase text-[10px] tracking-wide">
                  {item.type}
                </td>
                <td className="py-4 px-6 text-zinc-450 font-mono text-[10px] uppercase">
                  {item.integration_id || "Manual"}
                </td>
                <td className="py-4 px-6">
                  {item.is_in_scope ? (
                    <span className="inline-flex items-center text-[10px] font-semibold text-zinc-300 bg-zinc-800 border border-zinc-700/60 py-0.5 px-2.5 rounded uppercase tracking-wide">
                      In Scope
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[10px] font-semibold text-zinc-500 bg-zinc-900 border border-zinc-800 py-0.5 px-2.5 rounded uppercase tracking-wide">
                      Scoped Out
                    </span>
                  )}
                </td>
                <td className="py-4 px-6">
                  {item.is_in_scope ? (
                    <span className={`inline-flex items-center text-[10px] font-semibold py-0.5 px-2.5 rounded uppercase ${
                      item.compliance_status === "Passing" 
                        ? "text-emerald-450 bg-emerald-500/10 border border-emerald-500/15"
                        : "text-rose-450 bg-rose-500/10 border border-rose-500/15"
                    }`}>
                      {item.compliance_status}
                    </span>
                  ) : (
                    <span className="text-zinc-650">—</span>
                  )}
                </td>
                <td className="py-4 px-6">
                  <div className="flex items-center justify-center">
                    <button
                      onClick={() => handleToggleScope(item.id, item.is_in_scope)}
                      disabled={togglingId === item.id}
                      className="text-zinc-500 hover:text-zinc-200 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
                    >
                      {item.is_in_scope ? (
                        <ToggleRight size={22} className="text-zinc-300" />
                      ) : (
                        <ToggleLeft size={22} className="text-zinc-700" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



