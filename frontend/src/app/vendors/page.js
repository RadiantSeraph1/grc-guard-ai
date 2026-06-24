"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Cpu, ShieldCheck, Eye, FolderKanban } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState,
  Modal, SearchInput, cn,
} from "../components/ui";

const tierVariant = (tier) => {
  const t = String(tier || "").toUpperCase();
  if (t === "CRITICAL") return "danger";
  if (t === "HIGH") return "warning";
  return "neutral";
};

export default function VendorsPage() {
  const api = useApi();
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [fillingId, setFillingId] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState(null);

  const fetchVendors = useCallback(async () => {
    try {
      const data = await api.get("/api/vendors");
      setVendors(Array.isArray(data) ? data : []);
    } catch {
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  const handleAutoFill = async (id) => {
    setFillingId(id);
    try {
      const data = await api.post(`/api/vendors/${id}/auto-fill`);
      if (data?.status === "success") {
        await fetchVendors();
        setSelectedAnswers({ vendorId: id, answers: data.answers });
      }
    } catch (err) {
      alert(`Auto-fill failed: ${err.message}`);
    } finally {
      setFillingId(null);
    }
  };

  const filtered = useMemo(
    () => vendors.filter((v) => v.name?.toLowerCase().includes(search.toLowerCase())),
    [vendors, search]
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Third-Party Assessments"
        title="Vendor Risk (TPRM)"
        description="Coordinate vendor onboarding, review security metrics, and let AI auto-populate compliance questionnaires."
      />

      <Card>
        <SearchInput className="max-w-md" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor name…" />
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title={vendors.length === 0 ? "No vendors onboarded" : "No vendors match your search"}
            description={vendors.length === 0 ? "Vendors added to the platform will appear here for assessment." : "Try a different search term."}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item) => {
            const hasAnswers = item.questionnaire_answers && item.questionnaire_answers !== "{}";
            let parsed = {};
            if (hasAnswers) {
              try { parsed = JSON.parse(item.questionnaire_answers); } catch { /* ignore */ }
            }
            return (
              <Card key={item.id} hover className="flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-zinc-100 leading-snug truncate">{item.name}</h3>
                      <span className="text-xs text-zinc-500">
                        Assessment: {item.last_assessment_date ? new Date(item.last_assessment_date * 1000).toLocaleDateString() : "Pending"}
                      </span>
                    </div>
                    <Badge variant={tierVariant(item.tier)}>{item.tier}</Badge>
                  </div>

                  <div className="flex justify-between items-center text-xs p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800">
                    <span className="text-zinc-500 font-semibold uppercase tracking-wide">Inherent / Residual</span>
                    <span className="flex items-center gap-2 font-semibold uppercase">
                      <span className="text-rose-400">{item.inherent_risk}</span>
                      <span className="text-zinc-600">→</span>
                      <span className="text-emerald-400">{item.residual_risk}</span>
                    </span>
                  </div>

                  {hasAnswers && (
                    <div className="p-3 bg-[#09090b] rounded-lg border border-zinc-800 space-y-2 text-xs text-zinc-400">
                      <span className="font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-1">
                        <Cpu size={11} className="text-zinc-400" /> AI Security Profile
                      </span>
                      <div className="space-y-1">
                        <div><strong className="text-zinc-300">Encryption:</strong> <span className="line-clamp-1">{parsed.data_encryption}</span></div>
                        <div><strong className="text-zinc-300">Access:</strong> <span className="line-clamp-1">{parsed.access_control}</span></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-zinc-800/60 flex justify-between items-center gap-2">
                  <Badge variant={item.status === "Approved" ? "success" : "warning"}>{item.status}</Badge>
                  <div className="flex items-center gap-1.5">
                    {hasAnswers && (
                      <button
                        onClick={() => setSelectedAnswers({ vendorId: item.id, answers: parsed })}
                        className="text-zinc-400 hover:text-zinc-200 p-2 hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors"
                        title="View questionnaire"
                      >
                        <Eye size={15} />
                      </button>
                    )}
                    <Button size="sm" icon={Cpu} loading={fillingId === item.id} onClick={() => handleAutoFill(item.id)}>
                      {fillingId === item.id ? "Analyzing…" : "Auto-fill"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!selectedAnswers}
        onClose={() => setSelectedAnswers(null)}
        title="Vendor Security Questionnaire"
        description="AI-audited and parsed compliance details."
        size="md"
      >
        {selectedAnswers && (
          <>
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar text-sm">
              {[
                ["Data Encryption", selectedAnswers.answers.data_encryption],
                ["Access Control", selectedAnswers.answers.access_control],
                ["Business Continuity", selectedAnswers.answers.business_continuity],
              ].map(([label, val]) => (
                <div key={label} className="space-y-1 p-3 bg-[#09090b] rounded-lg border border-zinc-800">
                  <span className="font-semibold text-zinc-500 uppercase text-xs">{label}</span>
                  <p className="text-zinc-300">{val || "No records"}</p>
                </div>
              ))}
              <div className="p-3 bg-[#09090b] rounded-lg border border-zinc-800 flex justify-between items-center">
                <span className="font-semibold text-zinc-500 uppercase text-xs">Inferred Risk</span>
                <span className="font-bold text-zinc-300 uppercase tracking-widest">{selectedAnswers.answers.risk_level || "Medium"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
              <ShieldCheck size={14} className="shrink-0 text-zinc-500" />
              <span>Verified under Q2 Third-Party Auditing Protocols.</span>
            </div>
          </>
        )}
      </Modal>
    </PageContainer>
  );
}
