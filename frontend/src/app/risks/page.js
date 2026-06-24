"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Edit2, Info, Link as LinkIcon, ShieldAlert } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, CardHeader, Badge, Button, Skeleton,
  EmptyState, Modal, Field, Select, SearchInput, cn,
} from "../components/ui";

function scoreTone(score) {
  if (score >= 15) return "danger";
  if (score >= 8) return "warning";
  return "success";
}

const LIKELIHOOD_LABEL = { 1: "Rare", 5: "Almost Certain" };
const IMPACT_LABEL = { 1: "Negligible", 5: "Critical / Catastrophic" };

export default function RisksPage() {
  const api = useApi();
  const [risks, setRisks] = useState([]);
  const [controls, setControls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCell, setSelectedCell] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const [editingRisk, setEditingRisk] = useState(null);
  const [newLikelihood, setNewLikelihood] = useState(3);
  const [newImpact, setNewImpact] = useState(3);
  const [newStatus, setNewStatus] = useState("Open");
  const [linkingRisk, setLinkingRisk] = useState(null);
  const [selectedControlId, setSelectedControlId] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [riskData, ctrlData] = await api.getMany(["/api/risks", "/api/controls"], []);
      setRisks(Array.isArray(riskData) ? riskData : []);
      setControls(Array.isArray(ctrlData) ? ctrlData : []);
    } catch {
      setRisks([]);
      setControls([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpdateRisk = async (e) => {
    e.preventDefault();
    if (!editingRisk) return;
    setSaving(true);
    try {
      await api.post("/api/risks", {
        id: editingRisk.id,
        likelihood: parseInt(newLikelihood, 10),
        impact: parseInt(newImpact, 10),
        status: newStatus,
      });
      setEditingRisk(null);
      await fetchData();
    } catch (err) {
      console.error("Failed to update risk", err);
    } finally {
      setSaving(false);
    }
  };

  const handleLinkMitigation = async (e) => {
    e.preventDefault();
    if (!linkingRisk || !selectedControlId) return;
    setSaving(true);
    try {
      await api.post(`/api/risks/${linkingRisk.id}/mitigate`, { control_id: selectedControlId });
      setLinkingRisk(null);
      setSelectedControlId("");
      await fetchData();
    } catch (err) {
      console.error("Failed to link mitigation", err);
    } finally {
      setSaving(false);
    }
  };

  const getCellCount = (likelihood, impact) =>
    risks.filter((r) => r.likelihood === likelihood && r.impact === impact).length;

  const filtered = useMemo(() => {
    let list = risks;
    if (selectedCell) list = list.filter((r) => r.likelihood === selectedCell.likelihood && r.impact === selectedCell.impact);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.title?.toLowerCase().includes(q) || r.category?.toLowerCase().includes(q));
    }
    if (categoryFilter !== "ALL") list = list.filter((r) => r.category?.toUpperCase() === categoryFilter);
    return list;
  }, [risks, selectedCell, search, categoryFilter]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Risk Management"
        title="Risk Register"
        description="Assess risks, track inherent vs. residual scores, and map controls as mitigations."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Heatmap */}
        <Card className="h-fit space-y-5">
          <CardHeader title="Inherent Risk Heatmap" description="Click a cell to filter the register by severity." />
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="flex flex-col gap-1 select-none">
              {[5, 4, 3, 2, 1].map((impact) => (
                <div key={impact} className="flex items-center gap-1">
                  <span className="w-5 text-center text-xs font-bold text-zinc-600">{impact}</span>
                  {[1, 2, 3, 4, 5].map((likelihood) => {
                    const score = impact * likelihood;
                    const count = getCellCount(likelihood, impact);
                    const isSelected = selectedCell?.likelihood === likelihood && selectedCell?.impact === impact;
                    const tone =
                      score >= 15
                        ? "bg-rose-500/15 border-rose-500/25 hover:bg-rose-500/25"
                        : score >= 8
                        ? "bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20"
                        : "bg-emerald-500/10 border-emerald-500/15 hover:bg-emerald-500/20";
                    return (
                      <button
                        key={likelihood}
                        onClick={() => setSelectedCell(isSelected ? null : { likelihood, impact })}
                        title={`Impact ${impact} × Likelihood ${likelihood} (score ${score})`}
                        className={cn(
                          "flex-1 aspect-square rounded-lg border flex items-center justify-center cursor-pointer transition-all",
                          tone,
                          isSelected && "ring-2 ring-indigo-400 border-transparent scale-105"
                        )}
                      >
                        {count > 0 && (
                          <span className="w-6 h-6 rounded-full bg-[#09090b] border border-zinc-700 flex items-center justify-center font-bold text-xs text-zinc-100">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="flex items-center gap-1 pt-2">
                <span className="w-5" />
                {[1, 2, 3, 4, 5].map((l) => (
                  <span key={l} className="flex-1 text-center text-xs font-bold text-zinc-600">{l}</span>
                ))}
              </div>
              <div className="text-center text-[11px] font-semibold text-zinc-600 tracking-wider mt-2 uppercase">
                Likelihood →
              </div>
            </div>
          )}

          {selectedCell && (
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400">
              <span>Filtering L{selectedCell.likelihood} × I{selectedCell.impact}</span>
              <button onClick={() => setSelectedCell(null)} className="font-semibold uppercase tracking-wider text-indigo-300 hover:text-indigo-200 cursor-pointer">
                Clear
              </button>
            </div>
          )}
        </Card>

        {/* Register */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
            <SearchInput
              className="flex-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search risk register…"
            />
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="sm:w-48">
              <option value="ALL">All categories</option>
              <option value="REGULATORY">Regulatory</option>
              <option value="CYBER">Cyber</option>
              <option value="OPERATIONAL">Operational</option>
              <option value="COMPLIANCE">Compliance</option>
            </Select>
          </Card>

          <Card className="p-0 overflow-hidden">
            {loading ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title={risks.length === 0 ? "No risks registered" : "No risks match your filters"}
                description={risks.length === 0 ? "Risks created through the platform will appear here." : "Try clearing the search or category filter."}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-900/40 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                      <th className="py-3.5 px-5 font-semibold">Risk</th>
                      <th className="py-3.5 px-3 w-20 text-center font-semibold">Inherent</th>
                      <th className="py-3.5 px-3 w-20 text-center font-semibold">Residual</th>
                      <th className="py-3.5 px-5 w-40 font-semibold">Mitigations</th>
                      <th className="py-3.5 px-3 w-24 font-semibold">Status</th>
                      <th className="py-3.5 px-3 w-20 text-center font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                        <td className="py-3.5 px-5">
                          <div className="font-medium text-zinc-200">{r.title}</div>
                          <span className="text-xs text-zinc-500 uppercase tracking-wider">{r.category}</span>
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <Badge variant={scoreTone(r.inherent_score)}>{r.inherent_score}</Badge>
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <Badge variant={scoreTone(r.residual_score)}>{r.residual_score}</Badge>
                        </td>
                        <td className="py-3.5 px-5">
                          {r.mitigations?.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {r.mitigations.map((m) => (
                                <span key={m.id} className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-400 font-medium py-0.5 px-2 rounded font-mono">
                                  {m.control_code}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-rose-400 font-medium">Unmitigated</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <Badge variant={r.status === "Mitigated" ? "success" : r.status === "Accepted" ? "neutral" : "danger"}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => {
                                setEditingRisk(r);
                                setNewLikelihood(r.likelihood);
                                setNewImpact(r.impact);
                                setNewStatus(r.status);
                              }}
                              className="text-zinc-500 hover:text-zinc-200 p-1.5 hover:bg-zinc-800 rounded cursor-pointer transition-colors"
                              title="Score assessment"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => setLinkingRisk(r)}
                              className="text-zinc-500 hover:text-zinc-200 p-1.5 hover:bg-zinc-800 rounded cursor-pointer transition-colors"
                              title="Link mitigations"
                            >
                              <LinkIcon size={14} />
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
        </div>
      </div>

      {/* Score assessment modal */}
      <Modal open={!!editingRisk} onClose={() => setEditingRisk(null)} title="Assess Risk Score" description={editingRisk?.title}>
        <form onSubmit={handleUpdateRisk} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Likelihood">
              <Select value={newLikelihood} onChange={(e) => setNewLikelihood(e.target.value)}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <option key={i} value={i}>{i} — {LIKELIHOOD_LABEL[i] || "Medium"}</option>
                ))}
              </Select>
            </Field>
            <Field label="Impact">
              <Select value={newImpact} onChange={(e) => setNewImpact(e.target.value)}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <option key={i} value={i}>{i} — {IMPACT_LABEL[i] || "Medium"}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Status">
            <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              <option value="Open">Open</option>
              <option value="Mitigated">Mitigated</option>
              <option value="Accepted">Accepted / Signed-Off</option>
            </Select>
          </Field>
          <Button type="submit" variant="primary" loading={saving} className="w-full">Save assessment</Button>
        </form>
      </Modal>

      {/* Link mitigation modal */}
      <Modal
        open={!!linkingRisk}
        onClose={() => { setLinkingRisk(null); setSelectedControlId(""); }}
        title="Map Mitigation Control"
        description={linkingRisk?.title}
      >
        <form onSubmit={handleLinkMitigation} className="space-y-5">
          <Field label="Mitigating control">
            <Select value={selectedControlId} onChange={(e) => setSelectedControlId(e.target.value)}>
              <option value="">— Choose control —</option>
              {controls.map((c) => (
                <option key={c.id} value={c.id}>[{c.control_code}] {c.title}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-start gap-2 text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
            <Info size={14} className="shrink-0 text-zinc-500 mt-0.5" />
            <span>Linking a control mitigates inherent risk, dynamically lowering the residual threat level.</span>
          </div>
          <Button type="submit" variant="primary" loading={saving} disabled={!selectedControlId} className="w-full">
            Link control &amp; recalculate
          </Button>
        </form>
      </Modal>
    </PageContainer>
  );
}
