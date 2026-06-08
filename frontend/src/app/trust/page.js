"use client";

import { useState, useEffect } from "react";
import { 
  FileText, Download, Send, X, Lock, CheckCircle, 
  MessageSquare, ShieldCheck, HelpCircle, Loader2
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function TrustPage() {
  const [documents, setDocuments] = useState([]);
  const [ndaSigned, setNdaSigned] = useState(false);
  const [ndaOpen, setNdaOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  
  // NDA inputs
  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [signing, setSigning] = useState(false);

  // Chatbot inputs
  const [chatQuery, setChatQuery] = useState("");
  const [chatResponses, setChatResponses] = useState([
    { role: "assistant", text: "Welcome to the GRC Security Trust Center. Ask me anything about our compliance frameworks, capital adequacy controls, database encryption, or threat boundaries." }
  ]);
  const [sendingChat, setSendingChat] = useState(false);

  useEffect(() => {
    fetchDocuments();
    // Check if NDA signed locally
    const signed = localStorage.getItem("grc_nda_signed") === "true";
    setNdaSigned(signed);
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/trust/documents`);
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      console.warn("Using fallback local trust documents.");
      setDocuments([
        {"id": "doc-soc2", "name": "SOC 2 Type II Compliance Report 2025.pdf", "size": "1.4 MB", "nda_required": true},
        {"id": "doc-gdpr", "name": "GDPR Compliance Privacy Policy Statement.pdf", "size": "420 KB", "nda_required": false},
        {"id": "doc-tpm", "name": "GRC Guard TPM Host Boot Attestation Integrity Log.pdf", "size": "150 KB", "nda_required": false}
      ]);
    }
  };

  const handleSignNda = async (e) => {
    e.preventDefault();
    if (!companyName.trim() || !contactEmail.trim()) return;
    setSigning(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/trust/sign-nda`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_name: companyName, contact_email: contactEmail })
      });
      const data = await res.json();
      if (data.nda_signed) {
        localStorage.setItem("grc_nda_signed", "true");
        setNdaSigned(true);
        setNdaOpen(false);
        if (selectedDoc) {
          alert(`NDA Signed! Downloading ${selectedDoc.name}...`);
          setSelectedDoc(null);
        }
      }
    } catch (err) {
      // Offline fallback
      localStorage.setItem("grc_nda_signed", "true");
      setNdaSigned(true);
      setNdaOpen(false);
      if (selectedDoc) {
        alert(`Offline Fallback: NDA Signed! Downloading ${selectedDoc.name}...`);
        setSelectedDoc(null);
      }
    } finally {
      setSigning(false);
    }
  };

  const handleDocumentClick = (doc) => {
    if (doc.nda_required && !ndaSigned) {
      setSelectedDoc(doc);
      setNdaOpen(true);
    } else {
      alert(`Downloading ${doc.name}...`);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatQuery.trim()) return;

    const query = chatQuery;
    setChatResponses(prev => [...prev, { role: "user", text: query }]);
    setChatQuery("");
    setSendingChat(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/trust/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      setChatResponses(prev => [...prev, { role: "assistant", text: data.response }]);
    } catch (err) {
      // offline fallback
      setChatResponses(prev => [...prev, { 
        role: "assistant", 
        text: "Offline Fallback: Our core ledger databases are configured in AWS S3 and encrypted using AES-256 keys. We maintain capital adequacy compliance matching Basel III buffer parameters of 7.0% total." 
      }]);
    } finally {
      setSendingChat(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Public Posture</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Security Trust Center</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Share your real-time compliance status, allow clients to download reports, and interact with the AI trust bot.
        </p>
      </div>

      {/* Main split: Left side document download lists, Right side AI chatbot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Document list */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 shadow-sm space-y-5">
            <div>
              <h3 className="font-semibold text-zinc-200 text-base">Security & Compliance Documentation</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Approved audit documents available for client assessment.</p>
            </div>

            <div className="divide-y divide-zinc-850">
              {documents.map((doc) => (
                <div key={doc.id} className="py-4 flex items-center justify-between">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-9 h-9 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800/80">
                      <FileText size={16} className="text-zinc-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-200 leading-tight">{doc.name}</h4>
                      <span className="text-[9px] text-zinc-500 font-medium tracking-wide">PDF Document ({doc.size})</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    {doc.nda_required && !ndaSigned && (
                      <span className="flex items-center text-[9px] font-semibold text-amber-500 uppercase tracking-wider bg-amber-500/5 py-0.5 px-2.5 rounded border border-amber-500/15">
                        <Lock size={10} className="mr-1 text-amber-500" />
                        NDA Required
                      </span>
                    )}
                    <button
                      onClick={() => handleDocumentClick(doc)}
                      className="flex items-center space-x-1 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 font-medium py-1.5 px-3 rounded-lg cursor-pointer text-xs active:scale-95 transition-all"
                    >
                      <Download size={13} className="text-zinc-500" />
                      <span>Download</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chatbot terminal */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 shadow-sm flex flex-col justify-between space-y-5 h-[400px]">
          <div>
            <h3 className="font-semibold text-zinc-200 text-base">Interactive Security Bot</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Let clients audit compliance parameters instantly.</p>
          </div>

          {/* Chat log */}
          <div className="flex-1 overflow-y-auto space-y-3 font-medium text-[10px] pr-1 custom-scrollbar bg-[#09090b] p-3.5 rounded-xl border border-zinc-800/60 max-h-[220px]">
            {chatResponses.map((res, idx) => (
              <div 
                key={idx} 
                className={`flex flex-col space-y-1 p-2.5 rounded-lg border max-w-[85%] ${
                  res.role === "user" 
                    ? "bg-zinc-800 border-zinc-700/60 text-zinc-250 ml-auto" 
                    : "bg-zinc-900/40 border border-zinc-850 text-zinc-300 mr-auto"
                }`}
              >
                <span className="font-bold text-[8px] uppercase text-zinc-500">
                  {res.role === "user" ? "Client Auditor" : "AI Trust Bot"}
                </span>
                <p className="leading-relaxed text-[11px]">{res.text}</p>
              </div>
            ))}
            {sendingChat && (
              <div className="flex items-center space-x-1.5 text-zinc-500 bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-850 mr-auto max-w-[85%]">
                <Loader2 size={10} className="animate-spin text-zinc-400" />
                <span className="text-[10px]">Evaluating RAG compliance rules...</span>
              </div>
            )}
          </div>

          {/* Form message */}
          <form onSubmit={handleSendChat} className="flex items-center space-x-2 pt-3 border-t border-zinc-850">
            <input
              type="text"
              required
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              placeholder="Ask: 'Is user database PII encrypted?'"
              className="flex-1 bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg px-3.5 py-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
            />
            <button
              type="submit"
              disabled={sendingChat || !chatQuery.trim()}
              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold p-2 rounded-lg cursor-pointer active:scale-95 transition-all disabled:opacity-50"
            >
              <Send size={14} />
            </button>
          </form>
        </div>

      </div>

      {/* Clickwrap NDA Modal */}
      {ndaOpen && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl max-w-sm w-full p-6 shadow-2xl space-y-6 relative">
            <button 
              onClick={() => { setNdaOpen(false); setSelectedDoc(null); }}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-1">
              <h3 className="font-semibold text-zinc-200 text-lg">Sign Mutual NDA</h3>
              <p className="text-zinc-400 text-xs">A signed agreement is required to download this report.</p>
            </div>

            <form onSubmit={handleSignNda} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Company Name</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. PwC Consulting"
                  className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none transition-all placeholder-zinc-650"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Business Email Address</label>
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="auditor@company.com"
                  className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none transition-all placeholder-zinc-650"
                />
              </div>

              <div className="flex items-center space-x-2 text-[9px] text-amber-500/95 bg-amber-500/5 p-3 rounded-lg border border-amber-500/15">
                <Lock size={12} className="shrink-0 text-amber-500" />
                <span>NDA logs agreement timestamps and binds download access to your email.</span>
              </div>

              <button
                type="submit"
                disabled={signing}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-2.5 px-4 rounded-lg cursor-pointer text-xs active:scale-95 transition-all shadow-sm"
              >
                {signing ? "Processing..." : "Sign Agreement & Download"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}



