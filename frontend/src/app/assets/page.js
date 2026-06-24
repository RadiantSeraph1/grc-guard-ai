"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Database, Server, Laptop, Code, ToggleLeft, ToggleRight } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Skeleton, EmptyState, SearchInput,
} from "../components/ui";

function assetIcon(type) {
  switch (String(type || "").toUpperCase()) {
    case "CLOUD RESOURCE": return <Server size={16} />;
    case "WORKSTATION": return <Laptop size={16} />;
    case "REPOSITORY": return <Code size={16} />;
    default: return <Database size={16} />;
  }
}

export default function AssetsPage() {
  const api = useApi();
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);

  const fetchAssets = useCallback(async () => {
    try {
      const data = await api.get("/api/assets");
      setAssets(Array.isArray(data) ? data : []);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const handleToggleScope = async (id, currentScope) => {
    setTogglingId(id);
    try {
      await api.post(`/api/assets/${id}/scope`, { is_in_scope: !currentScope });
      await fetchAssets();
    } catch (err) {
      console.error("Scope toggle failed", err);
    } finally {
      setTogglingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return assets.filter((a) => a.name?.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q));
  }, [assets, search]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Inventory Management"
        title="Asset Inventory"
        description="Catalog workstations, repositories, SaaS apps, and cloud database segments — and scope them for compliance."
      />

      <Card>
        <SearchInput className="max-w-md" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset register…" />
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Database}
            title={assets.length === 0 ? "No assets registered" : "No assets match your search"}
            description={assets.length === 0 ? "Connect integrations or add assets to build your inventory." : "Try a different search term."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-zinc-900/40 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-5 font-semibold">Asset</th>
                  <th className="py-3.5 px-5 w-40 font-semibold">Type</th>
                  <th className="py-3.5 px-5 w-32 font-semibold">Source</th>
                  <th className="py-3.5 px-5 w-28 font-semibold">Scoping</th>
                  <th className="py-3.5 px-5 w-28 font-semibold">Compliance</th>
                  <th className="py-3.5 px-5 w-24 text-center font-semibold">Scope</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 text-zinc-400 shrink-0">
                          {assetIcon(item.type)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-200 truncate">{item.name}</div>
                          <span className="text-xs text-zinc-500 font-mono">ID: {item.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-zinc-400 font-medium uppercase text-xs tracking-wide">{item.type}</td>
                    <td className="py-3.5 px-5 text-zinc-400 font-mono text-xs uppercase">{item.integration_id || "Manual"}</td>
                    <td className="py-3.5 px-5">
                      <Badge variant={item.is_in_scope ? "neutral" : "neutral"}>{item.is_in_scope ? "In Scope" : "Scoped Out"}</Badge>
                    </td>
                    <td className="py-3.5 px-5">
                      {item.is_in_scope ? (
                        <Badge variant={item.compliance_status === "Passing" ? "success" : "danger"}>{item.compliance_status}</Badge>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => handleToggleScope(item.id, item.is_in_scope)}
                          disabled={togglingId === item.id}
                          className="text-zinc-500 hover:text-zinc-200 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
                          title="Toggle scope"
                        >
                          {item.is_in_scope ? <ToggleRight size={24} className="text-indigo-400" /> : <ToggleLeft size={24} className="text-zinc-700" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
