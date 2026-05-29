"use client";

import { useEffect, useState, useCallback, useRef } from "react";

const API_BASE = "http://localhost:3002";

type Email = {
	subject: string;
	from: string;
	date: string;
	body?: string;
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
	const flags = ["LMS", "Reminder", "Grand Challenge", "Hackathon"];
	return flags.some((f) => subject.includes(f));
}

/** Strip the outer <html>/<body>/<head> wrappers so the HTML plays nice inside an iframe */
function cleanBodyHtml(raw: string): string {
	return raw
		.replace(/^[\s\S]*?(<html[^>]*>)/i, "$1")
		.replace(/(=3D)/g, "=")
		.replace(/=\r?\n\s*/g, "")
		.replace(/&amp;/g, "&");
}

function buildIframeDoc(email: Email): string {
	const rawBody = email.body || "<p><em>No body content</em></p>";
	const cleaned = cleanBodyHtml(rawBody);

	// If the body is already a full HTML document, use it directly
	if (/<html[\s>]/i.test(cleaned)) return cleaned;

	// Otherwise wrap it with pure black styles
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="dark only" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #e4e4e7;
      background: #000000;
    }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    p { margin-bottom: 12px; }
  </style>
</head>
<body>${cleaned}</body>
</html>`;
}

// ─── Body Preview (truncated text) ──────────────────────────────────────────

function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function bodyPreview(html: string | undefined, maxLen = 80): string {
	if (!html) return "";
	const text = stripHtml(html);
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function App() {
	const [emails, setEmails] = useState<Email[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);

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

	// Write content directly to reading pane iframe whenever selection or emails update
	useEffect(() => {
		if (selectedIdx !== null && emails[selectedIdx]) {
			const email = emails[selectedIdx];
			if (iframeRef.current && email.body) {
				const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
				if (doc) {
					doc.open();
					doc.write(buildIframeDoc(email));
					doc.close();
				}
			}
		}
	}, [selectedIdx, emails]);

	const handleRefresh = () => {
		setRefreshing(true);
		setSelectedIdx(null);
		fetchData(true);
	};

	const selectedEmail = selectedIdx !== null ? emails[selectedIdx] : null;

	return (
		<main
			className="grid h-screen w-screen overflow-hidden bg-black text-zinc-100"
			style={{ gridTemplateRows: "48px 1fr 32px" }}
		>
			{/* ── Title bar ── */}
			<header className="flex items-center justify-between border-b border-zinc-900 bg-black px-5">
				<div className="flex items-center gap-3">
					<span className="text-md font-bold tracking-tight text-white">
						harbor
					</span>
					<span className="text-[9px] font-medium uppercase tracking-[0.25em] text-zinc-500">
						Mail Client
					</span>
				</div>
				<div className="flex items-center gap-3">
					{accounts.length > 0 && (
						<span className="hidden text-xs font-mono text-zinc-400 md:inline">
							{accounts[0].email}
						</span>
					)}
					<button
						onClick={handleRefresh}
						disabled={refreshing}
						className="group flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-black text-zinc-400 transition hover:border-zinc-600 hover:text-white disabled:opacity-40"
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

			{/* ── 3 Column Workplace ── */}
			<div className="grid grid-cols-1 md:grid-cols-[240px_360px_1fr] overflow-hidden">

				{/* ── Column 1: Sidebar ── */}
				<aside className="hidden md:block overflow-y-auto border-r border-zinc-900 bg-black p-3">
					<div className="mb-4 flex items-center justify-between rounded bg-zinc-950 px-3 py-2 border border-zinc-900">
						<span className="text-xs font-semibold tracking-wide text-zinc-300">Inbox</span>
						<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
							{emails.length}
						</span>
					</div>

					<nav className="space-y-1">
						{[
							{ label: "All Mail", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", active: true },
							{ label: "Unread", icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8", active: false },
							{ label: "Important", icon: "M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z", active: false },
						].map((item) => (
							<button
								key={item.label}
								className={`flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-left text-xs transition ${item.active
										? "bg-zinc-900 text-white font-medium border-l-2 border-white"
										: "text-zinc-400 hover:bg-zinc-950 hover:text-zinc-200"
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
						<div className="mt-8 border-t border-zinc-900 pt-5">
							<p className="mb-3 px-3 text-[10px] uppercase tracking-wider font-bold text-zinc-600">
								Accounts
							</p>
							{accounts.map((acc) => (
								<div
									key={acc.email}
									className="flex items-center gap-2.5 rounded px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-950"
								>
									<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-900 text-[10px] font-bold text-zinc-300 border border-zinc-800">
										{acc.name[0]?.toUpperCase()}
									</span>
									<div className="truncate">
										<p className="text-zinc-300 font-medium truncate">{acc.name}</p>
										<p className="truncate text-[10px] text-zinc-500 font-mono">{acc.email}</p>
									</div>
								</div>
							))}
						</div>
					)}
				</aside>

				{/* ── Column 2: Email List ── */}
				<section className="flex flex-col overflow-hidden border-r border-zinc-900 bg-black">
					{loading && !refreshing ? (
						<div className="flex flex-1 items-center justify-center">
							<div className="flex flex-col items-center gap-2">
								<div className="flex gap-1.5">
									{[0, 1, 2].map((i) => (
										<span
											key={i}
											className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
											style={{ animationDelay: `${i * 0.15}s` }}
										/>
									))}
								</div>
								<p className="text-[10px] tracking-wider text-zinc-500 uppercase font-mono">Fetching...</p>
							</div>
						</div>
					) : error ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
							<div className="rounded border border-red-900/30 bg-red-950/10 p-3">
								<svg className="h-6 w-6 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
									<path d="M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z" />
								</svg>
							</div>
							<p className="text-xs font-semibold text-red-400">Connection Failed</p>
							<p className="text-[10px] text-zinc-500 leading-relaxed">
								Make sure the backend runs on <code className="font-mono text-zinc-300">localhost:3002</code>
							</p>
							<button
								onClick={handleRefresh}
								className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
							>
								Retry
							</button>
						</div>
					) : emails.length === 0 ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
							<svg className="h-8 w-8 text-zinc-700" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
								<path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
							<p className="text-xs text-zinc-500 font-mono">No messages</p>
						</div>
					) : (
						<div className="flex flex-1 flex-col overflow-hidden">
							{/* Header */}
							<div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-900 bg-black px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
								<span>Conversations</span>
								<span>{emails.length} items</span>
							</div>

							{/* Scrollable conversation items */}
							<div className="flex-1 overflow-y-auto divide-y divide-zinc-900/60">
								{emails.map((email, i) => {
									const unread = isUnread(email.subject);
									const active = selectedIdx === i;
									return (
										<button
											key={i}
											onClick={() => setSelectedIdx(active ? null : i)}
											className={`w-full px-4 py-3 text-left transition ${active
													? "bg-zinc-900"
													: "bg-black hover:bg-zinc-950/60"
												}`}
										>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0 flex-1">
													{/* Sender Row */}
													<div className="flex items-center gap-2">
														<span
															className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold ${unread
																	? "bg-white text-black"
																	: "bg-zinc-800 text-zinc-400"
																}`}
														>
															{extractName(email.from)[0]?.toUpperCase() || "?"}
														</span>
														<span
															className={`truncate text-xs ${unread ? "font-bold text-white" : "text-zinc-300"
																}`}
														>
															{extractName(email.from)}
														</span>
													</div>

													{/* Subject */}
													<p
														className={`mt-1.5 truncate text-[11px] ${unread ? "font-semibold text-white" : "text-zinc-400"
															}`}
													>
														{email.subject}
													</p>

													{/* Body preview snippet */}
													{email.body && (
														<p className="mt-1 truncate text-[10px] text-zinc-500">
															{bodyPreview(email.body, 70)}
														</p>
													)}
												</div>

												{/* Date badge */}
												<span className="shrink-0 pt-0.5 text-[9px] font-mono text-zinc-500 tabular-nums">
													{formatDate(email.date)}
												</span>
											</div>
										</button>
									);
								})}
							</div>
						</div>
					)}
				</section>

				{/* ── Column 3: Email Reader Pane ── */}
				<section className="flex flex-col overflow-hidden bg-black">
					{selectedEmail ? (
						<div className="flex h-full flex-col overflow-hidden">

							{/* Reading Pane Header (Metadata) */}
							<div className="space-y-2 border-b border-zinc-900 bg-black p-5">
								<div className="flex items-start justify-between gap-4">
									<h1 className="text-sm font-bold text-white leading-snug">
										{selectedEmail.subject}
									</h1>
									<span className="shrink-0 text-[10px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5">
										{new Date(selectedEmail.date).toLocaleString("en-IN", {
											dateStyle: "medium",
											timeStyle: "short",
										})}
									</span>
								</div>

								<div className="flex flex-col gap-1 pt-1 text-[11px]">
									<div className="flex items-center gap-2">
										<span className="w-12 text-zinc-500 font-mono">From</span>
										<span className="text-zinc-300 break-all">{selectedEmail.from}</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="w-12 text-zinc-500 font-mono">To</span>
										<span className="text-zinc-400">me</span>
									</div>
								</div>
							</div>

							{/* Seamless Reading Pane Body (Sandboxed Iframe) */}
							<div className="flex-1 bg-black">
								{selectedEmail.body ? (
									<iframe
										ref={iframeRef}
										sandbox="allow-same-origin"
										className="h-full w-full border-0"
										title="Email reading pane"
										srcDoc={buildIframeDoc(selectedEmail)}
									/>
								) : (
									<div className="flex h-full items-center justify-center text-xs font-mono text-zinc-600">
										No body content available
									</div>
								)}
							</div>

						</div>
					) : (
						<div className="flex h-full flex-col items-center justify-center text-center p-8">
							<div className="relative mb-3 flex h-10 w-10 items-center justify-center rounded border border-zinc-900 bg-zinc-950/20 text-zinc-600">
								<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
									<path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
								</svg>
							</div>
							<h3 className="text-xs font-bold tracking-wide text-zinc-400 uppercase">No conversation selected</h3>
							<p className="mt-1 max-w-[200px] text-[10px] text-zinc-600 leading-normal">
								Select an email from the left pane to view its content here.
							</p>
						</div>
					)}
				</section>

			</div>

			{/* ── Status bar ── */}
			<footer className="flex items-center justify-between border-t border-zinc-900 bg-black px-4 text-[10px] font-mono text-zinc-500">
				<span>
					{error
						? "⚠ disconnected"
						: emails.length > 0
							? `${emails.length} messages`
							: loading
								? "connecting…"
								: "ready"}
				</span>
				<span>
					{accounts.length > 0 ? accounts[0].email : "no account connected"}
					{" · "}port 3002
				</span>
			</footer>
		</main>
	);
}
