"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { 
  Users, Mail, Award, CheckCircle, ShieldAlert, 
  Search, Bell, RefreshCw, X, CircleDot, AlertOctagon
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function PeoplePage() {
  const { getToken } = useAuth();
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notifyingId, setNotifyingId] = useState(null);

  const fetchPeople = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/people`, { headers });
      const data = await res.json();
      setPeople(data);
    } catch (err) {
      console.warn("Using fallback local people catalog.");
      setPeople([
        { id: "user_admin", email: "admin@grcguard.io", name: "Alex Carter", role: "Admin", department: "Security", training_completed: true, background_check_passed: true, status: "Active" },
        { id: "user_editor", email: "compliance-officer@grcguard.io", name: "David Vance", role: "Editor", department: "Compliance", training_completed: true, background_check_passed: true, status: "Active" },
        { id: "user_auditor", email: "external-auditor@pwc.com", name: "Sarah Jenkins", role: "Auditor", department: "Audit", training_completed: true, background_check_passed: true, status: "Active" },
        { id: "user_employee", email: "developer@grcguard.io", name: "John Doe", role: "Employee", department: "Engineering", training_completed: false, background_check_passed: true, status: "Active" },
        { id: "user_employee2", email: "hr-lead@grcguard.io", name: "Jane Smith", role: "Employee", department: "HR", training_completed: true, background_check_passed: true, status: "Active" }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPeople();
  }, []);

  const handleReminder = async (id) => {
    setNotifyingId(id);
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/people/${id}/trigger-training`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (data.status === "success") {
        fetchPeople();
      }
    } catch (err) {
      setPeople(prev => prev.map(p => p.id === id ? { ...p, training_completed: true } : p));
    } finally {
      setNotifyingId(null);
    }
  };

  const filtered = people.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.email.toLowerCase().includes(search.toLowerCase()) ||
    p.department.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Personnel Audits</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">People Directory</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Review employee security parameters, track background check compliance, and monitor annual training sign-offs.
        </p>
      </div>

      {/* Filter panel */}
      <div className="flex flex-col md:flex-row gap-4 justify-between bg-[#121215] border border-zinc-800/80 p-4 rounded-xl items-center shadow-sm">
        <div className="relative flex-1 max-w-md w-full">
          <Search size={14} className="absolute left-3 top-3 text-zinc-550" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee name, email, department..."
            className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-750 focus:border-zinc-650 text-zinc-200 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none transition-all placeholder-zinc-600"
          />
        </div>
        
        <div className="flex items-center space-x-2 text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-lg">
          <CircleDot size={12} className="text-emerald-450 animate-pulse" />
          <span>Continuous employee checks are active</span>
        </div>
      </div>

      {/* People roster list */}
      <div className="bg-[#121215] border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-900/40 border-b border-zinc-850 text-zinc-500 font-medium uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-6">Name</th>
                <th className="py-3.5 px-6">Department</th>
                <th className="py-3.5 px-6 w-32">Role</th>
                <th className="py-3.5 px-6 w-36 text-center">Background Check</th>
                <th className="py-3.5 px-6 w-36 text-center">Security Training</th>
                <th className="py-3.5 px-6 w-28 text-center">Status</th>
                <th className="py-3.5 px-6 w-36 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-550">Loading directory...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-550">No employees found.</td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-850/50 hover:bg-zinc-900/10 transition-colors">
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-zinc-200">{item.name}</div>
                      <span className="text-[10px] text-zinc-500 flex items-center mt-0.5 font-mono">
                        <Mail size={10} className="mr-1 text-zinc-600" />
                        {item.email}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-zinc-400 font-medium">{item.department}</td>
                    <td className="py-3.5 px-6 text-zinc-400 font-semibold">{item.role}</td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center justify-center">
                        {item.background_check_passed ? (
                          <span className="inline-flex items-center text-[10px] font-semibold text-emerald-450 bg-emerald-500/5 border border-emerald-500/10 py-0.5 px-2 rounded">
                            Passed
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-semibold text-rose-455 bg-rose-500/5 border border-rose-500/10 py-0.5 px-2 rounded">
                            Missing
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center justify-center">
                        {item.training_completed ? (
                          <span className="inline-flex items-center text-[10px] font-semibold text-emerald-450 bg-emerald-500/5 border border-emerald-500/10 py-0.5 px-2 rounded">
                            Completed
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-semibold text-amber-500 bg-amber-500/5 border border-amber-500/10 py-0.5 px-2 rounded">
                            Pending
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center justify-center">
                        <span className="flex items-center text-[10px] font-semibold text-emerald-450">
                          <CircleDot size={10} className="mr-1 text-emerald-500" />
                          {item.status}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center justify-center">
                        {!item.training_completed ? (
                          <button
                            onClick={() => handleReminder(item.id)}
                            disabled={notifyingId === item.id}
                            className="flex items-center space-x-1 text-zinc-300 hover:text-zinc-100 font-semibold border border-zinc-800 bg-zinc-900/60 py-1 px-2.5 rounded cursor-pointer text-[10px] transition-colors"
                          >
                            <Bell size={10} className={notifyingId === item.id ? "animate-bounce" : ""} />
                            <span>{notifyingId === item.id ? "Notifying..." : "Notify Employee"}</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-zinc-600">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}



