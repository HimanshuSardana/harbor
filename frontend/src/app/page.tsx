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

	if (/<html[\s>]/i.test(cleaned)) {
		return cleaned
			.replace(/(<body[^>]*)(>)/i, '$1 tabindex="-1"$2')
			.replace(/(<body[^>]*style=)"([^"]*)"/i, (_, pre, styles) => `${pre}"${styles}; caret-color: #3b82f6;"`)
			.replace(/(<\/style>)/i, `* { caret-color: #3b82f6; }\n$1`);
	}

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
      caret-color: #3b82f6;
    }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    p { margin-bottom: 12px; }
    * { user-select: none; -webkit-user-select: none; }
    body { user-select: text; -webkit-user-select: text; }
    ::selection { background: #3b82f6; color: #fff; }
  </style>
</head>
<body tabindex="-1">${cleaned}</body>
</html>`;
}

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

// ─── Plain-text visual mode helpers ─────────────────────────────────────────

/** Normalise a selection range so start ≤ end */
function selRange(ar: number, ac: number, br: number, bc: number) {
	if (ar < br || (ar === br && ac <= bc)) return { sr: ar, sc: ac, er: br, ec: bc };
	return { sr: br, sc: bc, er: ar, ec: bc };
}

/** Extract selected text from lines given a normalised range */
function extractSelection(lines: string[], sr: number, sc: number, er: number, ec: number): string {
	if (sr === er) return lines[sr].slice(sc, ec);
	let parts = [lines[sr].slice(sc)];
	for (let r = sr + 1; r < er; r++) parts.push(lines[r]);
	parts.push(lines[er].slice(0, ec));
	return parts.join("\n");
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function App() {
	const [emails, setEmails] = useState<Email[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [focusedPanel, setFocusedPanel] = useState<'list' | 'reader'>('list');
	const [visualMode, setVisualMode] = useState(false);

	// Plain-text visual mode state
	const [plainText, setPlainText] = useState("");
	const [cursorRow, setCursorRow] = useState(0);
	const [cursorCol, setCursorCol] = useState(0);
	const [anchorRow, setAnchorRow] = useState<number | null>(null);
	const [anchorCol, setAnchorCol] = useState<number | null>(null);

	const listRef = useRef<HTMLDivElement | null>(null);
	const plainRef = useRef<HTMLDivElement | null>(null);

	// Resizing States
	const [col1Width, setCol1Width] = useState(240);
	const [col2Width, setCol2Width] = useState(360);
	const [isDragging1, setIsDragging1] = useState(false);
	const [isDragging2, setIsDragging2] = useState(false);
	const [isMobile, setIsMobile] = useState(false);

	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	// Monitor screen size for mobile switching
	useEffect(() => {
		const handleResize = () => setIsMobile(window.innerWidth < 768);
		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

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

	useEffect(() => { fetchData(); }, [fetchData]);

	// Write iframe content when email changes
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

	// Auto-scroll selected list item into view
	useEffect(() => {
		if (selectedIdx !== null && listRef.current) {
			const btn = listRef.current.querySelector(`[data-idx="${selectedIdx}"]`) as HTMLElement | null;
			btn?.scrollIntoView({ block: 'nearest' });
		}
	}, [selectedIdx]);

	// Auto-scroll plain text cursor into view
	useEffect(() => {
		if (visualMode && plainRef.current) {
			const el = plainRef.current.querySelector(`[data-cursor]`) as HTMLElement | null;
			el?.scrollIntoView({ block: 'nearest' });
		}
	}, [cursorRow, cursorCol, visualMode]);

	// ── Keybindings ──
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			switch (e.key) {
				// ── Focus ──
				case '2':
					e.preventDefault();
					setFocusedPanel('list');
					setVisualMode(false);
					if (emails.length > 0 && selectedIdx === null) setSelectedIdx(0);
					break;

				case '3':
					if (selectedIdx !== null && emails[selectedIdx]) {
						e.preventDefault();
						setFocusedPanel('reader');
						setVisualMode(false);
					}
					break;

				// ── List navigation ──
				case 'j':
					if (focusedPanel === 'list' && emails.length > 0) {
						e.preventDefault();
						setSelectedIdx(p => p === null ? 0 : Math.min(p + 1, emails.length - 1));
					} else if (focusedPanel === 'reader' && visualMode) {
						e.preventDefault();
						const lines = plainText.split("\n");
						setCursorRow(r => Math.min(r + 1, lines.length - 1));
					} else if (focusedPanel === 'reader' && iframeRef.current?.contentWindow) {
						e.preventDefault();
						iframeRef.current.contentWindow.scrollBy(0, 60);
					}
					break;

				case 'k':
					if (focusedPanel === 'list' && emails.length > 0) {
						e.preventDefault();
						setSelectedIdx(p => p === null ? 0 : Math.max(p - 1, 0));
					} else if (focusedPanel === 'reader' && visualMode) {
						e.preventDefault();
						setCursorRow(r => Math.max(r - 1, 0));
					} else if (focusedPanel === 'reader' && iframeRef.current?.contentWindow) {
						e.preventDefault();
						iframeRef.current.contentWindow.scrollBy(0, -60);
					}
					break;

				case 'h':
					if (focusedPanel === 'reader' && visualMode) {
						e.preventDefault();
						setCursorCol(c => Math.max(c - 1, 0));
					}
					break;

				case 'l':
					if (focusedPanel === 'reader' && visualMode) {
						e.preventDefault();
						setCursorCol(c => {
							const lineLen = plainText.split("\n")[cursorRow]?.length ?? 0;
							return Math.min(c + 1, lineLen);
						});
					}
					break;

				case '0':
					if (focusedPanel === 'reader' && visualMode) {
						e.preventDefault();
						setCursorCol(0);
					}
					break;

				case '$':
					if (focusedPanel === 'reader' && visualMode) {
						e.preventDefault();
						const lineLen = plainText.split("\n")[cursorRow]?.length ?? 0;
						setCursorCol(lineLen);
					}
					break;

				case 'Enter':
					if (focusedPanel === 'list' && selectedIdx !== null) {
						e.preventDefault();
						const btn = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`) as HTMLElement | null;
						btn?.scrollIntoView({ block: 'nearest' });
					}
					break;

				// ── Visual mode toggle ──
				case 'v':
					if (focusedPanel === 'reader' && selectedIdx !== null && emails[selectedIdx]?.body) {
						e.preventDefault();
						if (!visualMode) {
							// Enter visual mode: extract plain text
							const text = stripHtml(emails[selectedIdx].body || "");
							setPlainText(text);
							setCursorRow(0);
							setCursorCol(0);
							setAnchorRow(0);
							setAnchorCol(0);
							setVisualMode(true);
						} else {
							// Exit visual mode
							setVisualMode(false);
							setPlainText("");
						}
					}
					break;

				// ── Yank (copy) ──
				case 'y':
					if (focusedPanel === 'reader' && visualMode && anchorRow !== null && anchorCol !== null) {
						e.preventDefault();
						const lines = plainText.split("\n");
						const { sr, sc, er, ec } = selRange(anchorRow, anchorCol, cursorRow, cursorCol);
						const text = extractSelection(lines, sr, sc, er, ec);
						if (text) {
							navigator.clipboard.writeText(text).then(() => {
								const el = plainRef.current;
								if (el) {
									el.classList.add('yanked');
									setTimeout(() => el.classList.remove('yanked'), 400);
								}
							});
						}
					}
					break;

				// ── Escape ──
				case 'Escape':
					if (visualMode) {
						e.preventDefault();
						setVisualMode(false);
						setPlainText("");
					} else if (focusedPanel === 'reader') {
						e.preventDefault();
						setFocusedPanel('list');
					}
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [focusedPanel, visualMode, emails, selectedIdx, plainText, cursorRow, cursorCol, anchorRow, anchorCol]);

	// ── Resizers ──
	const startDragging1 = (e: React.MouseEvent) => {
		e.preventDefault();
		setIsDragging1(true);
		const startX = e.clientX;
		const startWidth = col1Width;
		const onMouseMove = (me: MouseEvent) => setCol1Width(Math.max(160, Math.min(startWidth + me.clientX - startX, 400)));
		const onMouseUp = () => { setIsDragging1(false); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	};

	const startDragging2 = (e: React.MouseEvent) => {
		e.preventDefault();
		setIsDragging2(true);
		const startX = e.clientX;
		const startWidth = col2Width;
		const onMouseMove = (me: MouseEvent) => setCol2Width(Math.max(260, Math.min(startWidth + me.clientX - startX, 600)));
		const onMouseUp = () => { setIsDragging2(false); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	};

	const handleRefresh = () => {
		setRefreshing(true);
		setSelectedIdx(null);
		setVisualMode(false);
		setPlainText("");
		fetchData(true);
	};

	const selectedEmail = selectedIdx !== null ? emails[selectedIdx] : null;
	const isDraggingAny = isDragging1 || isDragging2;

	// ── Render plain-text visual mode ──
	function renderPlainTextView() {
		const lines = plainText.split("\n");
		const { sr, sc, er, ec } = anchorRow !== null && anchorCol !== null
			? selRange(anchorRow, anchorCol, cursorRow, cursorCol)
			: { sr: cursorRow, sc: cursorCol, er: cursorRow, ec: cursorCol };

		return (
			<div ref={plainRef} className="h-full w-full overflow-auto p-6 font-mono text-sm leading-relaxed whitespace-pre-wrap select-text">
				{lines.map((line, r) => {
					// Determine if this row is selected
					const rowSelected = r >= sr && r <= er;
					let before = "", selected = "", after = "";
					if (rowSelected && sr === er) {
						// Single line selection
						before = line.slice(0, sc);
						selected = line.slice(sc, ec);
						after = line.slice(ec);
					} else if (rowSelected && r === sr) {
						// First line of multi-line
						before = line.slice(0, sc);
						selected = line.slice(sc);
						after = "";
					} else if (rowSelected && r === er) {
						// Last line of multi-line
						before = "";
						selected = line.slice(0, ec);
						after = line.slice(ec);
					} else if (rowSelected) {
						// Fully selected middle line
						before = "";
						selected = line;
						after = "";
					} else {
						before = line;
					}

					const hasCursor = r === cursorRow;

					return (
						<div key={r} className="relative flex">
							{/* Line number gutter */}
							<span className="mr-4 inline-block w-8 shrink-0 text-right text-zinc-600 select-none">
								{r + 1}
							</span>
							{/* Line content */}
							<span className="relative">
								{before && <span className="text-zinc-300">{before}</span>}
								{selected && <span className="bg-blue-600 text-white rounded-none">{selected}</span>}
								{after && <span className="text-zinc-300">{after}</span>}
								{/* Cursor block */}
								{hasCursor && (
									<span
										data-cursor
										className="absolute top-0 inline-block w-[0.6em] h-[1.2em] bg-zinc-100 animate-pulse"
										style={{
											left: `${cursorCol * 0.6}em`,
											pointerEvents: "none",
										}}
									/>
								)}
							</span>
						</div>
					);
				})}
			</div>
		);
	}

	return (
		<main
			className="grid h-screen w-screen overflow-hidden bg-black text-zinc-100 select-none"
			style={{ gridTemplateRows: "48px 1fr 32px" }}
		>
			{/* ── Title bar ── */}
			<header className="flex items-center justify-between border-b border-zinc-900 bg-black px-5">
				<div className="flex items-center gap-3">
					<span className="text-md font-bold tracking-tight text-white">harbor</span>
					<span className="text-[9px] font-medium uppercase tracking-[0.25em] text-zinc-500">Mail Client</span>
				</div>
				<div className="flex items-center gap-3">
					{accounts.length > 0 && (
						<span className="hidden text-xs font-mono text-zinc-400 md:inline">{accounts[0].email}</span>
					)}
					<button
						onClick={handleRefresh}
						disabled={refreshing}
						className="group flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-black text-zinc-400 transition hover:border-zinc-600 hover:text-white disabled:opacity-40"
						title="Refresh"
					>
						<svg className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
							<path d="M1 4v6h6M23 20v-6h-6" />
							<path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
						</svg>
					</button>
				</div>
			</header>

			{/* ── 3 Column Workplace ── */}
			<div className="flex h-full w-full overflow-hidden">

				{/* ── Column 1: Sidebar ── */}
				<aside className="hidden md:block overflow-y-auto bg-black p-3 shrink-0" style={isMobile ? {} : { width: `${col1Width}px` }}>
					<div className="mb-4 flex items-center justify-between rounded bg-zinc-950 px-3 py-2 border border-zinc-900">
						<span className="text-xs font-semibold tracking-wide text-zinc-300">Inbox</span>
						<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">{emails.length}</span>
					</div>
					<nav className="space-y-1">
						{[
							{ label: "All Mail", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", active: true },
							{ label: "Unread", icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8", active: false },
							{ label: "Important", icon: "M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z", active: false },
						].map((item) => (
							<button key={item.label} className={`flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-left text-xs transition ${item.active ? "bg-zinc-900 text-white font-medium border-l-2 border-white" : "text-zinc-400 hover:bg-zinc-950 hover:text-zinc-200"}`}>
								<svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d={item.icon} /></svg>
								{item.label}
							</button>
						))}
					</nav>
					{accounts.length > 0 && (
						<div className="mt-8 border-t border-zinc-900 pt-5">
							<p className="mb-3 px-3 text-[10px] uppercase tracking-wider font-bold text-zinc-600">Accounts</p>
							{accounts.map((acc) => (
								<div key={acc.email} className="flex items-center gap-2.5 rounded px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-950">
									<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-900 text-[10px] font-bold text-zinc-300 border border-zinc-800">{acc.name[0]?.toUpperCase()}</span>
									<div className="truncate">
										<p className="text-zinc-300 font-medium truncate">{acc.name}</p>
										<p className="truncate text-[10px] text-zinc-500 font-mono">{acc.email}</p>
									</div>
								</div>
							))}
						</div>
					)}
				</aside>

				{/* ── Resizer 1 ── */}
				<div onMouseDown={startDragging1} className={`hidden md:block w-1.5 cursor-col-resize shrink-0 transition-colors duration-150 z-30 ${isDragging1 ? "bg-zinc-400" : "bg-zinc-950 hover:bg-zinc-800 border-l border-r border-zinc-900"}`} />

				{/* ── Column 2: Email List ── */}
				<section className="flex flex-col overflow-hidden bg-black shrink-0 w-full md:w-auto" style={isMobile ? {} : { width: `${col2Width}px` }}>
					{loading && !refreshing ? (
						<div className="flex flex-1 items-center justify-center">
							<div className="flex flex-col items-center gap-2">
								<div className="flex gap-1.5">
									{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${i * 0.15}s` }} />)}
								</div>
								<p className="text-[10px] tracking-wider text-zinc-500 uppercase font-mono">Fetching...</p>
							</div>
						</div>
					) : error ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
							<div className="rounded border border-red-900/30 bg-red-950/10 p-3">
								<svg className="h-6 w-6 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z" /></svg>
							</div>
							<p className="text-xs font-semibold text-red-400">Connection Failed</p>
							<p className="text-[10px] text-zinc-500 leading-relaxed">Make sure the backend runs on <code className="font-mono text-zinc-300">localhost:3002</code></p>
							<button onClick={handleRefresh} className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-900 hover:text-white">Retry</button>
						</div>
					) : emails.length === 0 ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
							<svg className="h-8 w-8 text-zinc-700" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
							<p className="text-xs text-zinc-500 font-mono">No messages</p>
						</div>
					) : (
						<div className="flex flex-1 flex-col overflow-hidden">
							<div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-900 bg-black px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
								<span>Conversations</span>
								<span>{emails.length} items</span>
							</div>
							<div ref={listRef} className="flex-1 overflow-y-auto divide-y divide-zinc-900/60 select-none">
								{emails.map((email, i) => {
									const unread = isUnread(email.subject);
									const active = selectedIdx === i;
									const focus = focusedPanel === 'list';
									return (
										<button key={i} data-idx={i} onClick={() => { setFocusedPanel('list'); setSelectedIdx(active ? null : i); setVisualMode(false); setPlainText(""); }}
											className={`w-full px-4 py-3 text-left transition ${active ? focus ? "bg-zinc-900 ring-1 ring-inset ring-zinc-600" : "bg-zinc-900" : "bg-black hover:bg-zinc-950/60"}`}>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold ${unread ? "bg-white text-black" : "bg-zinc-800 text-zinc-400"}`}>{extractName(email.from)[0]?.toUpperCase() || "?"}</span>
														<span className={`truncate text-xs ${unread ? "font-bold text-white" : "text-zinc-300"}`}>{extractName(email.from)}</span>
													</div>
													<p className={`mt-1.5 truncate text-[11px] ${unread ? "font-semibold text-white" : "text-zinc-400"}`}>{email.subject}</p>
													{email.body && <p className="mt-1 truncate text-[10px] text-zinc-500">{bodyPreview(email.body, 70)}</p>}
												</div>
												<span className="shrink-0 pt-0.5 text-[9px] font-mono text-zinc-500 tabular-nums">{formatDate(email.date)}</span>
											</div>
										</button>
									);
								})}
							</div>
						</div>
					)}
				</section>

				{/* ── Resizer 2 ── */}
				<div onMouseDown={startDragging2} className={`hidden md:block w-1.5 cursor-col-resize shrink-0 transition-colors duration-150 z-30 ${isDragging2 ? "bg-zinc-400" : "bg-zinc-950 hover:bg-zinc-800 border-l border-r border-zinc-900"}`} />

				{/* ── Column 3: Email Reader Pane ── */}
				<section className={`flex-1 flex flex-col overflow-hidden bg-black transition-all duration-100 ${focusedPanel === 'reader' && selectedEmail ? 'ring-1 ring-inset ring-zinc-500' : ''}`}
					onClick={() => { if (selectedEmail) setFocusedPanel('reader'); }}>
					{selectedEmail ? (
						<div className="flex h-full flex-col overflow-hidden">
							{/* Metadata header */}
							<div className="space-y-2 border-b border-zinc-900 bg-black p-5">
								<div className="flex items-start justify-between gap-4">
									<h1 className="text-sm font-bold text-white leading-snug">{selectedEmail.subject}</h1>
									<div className="flex items-center gap-2 shrink-0">
										<span className={`text-[9px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 transition-all ${visualMode && focusedPanel === 'reader' ? 'bg-green-700 text-green-100 border border-green-500' : focusedPanel === 'reader' ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-zinc-900 text-zinc-600 border border-zinc-800'}`}>
											{visualMode && focusedPanel === 'reader' ? 'VISUAL' : focusedPanel === 'reader' ? 'NORMAL' : '--'}
										</span>
										<span className="shrink-0 text-[10px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5">
											{new Date(selectedEmail.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
										</span>
									</div>
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

							{/* Body: either plain-text visual mode or iframe normal view */}
							<div className="flex-1 bg-black">
								{visualMode && focusedPanel === 'reader' && plainText ? (
									renderPlainTextView()
								) : selectedEmail.body ? (
									<iframe
										ref={iframeRef}
										sandbox="allow-same-origin"
										className={`h-full w-full border-0 ${isDraggingAny ? "pointer-events-none" : ""}`}
										title="Email reading pane"
										srcDoc={buildIframeDoc(selectedEmail)}
									/>
								) : (
									<div className="flex h-full items-center justify-center text-xs font-mono text-zinc-600">No body content available</div>
								)}
							</div>
						</div>
					) : (
						<div onClick={() => setFocusedPanel('reader')} className="flex h-full flex-col items-center justify-center text-center p-8 cursor-default">
							<div className="relative mb-3 flex h-10 w-10 items-center justify-center rounded border border-zinc-900 bg-zinc-950/20 text-zinc-600">
								<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
							</div>
							<h3 className="text-xs font-bold tracking-wide text-zinc-400 uppercase">No conversation selected</h3>
							<p className="mt-1 max-w-[200px] text-[10px] text-zinc-600 leading-normal">Select an email from the conversations list to view its content here.</p>
							<span className="mt-3 inline-block rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[9px] text-zinc-600 font-mono">2 list · 3 reader · j/k navigate · v visual · y yank</span>
						</div>
					)}
				</section>
			</div>

			{/* ── Status bar ── */}
			<footer className="flex items-center justify-between border-t border-zinc-900 bg-black px-4 text-[10px] font-mono text-zinc-500">
				<span className="flex items-center gap-2">
					{error ? "⚠ disconnected" : emails.length > 0 ? `${emails.length} messages` : loading ? "connecting…" : "ready"}
					{visualMode && focusedPanel === 'reader' && plainText && (
						<span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-green-800/50 text-green-300">
							-- VISUAL -- ({cursorRow + 1},{cursorCol + 1})
						</span>
					)}
					{!visualMode && selectedEmail && !error && (
						<span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${focusedPanel === 'reader' ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-900 text-zinc-600'}`}>
							{focusedPanel.toUpperCase()}
						</span>
					)}
				</span>
				<span>{accounts.length > 0 ? accounts[0].email : "no account connected"} · port 3002</span>
			</footer>
		</main>
	);
}
