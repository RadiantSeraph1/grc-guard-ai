"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  Library, FileCode, CheckCircle, Clock, AlertTriangle, 
  Upload, X, Link2, Download, Search, ShieldAlert,
  ArrowDownToLine, PlusCircle, RotateCw
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function EvidencePage() {
  const { getToken } = useAuth();
  const [evidence, setEvidence] = useState([]);
  const [controls, setControls] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  
  // Form input
  const [title, setTitle] = useState("");
  const [controlId, setControlId] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const fetchData = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/controls`, { headers });
      const ctrlData = res.ok ? await res.json() : [];
      setControls(Array.isArray(ctrlData) ? ctrlData : []);

      // Fetch evidence list from database
      const evRes = await fetch(`${API_BASE_URL}/api/evidence`, { headers });
      if (!evRes.ok) throw new Error(`HTTP ${evRes.status}`);
      const evData = await evRes.json();
      setEvidence(Array.isArray(evData) ? evData : []);
    } catch (err) {
      console.warn("Evidence unavailable; no evidence has been collected yet.");
      setEvidence([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!title.trim() || !controlId || !file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("title", title);
    formData.append("control_id", controlId);
    formData.append("file", file);

    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/evidence/upload`, {
        method: "POST",
        headers,
        body: formData
      });
      if (res.ok) {
        await fetchData();
        setUploadOpen(false);
        setTitle("");
        setControlId("");
        setFile(null);
      } else {
        alert("Upload failed. Make sure you are using an authorized Admin/Editor role.");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Could not connect to GRC backend to commit evidence.");
    } finally {
      setUploading(false);
    }
  };

  const getFreshnessBadge = (freshness) => {
    switch (freshness) {
      case "Current": return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      case "Expiring": return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
      default: return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    }
  };

  const handleDownload = async (item) => {
    if (item.id.startsWith("ev-")) {
      alert("This is a system default sample log config.");
      return;
    }

    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}/api/evidence/${item.id}/download`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!response.ok) {
      alert("Could not download this evidence file.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const filtered = evidence.filter(e => 
    e.title.toLowerCase().includes(search.toLowerCase()) || 
    e.control_code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Audit Logs Ledger</span>
          <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Evidence Library</h2>
          <p className="text-zinc-400 text-xs mt-0.5">
            Review automatically collected integrations logs, snapshots, and manually uploaded compliance records.
          </p>
        </div>
        <div>
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center space-x-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-1.5 px-3.5 rounded-lg cursor-pointer text-xs shadow-sm active:scale-95 transition-all"
          >
            <PlusCircle size={14} />
            <span>Upload Evidence</span>
          </button>
        </div>
      </div>

      {/* Filter panel */}
      <div className="flex flex-col md:flex-row gap-4 justify-between bg-[#121215] border border-zinc-800/80 p-4 rounded-xl">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3.5 top-3 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search evidence title or control mapping..."
            className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg pl-10 pr-4 py-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
          />
        </div>
      </div>

      {/* Evidence list grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((item) => (
          <div key={item.id} className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 flex flex-col justify-between space-y-6 shadow-sm">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800">
                    <FileCode size={18} className="text-zinc-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-250 leading-snug line-clamp-1">{item.title}</h4>
                    <span className="text-[9px] text-zinc-500 font-mono tracking-wide">{item.file_name} ({item.file_size})</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px]">
                <div className="flex items-center text-zinc-400 bg-[#09090b] px-2 py-1 rounded border border-zinc-850">
                  <Link2 size={10} className="mr-1 text-zinc-500" />
                  Mapping: <span className="font-semibold text-zinc-350 ml-1">{item.control_code}</span>
                </div>
                <div className={`px-2.5 py-0.5 rounded font-semibold uppercase tracking-wider ${getFreshnessBadge(item.freshness)}`}>
                  {item.freshness}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-800/50 flex justify-between items-center text-[10px] text-zinc-500">
              <span>Uploaded: {item.upload_date}</span>
              <button 
                onClick={() => handleDownload(item)}
                className="text-zinc-400 hover:text-zinc-200 font-semibold flex items-center cursor-pointer hover:underline"
              >
                <ArrowDownToLine size={12} className="mr-1" />
                Download
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Upload Modal Drawer */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl max-w-sm w-full p-6 shadow-2xl space-y-6 relative">
            <button 
              onClick={() => { setUploadOpen(false); setTitle(""); setControlId(""); setFile(null); }}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-1">
              <h3 className="font-semibold text-zinc-200 text-lg">Log Compliance Evidence</h3>
              <p className="text-zinc-400 text-xs">Verify control requirements with evidence logs.</p>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Evidence Description</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. S3 Bucket Public Access Block Config"
                  className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none transition-all placeholder-zinc-650"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Select Target Control Mapping</label>
                <select
                  required
                  value={controlId}
                  onChange={(e) => setControlId(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-800 text-zinc-200 rounded-lg p-2.5 text-xs focus:outline-none focus:border-zinc-500 cursor-pointer"
                >
                  <option value="">-- Choose Control --</option>
                  {controls.map((c) => (
                    <option key={c.id} value={c.id}>[{c.control_code}] {c.title}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">Upload File / Log export</label>
                <div className="flex flex-col items-center justify-center w-full bg-[#09090b] border border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-4 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors relative">
                  <Upload size={20} className="mb-1 text-zinc-400" />
                  <span className="text-[10px] text-center font-semibold">
                    {file ? file.name : "Click to select local file"}
                  </span>
                  <input
                    type="file"
                    required
                    onChange={(e) => setFile(e.target.files[0])}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 text-[10px] text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/80">
                <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
                <span>Uploaded items are logged to the persistent ledger.</span>
              </div>

              <button
                type="submit"
                disabled={uploading || !file || !controlId}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-2.5 px-4 rounded-lg cursor-pointer text-xs active:scale-95 transition-all shadow-sm disabled:bg-zinc-900 disabled:text-zinc-500 disabled:cursor-not-allowed flex items-center justify-center space-x-1"
              >
                {uploading ? (
                  <>
                    <RotateCw size={12} className="animate-spin text-zinc-900 mr-1" />
                    <span>Verifying File...</span>
                  </>
                ) : (
                  <span>Commit Evidence</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}



