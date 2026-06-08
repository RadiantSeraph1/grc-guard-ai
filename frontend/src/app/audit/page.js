"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  Scale, Download, MessageSquare, Send, CheckCircle2, 
  HelpCircle, Eye, ShieldAlert, ArrowDownToLine, Clock, User
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function AuditPage() {
  const { getToken } = useAuth();
  const [controls, setControls] = useState([]);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("FULL"); // FULL, CONTROLLED, IRL
  const [activeControl, setActiveControl] = useState(null);
  
  // Comment inputs
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/controls`, { headers });
      const ctrlData = await res.json();
      setControls(ctrlData);
      
      if (ctrlData.length > 0) {
        setActiveControl(ctrlData[0]);
        fetchComments(ctrlData[0].id);
      }
    } catch (err) {
      console.warn("FastAPI offline, loading baseline placeholders.");
      setControls([
        { id: "basel-iii-01", control_code: "BASEL-CAP-01", title: "CET1 Capital Adequacy Ratio", status: "Passing" },
        { id: "gdpr-01", control_code: "GDPR-PII-01", title: "Database Encryption at Rest", status: "Failing" }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async (ctrlId) => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/audit/comments?control_id=${ctrlId}`, { headers });
      const data = await res.json();
      setComments(prev => ({ ...prev, [ctrlId]: data }));
    } catch (err) {
      // offline fallback
      setComments(prev => ({ 
        ...prev, 
        [ctrlId]: [
          { id: "1", sender_name: "Sarah Jenkins (Auditor)", comment_text: "Please supply the latest snapshot verifying encryption configuration on your production database.", timestamp: intTime() - 3600 }
        ] 
      }));
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const intTime = () => Math.floor(Date.now() / 1000);

  const handleSendComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !activeControl) return;
    setSubmitting(true);

    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const payload = {
        control_id: activeControl.id,
        comment_text: newComment
      };
      
      const res = await fetch(`${API_BASE_URL}/api/audit/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === "success") {
        setNewComment("");
        fetchComments(activeControl.id);
      }
    } catch (err) {
      // offline fallback
      setComments(prev => ({
        ...prev,
        [activeControl.id]: [
          ...(prev[activeControl.id] || []),
          {
            id: Math.random().toString(),
            sender_name: "Alex Carter (Admin)",
            comment_text: newComment,
            timestamp: intTime()
          }
        ]
      }));
      setNewComment("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadBundle = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/audit/bundle`, { headers });
      const data = await res.json();
      alert(`Audit Bundle generated: ${data.bundle_id}. Downloading files...`);
    } catch (err) {
      alert("Failed to download bundle. Backend is offline.");
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Compliance Assurance</span>
          <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Auditor Portal</h2>
          <p className="text-zinc-400 text-xs mt-0.5">
            Provide external regulatory assessors with scoped access, evidence downloads, and comment threads.
          </p>
        </div>
        <div>
          <button
            onClick={handleDownloadBundle}
            className="flex items-center space-x-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-1.5 px-3.5 rounded-lg cursor-pointer text-xs shadow-sm active:scale-95 transition-all"
          >
            <Download size={14} />
            <span>Download Evidence Bundle</span>
          </button>
        </div>
      </div>

      {/* View configuration bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between bg-[#121215] border border-zinc-800/80 p-4 rounded-xl items-center">
        <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wide">Configure Auditor View Limits:</span>
        <div className="flex space-x-3">
          {["FULL", "CONTROLLED", "IRL"].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`py-1 px-4 text-xs font-semibold rounded-lg cursor-pointer transition-all ${
                viewMode === mode 
                  ? "bg-zinc-800 text-zinc-250 border border-zinc-750 shadow-sm" 
                  : "bg-zinc-900 border border-zinc-800 text-zinc-450 hover:text-zinc-200"
              }`}
            >
              {mode === "FULL" && "Full Ledger"}
              {mode === "CONTROLLED" && "Approved Only"}
              {mode === "IRL" && "IRL View Mode"}
            </button>
          ))}
        </div>
      </div>

      {/* Main split: Left controls list, Right thread logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Controls menu */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm h-fit">
          <div className="p-4 border-b border-zinc-800/60 bg-zinc-900/30">
            <h3 className="font-semibold text-zinc-200 text-sm">Monitored Controls</h3>
          </div>
          <div className="divide-y divide-zinc-850">
            {controls.map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  setActiveControl(c);
                  fetchComments(c.id);
                }}
                className={`p-4 cursor-pointer transition-all flex items-center justify-between text-xs ${
                  activeControl?.id === c.id 
                    ? "bg-zinc-800/30 text-zinc-200 font-semibold border-l-2 border-l-zinc-300" 
                    : "hover:bg-zinc-900/10 text-zinc-300"
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-mono font-semibold text-zinc-200">{c.control_code}</div>
                  <div className="truncate max-w-[160px] text-zinc-400">{c.title}</div>
                </div>
                <span className={`text-[9px] font-semibold py-0.5 px-2 rounded uppercase ${
                  c.status === "Passing" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-450"
                }`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Auditor Discussions & files download */}
        {activeControl ? (
          <div className="lg:col-span-2 bg-[#121215] border border-zinc-800/80 rounded-xl p-6 shadow-sm flex flex-col justify-between space-y-6">
            
            {/* Header info */}
            <div className="border-b border-zinc-800/60 pb-4 flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="font-semibold text-zinc-200 text-base">[{activeControl.control_code}] {activeControl.title}</h3>
                <p className="text-xs text-zinc-500">Collaborative audit thread for compliance checks.</p>
              </div>
              <button
                onClick={() => alert(`Downloading evidence bundle for ${activeControl.control_code}...`)}
                className="text-zinc-250 hover:text-zinc-150 border border-zinc-800 bg-zinc-900 py-1.5 px-3 rounded-lg hover:bg-zinc-800 text-xs font-semibold flex items-center cursor-pointer"
              >
                <ArrowDownToLine size={13} className="mr-1 text-zinc-450" />
                Fetch Evidence
              </button>
            </div>

            {/* Conversation Log */}
            <div className="flex-1 min-h-[200px] max-h-[300px] overflow-y-auto space-y-4 pr-1 custom-scrollbar">
              {!(comments[activeControl.id]) || comments[activeControl.id].length === 0 ? (
                <div className="py-8 text-center text-zinc-650 text-xs flex flex-col items-center justify-center space-y-1">
                  <MessageSquare size={24} className="text-zinc-800" />
                  <span>No auditor comments registered for this control yet.</span>
                </div>
              ) : (
                comments[activeControl.id].map((comm) => (
                  <div key={comm.id} className="flex flex-col space-y-1 bg-zinc-900/40 p-3.5 rounded-xl border border-zinc-850">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span className="font-semibold text-zinc-300 flex items-center">
                        <User size={10} className="mr-1 text-zinc-400" />
                        {comm.sender_name}
                      </span>
                      <span className="flex items-center">
                        <Clock size={10} className="mr-1" />
                        {new Date(comm.timestamp * 1000).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-zinc-200 leading-relaxed text-xs">{comm.comment_text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Message input Form */}
            <form onSubmit={handleSendComment} className="flex items-center space-x-2 pt-4 border-t border-zinc-850">
              <input
                type="text"
                required
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Submit audit clarification or link evidence snapshot..."
                className="flex-1 bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg px-4.5 py-2.5 text-xs focus:outline-none transition-all placeholder-zinc-650"
              />
              <button
                type="submit"
                disabled={submitting || !newComment.trim()}
                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold p-2.5 rounded-lg cursor-pointer active:scale-95 transition-all disabled:opacity-50"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        ) : (
          <div className="lg:col-span-2 bg-[#121215] border border-zinc-800/80 rounded-xl p-12 text-center text-zinc-500 text-xs flex flex-col items-center justify-center space-y-3 h-full">
            <HelpCircle size={32} className="text-zinc-650" />
            <h4 className="font-semibold text-zinc-200 text-sm">No Active Control Selected</h4>
          </div>
        )}
      </div>
    </div>
  );
}



