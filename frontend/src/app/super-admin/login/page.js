"use client";

import { useState } from "react";
import { Lock, LogIn, ShieldCheck } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function SuperAdminLoginPage() {
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/super-admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_key: accessKey })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Invalid access key.");
      }
      sessionStorage.setItem("super_admin_session", data.token);
      window.location.href = "/super-admin";
    } catch (err) {
      setError(err.message || "Super admin login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-8">
      <div className="w-full max-w-md bg-[#121215] border border-zinc-800 rounded-xl p-6 space-y-6">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-zinc-100 text-zinc-950 flex items-center justify-center mx-auto">
            <ShieldCheck size={24} />
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Hidden Access</span>
            <h1 className="text-xl font-semibold text-zinc-100 mt-1">Super Admin Login</h1>
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
              Enter the platform access key to open the restricted dashboard. This page is URL-only and is not linked in navigation.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Access Key</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-3 text-zinc-600" />
              <input
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="Enter super admin key"
                required
                className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-100 rounded-lg pl-9 pr-3 py-2.5 text-xs outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !accessKey.trim()}
            className="w-full bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
          >
            <LogIn size={14} />
            {loading ? "Verifying..." : "Enter Dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}
