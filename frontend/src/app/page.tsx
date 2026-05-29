"use client";

import { useEffect, useState, useCallback } from "react";

const API_BASE = "http://localhost:3002";

type Email = {
  Subject: string;
  From: string;
  Date: string;
};

type Account = {
  name: string;
  email: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(raw: string) {
  const d = new Date(raw);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);

  if (hours < 1) return `${Math.floor(diff / 60_000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function extractName(from: string) {
  const match = from.match(/^"?(.+?)"?\s*</);
  if (match) return match[1].trim();
  return from.split("@")[0];
}

function extractDomain(from: string) {
  const match = from.match(/@([^>]+)>?/);
  return match ? match[1] : "";
}

function isUnread(subject: string) {
  // treat recent LMS emails and hackathons as "unread" for visual variety
  const flags = ["LMS", "Reminder", "Grand Challenge", "Hackathon"];
  return flags.some((f) => subject.includes(f));
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [emailsRes, accountsRes] = await Promise.all([
        fetch(`${API_BASE}/api/emails`),
        fetch(`${API_BASE}/api/accounts`),
      ]);
      if (!emailsRes.ok) throw new Error(`Emails API: ${emailsRes.status}`);
      if (!accountsRes.ok) throw new Error(`Accounts API: ${accountsRes.status}`);
      const [emailsData, accountsData] = await Promise.all([
        emailsRes.json(),
        accountsRes.json(),
      ]);
      setEmails(emailsData);
      setAccounts(accountsData);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    setSelectedIdx(null);
    fetchData(true);
  };

  // ── render ──

  return (
    <main className="grid h-screen w-screen overflow-hidden"
      style={{ gridTemplateColumns: "280px 1fr", gridTemplateRows: "48px 1fr 32px" }}
    >
      {/* ── Title bar ── */}
      <header className="col-span-2 flex items-center justify-between border-b border-[#1e2a3a] bg-[#0d1117] px-5">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-wide text-[#e6edf3]">
            harbor
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#8b949e]">
            Mail Client
          </span>
        </div>
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <span className="hidden text-xs text-[#8b949e] md:inline">
              {accounts[0].email}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="group relative flex h-7 w-7 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#8b949e] transition hover:border-[#58a6ff] hover:text-[#58a6ff] disabled:opacity-40"
            title="Refresh"
          >
            <svg
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M1 4v6h6M23 20v-6h-6" />
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Sidebar ── */}
      <aside className="overflow-y-auto border-r border-[#1e2a3a] bg-[#0d1117] p-3">
        <div className="mb-4 flex items-center gap-2 rounded-md bg-[#161b22] px-3 py-2">
          <span className="text-xs font-medium text-[#8b949e]">Inbox</span>
          <span className="ml-auto rounded-full bg-[#1f6feb] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {emails.length}
          </span>
        </div>

        <nav className="space-y-0.5">
          {[
            { label: "All Mail", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", active: true },
            { label: "Unread", icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8", active: false },
            { label: "Important", icon: "M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z", active: false },
          ].map((item) => (
            <button
              key={item.label}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs transition ${
                item.active
                  ? "bg-[#1f6feb]/10 text-[#58a6ff]"
                  : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3]"
              }`}
            >
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </nav>

        {accounts.length > 0 && (
          <div className="mt-6 border-t border-[#1e2a3a] pt-4">
            <p className="mb-2 px-3 text-[10px] uppercase tracking-widest text-[#484f58]">
              Accounts
            </p>
            {accounts.map((acc) => (
              <div
                key={acc.email}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-xs text-[#8b949e]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1f6feb]/20 text-[10px] font-bold text-[#58a6ff]">
                  {acc.name[0]}
                </span>
                <div className="truncate">
                  <p className="text-[#e6edf3]">{acc.name}</p>
                  <p className="truncate text-[10px] text-[#484f58]">{acc.email}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* ── Email list ── */}
      <section className="flex flex-col overflow-hidden bg-[#0d1117]">
        {loading && !refreshing ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 animate-bounce rounded-full bg-[#1f6feb]"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-xs text-[#484f58]">Fetching emails…</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="rounded-full border border-[#f85149]/30 bg-[#f85149]/10 p-4">
              <svg className="h-8 w-8 text-[#f85149]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path d="M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#f85149]">Connection Error</p>
            <p className="max-w-xs text-xs text-[#8b949e]">
              {error}. Make sure the Harbor backend is running on{" "}
              <code className="rounded bg-[#161b22] px-1 py-0.5 font-mono text-[#e6edf3]">
                localhost:3002
              </code>
            </p>
            <button
              onClick={handleRefresh}
              className="rounded-md border border-[#30363d] bg-[#21262d] px-4 py-1.5 text-xs font-medium text-[#e6edf3] transition hover:bg-[#30363d]"
            >
              Retry
            </button>
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <svg className="h-12 w-12 text-[#21262d]" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-[#8b949e]">No emails found</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* column headers */}
            <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto] gap-2 border-b border-[#1e2a3a] bg-[#0d1117] px-4 py-2 text-[10px] font-medium uppercase tracking-widest text-[#484f58]">
              <span>From / Subject</span>
              <span>Date</span>
            </div>

            {/* scrollable list */}
            <div className="flex-1 overflow-y-auto">
              {emails.map((email, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  className={`w-full border-b border-[#1e2a3a]/60 px-4 py-3 text-left transition hover:bg-[#161b22]/80 ${
                    selectedIdx === i ? "bg-[#1f6feb]/8 border-l-2 border-l-[#58a6ff]" : ""
                  } ${i % 2 === 0 ? "bg-[#0d1117]" : "bg-[#0d1117]/60"}`}
                >
                  {/* Row: Compact layout */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {/* Sender line */}
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                            isUnread(email.Subject)
                              ? "bg-[#1f6feb] text-white"
                              : "bg-[#21262d] text-[#8b949e]"
                          }`}
                        >
                          {extractName(email.From)[0]?.toUpperCase() || "?"}
                        </span>
                        <span
                          className={`truncate text-xs ${
                            isUnread(email.Subject)
                              ? "font-semibold text-[#e6edf3]"
                              : "text-[#8b949e]"
                          }`}
                        >
                          {extractName(email.From)}
                        </span>
                        <span className="hidden shrink-0 text-[10px] text-[#484f58] md:inline">
                          &lt;{extractDomain(email.From)}&gt;
                        </span>
                      </div>
                      {/* Subject line */}
                      <p
                        className={`mt-0.5 truncate text-[11px] pl-7 ${
                          isUnread(email.Subject)
                            ? "font-medium text-[#e6edf3]"
                            : "text-[#6e7681]"
                        }`}
                      >
                        {email.Subject}
                      </p>
                    </div>
                    <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-[#484f58]">
                      {formatDate(email.Date)}
                    </span>
                  </div>

                  {/* Expandable detail */}
                  {selectedIdx === i && (
                    <div className="mt-3 overflow-hidden rounded-md border border-[#1e2a3a] bg-[#161b22] pl-7">
                      <div className="space-y-1.5 px-3 py-2.5">
                        <div className="flex gap-2 text-[11px]">
                          <span className="w-12 shrink-0 text-[#484f58]">From</span>
                          <span className="text-[#e6edf3]">{email.From}</span>
                        </div>
                        <div className="flex gap-2 text-[11px]">
                          <span className="w-12 shrink-0 text-[#484f58]">Date</span>
                          <span className="text-[#e6edf3]">
                            {new Date(email.Date).toLocaleString("en-IN", {
                              dateStyle: "full",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                        <div className="flex gap-2 text-[11px]">
                          <span className="w-12 shrink-0 text-[#484f58]">Subject</span>
                          <span className="text-[#e6edf3]">{email.Subject}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Status bar ── */}
      <footer className="col-span-2 flex items-center justify-between border-t border-[#1e2a3a] bg-[#0d1117] px-4 text-[10px] text-[#484f58]">
        <span>
          {error
            ? "⚠ disconnected"
            : emails.length > 0
              ? `${emails.length} messages`
              : loading
                ? "connecting…"
                : "ready"}
        </span>
        <span className="text-[#484f58]">
          {accounts.length > 0 ? accounts[0].email : "no account"}
          {" · "}port 3002
        </span>
      </footer>
    </main>
  );
}
