"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Mail, Bell, CircleDot, Users } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState, SearchInput,
} from "../components/ui";

export default function PeoplePage() {
  const api = useApi();
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notifyingId, setNotifyingId] = useState(null);

  const fetchPeople = useCallback(async () => {
    try {
      const data = await api.get("/api/people");
      setPeople(Array.isArray(data) ? data : []);
    } catch {
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const handleReminder = async (id) => {
    setNotifyingId(id);
    try {
      await api.post(`/api/people/${id}/trigger-training`);
      await fetchPeople();
    } catch (err) {
      console.error("Reminder failed", err);
    } finally {
      setNotifyingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return people.filter(
      (p) => p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q)
    );
  }, [people, search]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Personnel Audits"
        title="People Directory"
        description="Review employee security parameters, background-check compliance, and annual training sign-offs."
      />

      <Card className="flex flex-col md:flex-row gap-4 justify-between items-center">
        <SearchInput className="flex-1 w-full md:max-w-md" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, department…" />
        <span className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-lg shrink-0">
          <CircleDot size={12} className="text-emerald-400 animate-pulse" />
          Continuous employee checks active
        </span>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={people.length === 0 ? "No employees provisioned" : "No employees match your search"}
            description={people.length === 0 ? "Users are provisioned from Clerk on sign-in." : "Try a different search term."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-zinc-900/40 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-5 font-semibold">Name</th>
                  <th className="py-3.5 px-5 font-semibold">Department</th>
                  <th className="py-3.5 px-5 w-28 font-semibold">Role</th>
                  <th className="py-3.5 px-5 w-32 text-center font-semibold">Background</th>
                  <th className="py-3.5 px-5 w-32 text-center font-semibold">Training</th>
                  <th className="py-3.5 px-5 w-24 text-center font-semibold">Status</th>
                  <th className="py-3.5 px-5 w-36 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-zinc-200">{item.name}</div>
                      <span className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5 font-mono">
                        <Mail size={11} className="text-zinc-600" />{item.email}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-zinc-400">{item.department}</td>
                    <td className="py-3.5 px-5 text-zinc-400 font-medium">{item.role}</td>
                    <td className="py-3.5 px-5 text-center">
                      <Badge variant={item.background_check_passed ? "success" : "danger"}>
                        {item.background_check_passed ? "Passed" : "Missing"}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <Badge variant={item.training_completed ? "success" : "warning"}>
                        {item.training_completed ? "Completed" : "Pending"}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                        <CircleDot size={11} className="text-emerald-500" />{item.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      {!item.training_completed ? (
                        <Button size="sm" icon={Bell} loading={notifyingId === item.id} onClick={() => handleReminder(item.id)}>
                          {notifyingId === item.id ? "Notifying…" : "Notify"}
                        </Button>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
