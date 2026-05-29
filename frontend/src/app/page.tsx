"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { EditorView, keymap, drawSelection, lineNumbers } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { Vim, vim } from "@replit/codemirror-vim";
import { fetchEmails, fetchAccounts } from "@/lib/tauri-api";

type Email = {
	subject: string;
	from_addr: string;
	date: string;
	body_text?: string;
	body_html?: string;
	id?: number;
	mailbox?: string;
};

type Account = {
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

function extractName(from: string | undefined | null) {
	if (!from) return "?";
	const match = from.match(/^"?(.+?)"?\s*</);
	if (match) return match[1].trim();
	return from.split("@")[0];
}

function extractDomain(from: string | undefined | null) {
	if (!from) return "";
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
	const rawBody = email.body_html || email.body_text || "<p><em>No body content</em></p>";
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
      font-family: "Iosevka", "Cascadia Code", "Fira Code", "SF Mono", Menlo, Monaco, monospace;
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

function bodyPreview(email: Email, maxLen = 80): string {
	const html = email.body_html || email.body_text || "";
	const text = stripHtml(html);
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}



// ─── Main Component ─────────────────────────────────────────────────────────

export default function App() {
	const PAGE_SIZE = 50;

	const [emails, setEmails] = useState<Email[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [hasMore, setHasMore] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [focusedPanel, setFocusedPanel] = useState<'list' | 'reader'>('list');
	const [visualMode, setVisualMode] = useState(false);
	const [plainText, setPlainText] = useState("");

	const listRef = useRef<HTMLDivElement | null>(null);
	const cmContainerRef = useRef<HTMLDivElement | null>(null);
	const cmViewRef = useRef<EditorView | null>(null);
	const wrapCompRef = useRef(new Compartment());
	const numCompRef = useRef(new Compartment());
	const exDefined = useRef(false);
	const offsetRef = useRef(0);

	// Resizing States
	const [col1Width, setCol1Width] = useState(240);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [col2Width, setCol2Width] = useState(360);
	const [isDragging1, setIsDragging1] = useState(false);
	const [isDragging2, setIsDragging2] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	// ── Command Palette ──
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [paletteQuery, setPaletteQuery] = useState("");
	const paletteRef = useRef<HTMLInputElement | null>(null);
	const paletteIdxRef = useRef(0);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [theme, setTheme] = useState<'default' | 'catppuccin'>('default');

	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	// Monitor screen size for mobile switching
	useEffect(() => {
		const handleResize = () => setIsMobile(window.innerWidth < 768);
		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	// ── Initial fetch ──
	const fetchData = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		setError(null);
		offsetRef.current = 0;
		// Always fetch accounts alongside the first emails request.
		try {
			const [emailsData, accountsData] = await Promise.all([
				fetchEmails(PAGE_SIZE, 0),
				fetchAccounts(),
			]);
			// Tauri API / SQLite returns newest-first already, no .reverse() needed.
			// HTTP fallback reverses internally.
			setEmails(emailsData);
			setAccounts(accountsData);
			// If running in Tauri, check total count to determine hasMore
			const total = typeof window !== "undefined" && "__TAURI__" in window
				? await (await import("@/lib/tauri-api")).fetchTotalEmailCount()
				: 0;
			if (total > 0) {
				setHasMore(emailsData.length < total);
				offsetRef.current = emailsData.length;
			} else {
				setHasMore(emailsData.length === PAGE_SIZE);
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "Unknown error";
			setError(msg);
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, []);

	useEffect(() => { fetchData(); }, [fetchData]);

	// ── Load more (infinite scroll) ──
	const loadMoreEmails = useCallback(async () => {
		if (!hasMore || loadingMore) return;
		setLoadingMore(true);
		try {
			const offset = offsetRef.current;
			const data = await fetchEmails(PAGE_SIZE, offset);
			// Tauri API returns newest-first already (SQLite ORDER BY id DESC).
			// HTTP fallback reverses internally.
			// No reverse needed here — just append.
			if (data.length > 0) {
				setEmails(prev => [...prev, ...data]);
				offsetRef.current = offset + data.length;
				// Check total to determine if there's more
				const total = typeof window !== "undefined" && "__TAURI__" in window
					? await (await import("@/lib/tauri-api")).fetchTotalEmailCount()
					: 0;
				if (total > 0) {
					setHasMore(offset + data.length < total);
				}
			}
			if (data.length < PAGE_SIZE) setHasMore(false);
		} catch {
			// silently swallow load-more errors
		} finally {
			setLoadingMore(false);
		}
	}, [hasMore, loadingMore]);

	// ── Infinite scroll: detect when near bottom of list ──
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const onScroll = () => {
			if (!hasMore || loadingMore) return;
			const { scrollTop, scrollHeight, clientHeight } = el;
			if (scrollHeight - scrollTop - clientHeight < 300) {
				loadMoreEmails();
			}
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	}, [hasMore, loadingMore, loadMoreEmails]);

	// Write iframe content when email changes
	useEffect(() => {
		if (selectedIdx !== null && emails[selectedIdx]) {
			const email = emails[selectedIdx];
			if (iframeRef.current && (email.body_html || email.body_text)) {
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

	// ── CodeMirror vim editor lifecycle ──
	useEffect(() => {
		// Destroy existing editor if any
		if (cmViewRef.current) {
			cmViewRef.current.destroy();
			cmViewRef.current = null;
		}

		if (!visualMode || !plainText || !cmContainerRef.current) return;

		const container = cmContainerRef.current;

		// ── Monkey-patch: yank always copies to system clipboard ──
		if (!exDefined.current) {
			exDefined.current = true;
			try {
				const rc = Vim.getRegisterController();
				if (rc?.constructor?.prototype?.pushText) {
					const orig = rc.constructor.prototype.pushText;
					rc.constructor.prototype.pushText = function(
						registerName: any,
						operator: string,
						text: string,
						linewise: boolean,
						blockwise: boolean,
					) {
						orig.call(this, registerName, operator, text, linewise, blockwise);
						if (operator === 'yank' && text) {
							navigator.clipboard.writeText(text);
							// green flash feedback — find the active CM scroller
							const scroller = document.querySelector('.cm-scroller');
							if (scroller) {
								scroller.classList.add('yanked');
								setTimeout(() => scroller.classList.remove('yanked'), 400);
							}
						}
					};
				}
			} catch { }

			// ── Define :set ex commands ──
			Vim.defineEx('set', 'se', (cm: any, params: any) => {
				const view: EditorView | null = cm?.view;
				if (!view) return;
				const args: string[] = params?.args || [];
				for (const arg of args) {
					switch (arg) {
						case 'wrap':
							view.dispatch({ effects: wrapCompRef.current.reconfigure(EditorView.lineWrapping) });
							break;
						case 'nowrap':
							view.dispatch({ effects: wrapCompRef.current.reconfigure([]) });
							break;
						case 'nu':
						case 'number':
							view.dispatch({ effects: numCompRef.current.reconfigure(lineNumbers()) });
							break;
						case 'nonu':
						case 'nonumber':
							view.dispatch({ effects: numCompRef.current.reconfigure([]) });
							break;
						default:
							if (cm.state?.statusbar) {
								cm.state.statusbar.textContent = `Unknown option: ${arg}`;
							}
					}
				}
			});
		}

		// Dark theme matching our palette
		const darkTheme = EditorView.theme({
			"&": {
				backgroundColor: "#000",
				color: "#e4e4e7",
				height: "100%",
				fontSize: "13px",
				fontFamily: '"Iosevka", "Cascadia Code", "Fira Code", "SF Mono", Menlo, Monaco, monospace',
			},
			"&.cm-focused": { outline: "none" },
			".cm-cursor, .cm-dropCursor": { borderLeftColor: "#3b82f6" },
			".cm-selectionBackground": { backgroundColor: "#3b82f6" },
			".cm-activeLine": { backgroundColor: "transparent" },
			".cm-gutters": {
				backgroundColor: "#000",
				color: "#52525b",
				border: "none",
				borderRight: "1px solid #27272a",
			},
			".cm-lineNumbers .cm-activeLineGutter": {
				backgroundColor: "#18181b",
				color: "#a1a1aa",
			},
			".cm-content": {
				caretColor: "#3b82f6",
				padding: "16px 8px",
			},
			".cm-line": {
				padding: "0 4px",
				lineHeight: "1.7",
			},
			".cm-panels": { backgroundColor: "#09090b", color: "#a1a1aa", border: "1px solid #27272a" },
			".cm-panels-top": { borderBottom: "1px solid #27272a" },
			".cm-panels-bottom": { borderTop: "1px solid #27272a" },
			".cm-search": { backgroundColor: "#09090b", padding: "8px" },
			".cm-button": {
				backgroundColor: "#18181b",
				color: "#e4e4e7",
				border: "1px solid #27272a",
				borderRadius: "4px",
				padding: "2px 8px",
			},
			".cm-textfield": {
				backgroundColor: "#09090b",
				color: "#e4e4e7",
				border: "1px solid #27272a",
				borderRadius: "4px",
				padding: "2px 4px",
			},
			".cm-fat-cursor-mark": {
				backgroundColor: "#3b82f680",
			},
		}, { dark: true });

		const state = EditorState.create({
			doc: plainText,
			extensions: [
				darkTheme,
				wrapCompRef.current.of(EditorView.lineWrapping),
				numCompRef.current.of([]),
				drawSelection(),
				vim(),
				keymap.of([
					{
						// Escape in vim NORMAL mode → exit visual mode entirely
						// vim() handles Escape first (visual→normal transition).
						// Only when already in normal mode does this run.
						key: "Escape",
						run: () => {
							setVisualMode(false);
							setPlainText("");
							return true;
						},
					},
				]),
			],
		});

		const view = new EditorView({ state, parent: container });
		cmViewRef.current = view;
		view.focus();

		return () => {
			view.destroy();
			cmViewRef.current = null;
		};
	}, [visualMode, plainText]);

	// ── Keybindings (only for non-CodeMirror interactions) ──
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			// ── Command Palette (Ctrl+Shift+P) ──
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
				e.preventDefault();
				if (paletteOpen) {
					setPaletteOpen(false);
				} else {
					setPaletteQuery("");
					paletteIdxRef.current = 0;
					setPaletteOpen(true);
				}
				return;
			}

			// If palette is open, handle Escape to close
			if (paletteOpen) {
				if (e.key === 'Escape') {
					e.preventDefault();
					setPaletteOpen(false);
				}
				return;
			}

			// When Visual Mode is active, CodeMirror handles all vim keys internally.
			// We only intercept global navigation keys (2, 3) here.
			if (visualMode && focusedPanel === 'reader') {
				switch (e.key) {
					case '2':
						e.preventDefault();
						setVisualMode(false);
						setPlainText("");
						setFocusedPanel('list');
						if (emails.length > 0 && selectedIdx === null) setSelectedIdx(0);
						break;
					case '3':
						if (selectedIdx !== null && emails[selectedIdx]) {
							e.preventDefault();
							setVisualMode(false);
							setPlainText("");
							setFocusedPanel('reader');
						}
						break;
				}
				return;
			}

			// ── Ctrl+B: toggle sidebar ──
			if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
				e.preventDefault();
				setSidebarOpen(p => !p);
				return;
			}

			switch (e.key) {
				case '2':
					e.preventDefault();
					setFocusedPanel('list');
					if (emails.length > 0 && selectedIdx === null) setSelectedIdx(0);
					break;

				case '3':
					if (selectedIdx !== null && emails[selectedIdx]) {
						e.preventDefault();
						setFocusedPanel('reader');
					}
					break;

				case 'j':
					if (focusedPanel === 'list' && emails.length > 0) {
						e.preventDefault();
						setSelectedIdx(p => p === null ? 0 : Math.min(p + 1, emails.length - 1));
					} else if (focusedPanel === 'reader' && iframeRef.current?.contentWindow) {
						e.preventDefault();
						iframeRef.current.contentWindow.scrollBy(0, 60);
					}
					break;

				case 'k':
					if (focusedPanel === 'list' && emails.length > 0) {
						e.preventDefault();
						setSelectedIdx(p => p === null ? 0 : Math.max(p - 1, 0));
					} else if (focusedPanel === 'reader' && iframeRef.current?.contentWindow) {
						e.preventDefault();
						iframeRef.current.contentWindow.scrollBy(0, -60);
					}
					break;

				case 'Enter':
					if (focusedPanel === 'list' && selectedIdx !== null) {
						e.preventDefault();
						setVisualMode(false);
						setPlainText("");
						setFocusedPanel('reader');
					}
					break;

				case 'v':
					if (focusedPanel === 'reader' && selectedIdx !== null && (emails[selectedIdx]?.body_html || emails[selectedIdx]?.body_text)) {
						e.preventDefault();
						const text = stripHtml(emails[selectedIdx].body_html || emails[selectedIdx].body_text || "");
						if (text.trim()) {
							setPlainText(text);
							setVisualMode(true);
						}
					}
					break;

				case 'Escape':
					if (focusedPanel === 'reader') {
						e.preventDefault();
						setFocusedPanel('list');
					}
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [focusedPanel, visualMode, emails, selectedIdx, plainText, paletteOpen]);

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
		setHasMore(true);
		if (cmViewRef.current) { cmViewRef.current.destroy(); cmViewRef.current = null; }
		fetchData(true);
	};

	const selectedEmail = selectedIdx !== null ? emails[selectedIdx] : null;
	const isDraggingAny = isDragging1 || isDragging2;

	const COMMANDS = [
		{ id: "settings", label: "Settings", execute: () => setSettingsOpen(true) },
	];

	return (
		<div
			className={`grid h-screen w-screen overflow-hidden bg-black text-zinc-100 select-none ${theme === 'catppuccin' ? 'catppuccin' : ''}`}
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

				{/* ── Column 1: Sidebar (collapsible with Ctrl+B) ── */}
				<aside
					className={`hidden md:block overflow-hidden bg-black shrink-0 transition-[width] duration-200 ease-in-out ${sidebarOpen ? "border-r border-zinc-900" : "border-r-0"}`}
					style={{ width: isMobile ? '0px' : sidebarOpen ? `${col1Width}px` : '0px' }}
				>
					<div className="flex h-full flex-col">
						<div className="flex items-center justify-between border-b border-zinc-900 px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
							<span>Folders</span>
							<span>{emails.length}</span>
						</div>
						<nav className="flex-1 overflow-y-auto divide-y divide-zinc-900/60">
							{[
								{ label: "All Mail", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", active: true },
								{ label: "Unread", icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8", active: false },
								{ label: "Important", icon: "M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z", active: false },
							].map((item) => (
								<button key={item.label} className={`w-full px-4 py-3 text-left transition ${item.active ? "bg-zinc-900 ring-1 ring-inset ring-zinc-600" : "bg-black hover:bg-zinc-950/60"}`}>
									<div className="flex items-center gap-2.5">
										<svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d={item.icon} /></svg>
										<span className={`truncate text-xs ${item.active ? "font-medium text-white" : "text-zinc-300"}`}>{item.label}</span>
									</div>
								</button>
							))}
						</nav>
						{accounts.length > 0 && (
							<div className="border-t border-zinc-900">
								<div className="flex items-center justify-between px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
									<span>Accounts</span>
								</div>
								{accounts.map((acc) => {
									const name = acc.email.split("@")[0];
									return (
										<div key={acc.email} className="flex items-center gap-2.5 px-4 py-3 text-xs transition bg-black hover:bg-zinc-950/60">
											<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-800 text-[8px] font-bold text-zinc-400">{name[0]?.toUpperCase()}</span>
											<div className="truncate min-w-0">
												<p className="text-zinc-300 truncate">{name}</p>
												<p className="truncate text-[10px] text-zinc-500 font-mono">{acc.email}</p>
										</div>
									</div>
								);})}
							</div>
						)}
					</div>
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
														<span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold ${unread ? "bg-white text-black" : "bg-zinc-800 text-zinc-400"}`}>{extractName(email.from_addr)[0]?.toUpperCase() || "?"}</span>
														<span className={`truncate text-xs ${unread ? "font-bold text-white" : "text-zinc-300"}`}>{extractName(email.from_addr)}</span>
													</div>
													<p className={`mt-1.5 truncate text-[11px] ${unread ? "font-semibold text-white" : "text-zinc-400"}`}>{email.subject}</p>
													{bodyPreview(email) && <p className="mt-1 truncate text-[10px] text-zinc-500">{bodyPreview(email, 70)}</p>}
												</div>
												<span className="shrink-0 pt-0.5 text-[9px] font-mono text-zinc-500 tabular-nums">{formatDate(email.date)}</span>
											</div>
										</button>
									);
								})}
								{/* Infinite scroll sentinel */}
								{loadingMore && (
									<div className="flex items-center justify-center gap-1.5 px-4 py-4">
										{[0, 1, 2].map(i => (
											<span key={i} className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: `${i * 0.15}s` }} />
										))}
										<span className="ml-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-600">Loading older…</span>
									</div>
								)}
								{!hasMore && emails.length > 0 && (
									<div className="px-4 py-4 text-center text-[10px] font-mono text-zinc-600">No more messages</div>
								)}
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
										<span className="text-zinc-300 break-all">{selectedEmail.from_addr}</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="w-12 text-zinc-500 font-mono">To</span>
										<span className="text-zinc-400">me</span>
									</div>
								</div>
							</div>

							{/* Body: either CodeMirror vim visual mode or iframe normal view */}
							<div className="flex-1 bg-black">
								{visualMode && focusedPanel === 'reader' && plainText ? (
									<div ref={cmContainerRef} className="h-full w-full overflow-hidden" />
								) : selectedEmail.body_html || selectedEmail.body_text ? (
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
					{error ? "⚠ disconnected" : loading ? "connecting…" : loadingMore ? `⟳ loading more… (${emails.length})` : emails.length > 0 ? `${emails.length} messages` : "ready"}
					{visualMode && focusedPanel === 'reader' && plainText && (
						<span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-green-800/50 text-green-300">
							-- VIM --
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

			{/* ── Command Palette Overlay ── */}
			{paletteOpen && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
					onClick={() => setPaletteOpen(false)}
				>
					{/* Backdrop */}
					<div className="absolute inset-0 bg-black/60" />
					{/* Palette */}
					<div
						className="relative w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden"
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-center border-b border-zinc-800 px-4">
							<svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
								<path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
							</svg>
							<input
								ref={paletteRef}
								type="text"
								value={paletteQuery}
								onChange={e => {
									setPaletteQuery(e.target.value);
									paletteIdxRef.current = 0;
								}}
								onKeyDown={e => {
									const filtered = COMMANDS.filter(c =>
										c.label.toLowerCase().includes(paletteQuery.toLowerCase())
									);
									switch (e.key) {
										case 'ArrowDown':
											e.preventDefault();
											paletteIdxRef.current = Math.min(
												paletteIdxRef.current + 1,
												filtered.length - 1
											);
											break;
										case 'ArrowUp':
											e.preventDefault();
											paletteIdxRef.current = Math.max(
												paletteIdxRef.current - 1,
												0
											);
											break;
										case 'Enter':
											e.preventDefault();
											if (filtered[paletteIdxRef.current]) {
												filtered[paletteIdxRef.current].execute();
												setPaletteOpen(false);
											}
											break;
										case 'Escape':
											e.preventDefault();
											setPaletteOpen(false);
											break;
									}
								}}
								placeholder="Type a command…"
								className="w-full bg-transparent px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
								autoFocus
							/>
						</div>
						<div className="max-h-64 overflow-y-auto py-1">
							{COMMANDS.filter(c =>
								c.label.toLowerCase().includes(paletteQuery.toLowerCase())
							).length === 0 ? (
								<div className="px-4 py-6 text-center text-xs text-zinc-600 font-mono">
									No matching commands
								</div>
							) : (
								COMMANDS.filter(c =>
									c.label.toLowerCase().includes(paletteQuery.toLowerCase())
								).map((cmd, i) => {
									const selected = i === paletteIdxRef.current;
									const idx = cmd.label.toLowerCase().indexOf(
										paletteQuery.toLowerCase()
									);
									return (
										<button
											key={cmd.id}
											className={`w-full px-4 py-2.5 text-left text-xs transition flex items-center gap-3 ${selected ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}
											onClick={() => {
												cmd.execute();
												setPaletteOpen(false);
											}}
											onMouseEnter={() => (paletteIdxRef.current = i)}
										>
											<svg className="h-3.5 w-3.5 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
												<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
											</svg>
											<span>
												{idx >= 0 && paletteQuery ? (
													<>
														{cmd.label.slice(0, idx)}
														<span className="text-blue-400 underline decoration-blue-400/50">
															{cmd.label.slice(idx, idx + paletteQuery.length)}
														</span>
														{cmd.label.slice(idx + paletteQuery.length)}
													</>
												) : (
													cmd.label
												)}
											</span>
										</button>
									);
								})
							)}
						</div>
					</div>
				</div>
			)}

			{/* ── Settings Modal ── */}
			{settingsOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center"
					onClick={() => setSettingsOpen(false)}
				>
					<div className="absolute inset-0 bg-black/60" />
					<div
						className="relative w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-6 shadow-2xl shadow-black/60"
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-5">
							<h2 className="text-sm font-bold text-white tracking-tight">Settings</h2>
							<button onClick={() => setSettingsOpen(false)} className="text-zinc-500 hover:text-zinc-300 transition">
								<svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
									<path d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>

						<p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Theme</p>
						<div className="grid grid-cols-2 gap-3">
							{/* Default theme */}
							<button
								onClick={() => setTheme('default')}
								className={`rounded-lg border p-4 text-left transition ${theme === 'default' ? 'border-zinc-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'}`}
							>
								<div className="flex items-center gap-2 mb-2">
									<div className="h-3 w-3 rounded-full bg-black border border-zinc-600" />
									<span className={`text-xs font-medium ${theme === 'default' ? 'text-white' : 'text-zinc-300'}`}>Default</span>
								</div>
								<div className="flex gap-1">
									<span className="h-1.5 w-5 rounded bg-zinc-800" />
									<span className="h-1.5 w-3 rounded bg-zinc-700" />
									<span className="h-1.5 w-4 rounded bg-blue-500/50" />
								</div>
							</button>
							{/* Catppuccin Mocha */}
							<button
								onClick={() => setTheme('catppuccin')}
								className={`rounded-lg border p-4 text-left transition ${theme === 'catppuccin' ? 'border-zinc-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'}`}
							>
								<div className="flex items-center gap-2 mb-2">
									<div className="h-3 w-3 rounded-full" style={{ backgroundColor: '#1e1e2e', border: '1px solid #45475a' }} />
									<span className={`text-xs font-medium ${theme === 'catppuccin' ? 'text-white' : 'text-zinc-300'}`}>Catppuccin Mocha</span>
								</div>
								<div className="flex gap-1">
									<span className="h-1.5 w-5 rounded" style={{ backgroundColor: '#313244' }} />
									<span className="h-1.5 w-3 rounded" style={{ backgroundColor: '#45475a' }} />
									<span className="h-1.5 w-4 rounded" style={{ backgroundColor: '#89b4fa' }} />
								</div>
							</button>
						</div>

						<p className="text-[10px] text-zinc-600 mt-4 leading-relaxed">
							{theme === 'catppuccin'
								? 'Catppuccin Mocha theme active — warm latte-inspired dark tones with pastel accents.'
								: 'Dark terminal theme with blue accent — the default Harbor look.'}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
