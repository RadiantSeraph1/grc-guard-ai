"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Download, Send, Lock, Loader2, ShieldCheck } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, CardHeader, Badge, Button, EmptyState,
  Modal, Field, Input, cn,
} from "../components/ui";

export default function TrustPage() {
  const api = useApi();
  const [documents, setDocuments] = useState([]);
  const [ndaSigned, setNdaSigned] = useState(false);
  const [ndaOpen, setNdaOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);

  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [signing, setSigning] = useState(false);

  const [chatQuery, setChatQuery] = useState("");
  const [chatResponses, setChatResponses] = useState([
    { role: "assistant", text: "Welcome to the GRC Security Trust Center. Ask me anything about our compliance frameworks, capital adequacy controls, database encryption, or threat boundaries." },
  ]);
  const [sendingChat, setSendingChat] = useState(false);

  const fetchDocuments = useCallback(async () => {
    try {
      const data = await api.get("/api/trust/documents");
      setDocuments(Array.isArray(data) ? data : []);
    } catch {
      setDocuments([]);
    }
  }, [api]);

  useEffect(() => {
    fetchDocuments();
    if (typeof window !== "undefined") {
      setNdaSigned(localStorage.getItem("grc_nda_signed") === "true");
    }
  }, [fetchDocuments]);

  const handleSignNda = async (e) => {
    e.preventDefault();
    if (!companyName.trim() || !contactEmail.trim()) return;
    setSigning(true);
    try {
      const data = await api.post("/api/trust/sign-nda", { company_name: companyName, contact_email: contactEmail });
      if (data?.nda_signed) {
        localStorage.setItem("grc_nda_signed", "true");
        setNdaSigned(true);
        setNdaOpen(false);
        if (selectedDoc) {
          alert(`NDA signed — downloading ${selectedDoc.name}…`);
          setSelectedDoc(null);
        }
      }
    } catch (err) {
      alert(`Could not record NDA: ${err.message}`);
    } finally {
      setSigning(false);
    }
  };

  const handleDocumentClick = (doc) => {
    if (doc.nda_required && !ndaSigned) {
      setSelectedDoc(doc);
      setNdaOpen(true);
    } else {
      alert(`Downloading ${doc.name}…`);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatQuery.trim()) return;
    const query = chatQuery;
    setChatResponses((prev) => [...prev, { role: "user", text: query }]);
    setChatQuery("");
    setSendingChat(true);
    try {
      const data = await api.post("/api/trust/chat", { query });
      setChatResponses((prev) => [...prev, { role: "assistant", text: data.response }]);
    } catch {
      setChatResponses((prev) => [...prev, {
        role: "assistant",
        text: "The Trust Center assistant is currently unavailable. Please try again once the backend and an AI provider are configured.",
      }]);
    } finally {
      setSendingChat(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Public Posture"
        title="Security Trust Center"
        description="Share real-time compliance status, let clients download reports, and interact with the AI trust bot."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Documents */}
        <Card className="lg:col-span-2">
          <CardHeader title="Security & Compliance Documentation" description="Approved audit documents available for client assessment." />
          {documents.length === 0 ? (
            <EmptyState icon={FileText} title="No documents published" description="Approved trust documents will appear here for download." />
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {documents.map((doc) => (
                <div key={doc.id} className="py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 shrink-0">
                      <FileText size={16} className="text-zinc-400" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-zinc-200 leading-tight truncate">{doc.name}</h4>
                      <span className="text-xs text-zinc-500">PDF Document {doc.size ? `(${doc.size})` : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {doc.nda_required && !ndaSigned && (
                      <Badge variant="warning"><Lock size={11} /> NDA</Badge>
                    )}
                    <Button size="sm" icon={Download} onClick={() => handleDocumentClick(doc)}>Download</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Chat */}
        <Card className="flex flex-col h-[420px]">
          <CardHeader title="Interactive Security Bot" description="Let clients audit compliance parameters instantly." />
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar bg-[#09090b] p-3.5 rounded-xl border border-zinc-800">
            {chatResponses.map((res, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex flex-col gap-1 p-2.5 rounded-lg border max-w-[85%]",
                  res.role === "user" ? "bg-zinc-800 border-zinc-700/60 text-zinc-200 ml-auto" : "bg-zinc-900/40 border-zinc-800 text-zinc-300 mr-auto"
                )}
              >
                <span className="font-bold text-xs uppercase text-zinc-500">{res.role === "user" ? "Client Auditor" : "AI Trust Bot"}</span>
                <p className="leading-relaxed text-sm">{res.text}</p>
              </div>
            ))}
            {sendingChat && (
              <div className="flex items-center gap-1.5 text-zinc-500 bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-800 mr-auto max-w-[85%]">
                <Loader2 size={12} className="animate-spin text-zinc-400" />
                <span className="text-xs">Evaluating RAG compliance rules…</span>
              </div>
            )}
          </div>
          <form onSubmit={handleSendChat} className="flex items-center gap-2 pt-3 border-t border-zinc-800/60 mt-3">
            <Input
              required
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              placeholder="Ask: 'Is user database PII encrypted?'"
              className="flex-1"
            />
            <Button type="submit" variant="primary" loading={sendingChat} disabled={!chatQuery.trim()} className="!px-2.5">
              <Send size={14} />
            </Button>
          </form>
        </Card>
      </div>

      <Modal open={ndaOpen} onClose={() => { setNdaOpen(false); setSelectedDoc(null); }} title="Sign Mutual NDA" description="A signed agreement is required to download this report.">
        <form onSubmit={handleSignNda} className="space-y-4">
          <Field label="Company name">
            <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. PwC Consulting" />
          </Field>
          <Field label="Business email">
            <Input type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="auditor@company.com" />
          </Field>
          <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/5 p-3 rounded-lg border border-amber-500/15">
            <Lock size={12} className="shrink-0 text-amber-400" />
            <span>The NDA logs agreement timestamps and binds download access to your email.</span>
          </div>
          <Button type="submit" variant="primary" loading={signing} className="w-full">
            <ShieldCheck size={15} /> Sign agreement & download
          </Button>
        </form>
      </Modal>
    </PageContainer>
  );
}
