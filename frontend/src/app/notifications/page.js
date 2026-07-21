"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import {
  Bell, AlertTriangle, AlertOctagon, Info, CheckCheck, RotateCw, Check
} from "lucide-react";

import { API_BASE_URL } from "@/app/lib/api";

const sevIcon = (sev) => {
  if (sev === "critical") return <AlertOctagon size={15} className="text-rose-400" />;
  if (sev === "warning") return <AlertTriangle size={15} className="text-amber-400" />;
  return <Info size={15} className="text-sky-400" />;
};

const sevBorder = (sev) => ({
  critical: "border-l-rose-500/60",
  warning: "border-l-amber-500/60",
  info: "border-l-sky-500/50",
}[sev] || "border-l-zinc-700");

function fmtAgo(ts) {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationsPage() {
  const { getToken } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/notifications`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(data.unread_count || 0);
    } catch {
      setItems([]);
      setUnread(0);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/notifications/${id}/read`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) { console.error(e); }
  };

  const markAll = async () => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/notifications/read-all`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto space-y-6 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <Bell size={20} className="text-zinc-400" />
            Notifications
            {unread > 0 && <span className="text-[10px] bg-rose-500 text-white rounded-full px-2 py-0.5">{unread}</span>}
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Alerts from continuous monitoring and control drift.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"><RotateCw size={12} /> Refresh</button>
          {unread > 0 && (
            <button onClick={markAll} className="flex items-center gap-1.5 text-xs bg-zinc-100 hover:bg-white text-zinc-950 font-medium px-3 py-1.5 rounded-lg transition-colors"><CheckCheck size={13} /> Mark all read</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500 text-sm"><RotateCw size={16} className="animate-spin mr-2" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-24 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl">
          <Bell size={28} className="mx-auto mb-3 text-zinc-700" />
          No notifications. You&apos;re all caught up.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 border border-zinc-800/80 border-l-2 ${sevBorder(n.severity)} rounded-lg px-4 py-3 ${n.read ? "bg-[#0e0e11] opacity-70" : "bg-[#16161a]"}`}
            >
              <div className="mt-0.5 shrink-0">{sevIcon(n.severity)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{n.title}</span>
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />}
                </div>
                {n.message && <p className="text-xs text-zinc-400 mt-0.5">{n.message}</p>}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[10px] text-zinc-600">{fmtAgo(n.created_at)}</span>
                  {n.link && <Link href={n.link} className="text-[10px] text-sky-400 hover:text-sky-300">View</Link>}
                </div>
              </div>
              {!n.read && (
                <button onClick={() => markRead(n.id)} title="Mark read" className="text-zinc-500 hover:text-zinc-100 shrink-0"><Check size={14} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
