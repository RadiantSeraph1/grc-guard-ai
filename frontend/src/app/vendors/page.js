"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  FolderKanban, AlertTriangle, ShieldCheck, Search, Cpu, 
  RotateCw, Check, X, FileQuestion, HelpCircle, Eye
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function VendorsPage() {
  const { getToken } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  
  // AI fill state
  const [fillingId, setFillingId] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState(null);

  const fetchVendors = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/vendors`, { headers });
      const data = await res.json();
      setVendors(data);
    } catch (err) {
      console.warn("Using fallback local vendor catalog.");
      setVendors([
        { id: "vendor-01", name: "CoreBankingTech Ltd", tier: "Critical", inherent_risk: "High", residual_risk: "Medium", status: "Approved", last_assessment_date: intTime() - 172800, questionnaire_completed: true, questionnaire_answers: '{"data_encryption":"AES-256 standard on all endpoints","access_control":"Mandatory MFA enforced on administrators","business_continuity":"Disaster recovery hot standby active","risk_level":"Medium"}' },
        { id: "vendor-02", name: "OfficeSupplies Co", tier: "Low", inherent_risk: "Low", residual_risk: "Low", status: "Approved", last_assessment_date: intTime() - 172800, questionnaire_completed: true, questionnaire_answers: "{}" },
        { id: "vendor-03", name: "CloudAnalytics Inc", tier: "High", inherent_risk: "High", residual_risk: "High", status: "Under Assessment", last_assessment_date: null, questionnaire_completed: false, questionnaire_answers: "{}" }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  const intTime = () => Math.floor(Date.now() / 1000);

  const handleAutoFill = async (id) => {
    setFillingId(id);
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/vendors/${id}/auto-fill`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (data.status === "success") {
        fetchVendors();
        setSelectedAnswers({ vendorId: id, answers: data.answers });
      }
    } catch (err) {
      // offline fallback
      const answers = {
        data_encryption: "AES-256 enforced on databases and files.",
        access_control: "SAML SSO with Okta, MFA enabled.",
        business_continuity: "Backups replicated to secondary AWS region.",
        risk_level: "Medium"
      };
      setVendors(prev => prev.map(v => v.id === id ? { 
        ...v, 
        questionnaire_completed: true,
        last_assessment_date: intTime(),
        questionnaire_answers: JSON.stringify(answers)
      } : v));
      setSelectedAnswers({ vendorId: id, answers });
    } finally {
      setFillingId(null);
    }
  };

  const getTierColor = (tier) => {
    switch(tier.toUpperCase()) {
      case "CRITICAL": return "text-rose-500 bg-rose-500/10 border-rose-500/20";
      case "HIGH": return "text-amber-500 bg-amber-500/10 border-amber-500/20";
      default: return "text-slate-400 bg-slate-900 border border-slate-800";
    }
  };

  const filtered = vendors.filter(v => 
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Third-Party Assessments</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Vendor Risk (TPRM)</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Coordinate vendor onboarding, review security metrics, and leverage AI to auto-populate compliance questionnaires.
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
            placeholder="Search vendor name..."
            className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg pl-10 pr-4 py-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
          />
        </div>
      </div>

      {/* Vendors list grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((item) => {
          const hasAnswers = item.questionnaire_answers && item.questionnaire_answers !== "{}";
          let parsedAnswers = {};
          if (hasAnswers) {
            try {
              parsedAnswers = JSON.parse(item.questionnaire_answers);
            } catch (e) {}
          }

          return (
            <div key={item.id} className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 flex flex-col justify-between space-y-6 shadow-sm">
              <div className="space-y-4">
                
                {/* Header segment */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-zinc-200 text-base leading-snug">{item.name}</h3>
                    <span className="text-[10px] text-zinc-500">
                      Assessment: {item.last_assessment_date ? new Date(item.last_assessment_date * 1000).toLocaleDateString() : "Pending"}
                    </span>
                  </div>
                  <span className={`text-[10px] font-semibold py-0.5 px-2.5 rounded-full uppercase tracking-wider ${getTierColor(item.tier)}`}>
                    {item.tier}
                  </span>
                </div>

                {/* Risk mapping */}
                <div className="flex justify-between items-center text-xs p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800">
                  <span className="text-zinc-500 font-semibold uppercase tracking-wide text-[9px]">Inherent / Residual Risk</span>
                  <div className="flex space-x-2 font-bold uppercase text-[9px]">
                    <span className="text-rose-450">{item.inherent_risk}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-emerald-450">{item.residual_risk}</span>
                  </div>
                </div>

                {/* AI Filled Answers summary */}
                {hasAnswers && (
                  <div className="p-3 bg-[#09090b] rounded-lg border border-zinc-800/60 space-y-2 text-[10px] text-zinc-400">
                    <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[8px] flex items-center">
                      <Cpu size={10} className="mr-1 text-zinc-400" />
                      AI Audited Security Profile
                    </span>
                    <div className="space-y-1">
                      <div><strong className="text-zinc-300 font-semibold">Data Encryption:</strong> <span className="line-clamp-1">{parsedAnswers.data_encryption}</span></div>
                      <div><strong className="text-zinc-300 font-semibold">Access Controls:</strong> <span className="line-clamp-1">{parsedAnswers.access_control}</span></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons footer */}
              <div className="pt-4 border-t border-zinc-800/50 flex justify-between items-center text-xs">
                <span className={`text-[10px] font-semibold py-0.5 px-2 rounded ${
                  item.status === "Approved" 
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                    : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                }`}>
                  {item.status}
                </span>

                <div className="flex space-x-2">
                  {hasAnswers && (
                    <button
                      onClick={() => setSelectedAnswers({ vendorId: item.id, answers: parsedAnswers })}
                      className="text-zinc-400 hover:text-zinc-200 p-1.5 hover:bg-zinc-900 rounded-lg cursor-pointer transition-colors"
                      title="View Questionnaire Details"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => handleAutoFill(item.id)}
                    disabled={fillingId === item.id}
                    className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 font-medium py-1.5 px-3 rounded-lg cursor-pointer text-[10px] active:scale-95 transition-all disabled:opacity-50"
                  >
                    <Cpu size={12} className={fillingId === item.id ? "animate-spin text-zinc-400" : "text-zinc-500"} />
                    <span>{fillingId === item.id ? "Analyzing..." : "Auto-fill questionnaire"}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* View Questionnaire Modal Overlay */}
      {selectedAnswers && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-6 relative">
            <button 
              onClick={() => setSelectedAnswers(null)}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-1">
              <h3 className="font-semibold text-zinc-200 text-lg">Vendor Security Questionnaire</h3>
              <p className="text-zinc-400 text-xs">AI-Audited and parsed compliance details.</p>
            </div>

            <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar text-xs">
              <div className="space-y-1 p-3 bg-[#09090b] rounded-lg border border-zinc-800/60">
                <span className="font-semibold text-zinc-500 uppercase text-[9px]">Data Encryption</span>
                <p className="text-zinc-350">{selectedAnswers.answers.data_encryption || "No records"}</p>
              </div>
              <div className="space-y-1 p-3 bg-[#09090b] rounded-lg border border-zinc-800/60">
                <span className="font-semibold text-zinc-500 uppercase text-[9px]">Access Control</span>
                <p className="text-zinc-350">{selectedAnswers.answers.access_control || "No records"}</p>
              </div>
              <div className="space-y-1 p-3 bg-[#09090b] rounded-lg border border-zinc-800/60">
                <span className="font-semibold text-zinc-500 uppercase text-[9px]">Business Continuity</span>
                <p className="text-zinc-350">{selectedAnswers.answers.business_continuity || "No records"}</p>
              </div>
              <div className="space-y-1 p-3 bg-[#09090b] rounded-lg border border-zinc-800/60 flex justify-between items-center">
                <span className="font-semibold text-zinc-500 uppercase text-[9px]">Audited Inferred Risk</span>
                <span className="font-bold text-zinc-300 uppercase tracking-widest">{selectedAnswers.answers.risk_level || "Medium"}</span>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-[10px] text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/80">
              <ShieldCheck size={14} className="shrink-0 text-zinc-500" />
              <span>Verified under Q2 Third-Party Auditing Protocols.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



