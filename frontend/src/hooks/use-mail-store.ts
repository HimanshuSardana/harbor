"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { EditorView, keymap, drawSelection, lineNumbers } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { Vim, vim } from "@replit/codemirror-vim";
import { fetchEmails, fetchAccounts, triggerSync, triggerBackfill, markSeen, markUnread } from "@/lib/tauri-api";
import { buildIframeDoc, stripHtml, searchEmails } from "@/lib/email-helpers";
import type { Email, Account } from "@/lib/types";

const PAGE_SIZE = 50;

export type FocusedPanel = "list" | "reader";
export type Theme = "default" | "catppuccin";

export function useMailStore() {
	// ── Data state ──
	const [emails, setEmails] = useState<Email[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [currentAccount, setCurrentAccount] = useState<string>("");
	const [accountPickerOpen, setAccountPickerOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [backfilling, setBackfilling] = useState(false);
	const [backfillExhausted, setBackfillExhausted] = useState(false);
	const [hasMore, setHasMore] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("list");
	const [visualMode, setVisualMode] = useState(false);
	const [plainText, setPlainText] = useState("");

	// ── Refs ──
	const listRef = useRef<HTMLDivElement | null>(null);
	const cmContainerRef = useRef<HTMLDivElement | null>(null);
	const cmViewRef = useRef<EditorView | null>(null);
	const wrapCompRef = useRef(new Compartment());
	const numCompRef = useRef(new Compartment());
	const exDefined = useRef(false);
	const offsetRef = useRef(0);
	const backfillingRef = useRef(false);
	const backfillRetryRef = useRef(0);
	const backfillExhaustedRef = useRef(false);
	const lastGKeyTimeRef = useRef(0);

	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	// ── UI state: layout ──
	const [col1Width, setCol1Width] = useState(240);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [col2Width, setCol2Width] = useState(360);
	const [isDragging1, setIsDragging1] = useState(false);
	const [isDragging2, setIsDragging2] = useState(false);
	const [isMobile, setIsMobile] = useState(false);

	// ── UI state: command palette ──
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [paletteQuery, setPaletteQuery] = useState("");
	const paletteRef = useRef<HTMLInputElement | null>(null);
	const paletteIdxRef = useRef(0);

	// ── UI state: settings ──
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [theme, setTheme] = useState<Theme>("default");

	// ── UI state: search ──
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	// Active mailbox derived from currentAccount (empty = first/default account)
	const activeMailbox = currentAccount || undefined;
	const activeMailboxRef = useRef(activeMailbox);
	activeMailboxRef.current = activeMailbox;

	// Monotonically increasing version to discard stale fetch responses
	const fetchVersionRef = useRef(0);
	const [searchResultIndex, setSearchResultIndex] = useState(0);
	const searchRef = useRef<HTMLInputElement | null>(null);

	// ── Search helpers ──
	const resetSearchResultIndex = useCallback(() => setSearchResultIndex(0), []);

	// Scroll to selected search result
	useEffect(() => {
		if (searchOpen && searchResultIndex > 0) {
			setTimeout(() => {
				const el = document.querySelector(`[data-search-index="${searchResultIndex}"]`);
				el?.scrollIntoView({ block: "nearest" });
			}, 100);
		}
	}, [searchOpen, searchResultIndex]);

	// ── Responsive ──
	useEffect(() => {
		const handleResize = () => setIsMobile(window.innerWidth < 768);
		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	// ── Initial fetch ──
	const fetchData = useCallback(async (silent = false) => {
		const version = ++fetchVersionRef.current;
		if (!silent) setLoading(true);
		setError(null);
		offsetRef.current = 0;
		const mb = activeMailboxRef.current;
		try {
			const [emailsData, accountsData] = await Promise.all([
				fetchEmails(PAGE_SIZE, 0, mb),
				fetchAccounts(),
			]);
			// Discard stale responses from a previous account switch
			if (version !== fetchVersionRef.current) return;
			setEmails(emailsData);
			setAccounts(accountsData);
			const total = typeof window !== "undefined" && "__TAURI__" in window
				? await (await import("@/lib/tauri-api")).fetchTotalEmailCount(mb)
				: 0;
			if (total > 0) {
				setHasMore(emailsData.length < total);
				offsetRef.current = emailsData.length;
			} else {
				setHasMore(emailsData.length > 0);
				offsetRef.current = emailsData.length;
			}
		} catch (e: unknown) {
			if (version !== fetchVersionRef.current) return;
			setError(e instanceof Error ? e.message : "Unknown error");
		} finally {
			if (version === fetchVersionRef.current) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	}, []);

	useEffect(() => { fetchData(); }, [fetchData]);

	// ── Reset backfill-exhausted when new data arrives ──
	useEffect(() => {
		if (emails.length > 0) {
			setBackfillExhausted(false);
			backfillExhaustedRef.current = false;
		}
	}, [emails.length]);

	// ── Switch account handler + re-fetch on account change ──
	const switchAccount = useCallback((email: string) => {
		fetchVersionRef.current++; // invalidate any in-flight fetch
		setCurrentAccount(email);
		setAccountPickerOpen(false);
		setEmails([]); // clear old account's emails immediately
		setSelectedIdx(null);
		setVisualMode(false);
		setPlainText("");
		setLoading(true); // show loading state for new account
		setError(null);
		setHasMore(true);
		setBackfillExhausted(false);
		backfillExhaustedRef.current = false;
		backfillingRef.current = false;
		offsetRef.current = 0;
		if (cmViewRef.current) {
			cmViewRef.current.destroy();
			cmViewRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (accounts.length > 0 && currentAccount !== "") {
			fetchData(false); // non-silent so setLoading(true) is also set here
		} else if (accounts.length > 0 && currentAccount === "") {
			// Switching back to default — also re-fetch
			fetchData(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentAccount]);

	// ── Load more (infinite scroll) with backfill support ──
	const loadMoreEmails = useCallback(async () => {
		if (!hasMore || loadingMore || backfillingRef.current) return;
		setLoadingMore(true);
		try {
			const offset = offsetRef.current;
			const mb = activeMailboxRef.current;
			const data = await fetchEmails(PAGE_SIZE, offset, mb);

			if (data.length > 0) {
				setEmails(prev => [...prev, ...data]);
				offsetRef.current = offset + data.length;
				backfillRetryRef.current = 0;
				const total = typeof window !== "undefined" && "__TAURI__" in window
					? await (await import("@/lib/tauri-api")).fetchTotalEmailCount(mb)
					: 0;
				if (total > 0) {
					setHasMore(offset + data.length < total);
				} else {
					setHasMore(true);
				}
			} else {
				setLoadingMore(false);
				backfillingRef.current = true;
				setBackfilling(true);
				try {
					await triggerBackfill(20, mb);
					let newData: Email[] = [];
					const maxRetries = 6;
					for (let attempt = 0; attempt < maxRetries; attempt++) {
						await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
						newData = await fetchEmails(PAGE_SIZE, offset, mb);
						if (newData.length > 0) break;
					}
					if (newData.length > 0) {
						setEmails(prev => [...prev, ...newData]);
						offsetRef.current = offset + newData.length;
						backfillRetryRef.current = 0;
						setHasMore(newData.length >= PAGE_SIZE);
					} else {
						setHasMore(false);
						setBackfillExhausted(true);
						backfillExhaustedRef.current = true;
					}
				} catch {
					// backfill failed silently
				} finally {
					backfillingRef.current = false;
					setBackfilling(false);
					setLoadingMore(false);
				}
				return;
			}
		} catch {
			// silently swallow
		} finally {
			setLoadingMore(false);
		}
	}, [hasMore, loadingMore]);

	// ── Infinite scroll listener ──
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const onScroll = () => {
			if (!hasMore || loadingMore || backfillingRef.current || backfillExhaustedRef.current) return;
			const { scrollTop, scrollHeight, clientHeight } = el;
			if (scrollHeight - scrollTop - clientHeight < 300) {
				loadMoreEmails();
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [hasMore, loadingMore, loadMoreEmails]);

	// ── Write iframe content when email changes ──
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

	// ── Auto-scroll selected list item into view ──
	useEffect(() => {
		if (selectedIdx !== null && listRef.current) {
			const btn = listRef.current.querySelector(`[data-idx="${selectedIdx}"]`) as HTMLElement | null;
			btn?.scrollIntoView({ block: "nearest" });
		}
	}, [selectedIdx]);

	// ── CodeMirror vim editor lifecycle ──
	useEffect(() => {
		if (cmViewRef.current) {
			cmViewRef.current.destroy();
			cmViewRef.current = null;
		}

		if (!visualMode || !plainText || !cmContainerRef.current) return;

		const container = cmContainerRef.current;

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
						if (operator === "yank" && text) {
							navigator.clipboard.writeText(text);
							const scroller = document.querySelector(".cm-scroller");
							if (scroller) {
								scroller.classList.add("yanked");
								setTimeout(() => scroller.classList.remove("yanked"), 400);
							}
						}
					};
				}
			} catch { /* ignore */ }

			Vim.defineEx("set", "se", (cm: any, params: any) => {
				const view: EditorView | null = cm?.view;
				if (!view) return;
				const args: string[] = params?.args || [];
				for (const arg of args) {
					switch (arg) {
						case "wrap":
							view.dispatch({ effects: wrapCompRef.current.reconfigure(EditorView.lineWrapping) });
							break;
						case "nowrap":
							view.dispatch({ effects: wrapCompRef.current.reconfigure([]) });
							break;
						case "nu":
						case "number":
							view.dispatch({ effects: numCompRef.current.reconfigure(lineNumbers()) });
							break;
						case "nonu":
						case "nonumber":
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

	// ── Keybindings ──
	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		const tag = (e.target as HTMLElement).tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

		// Command Palette (Ctrl+Shift+P)
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
			e.preventDefault();
			setPaletteOpen(prev => {
				if (!prev) {
					setPaletteQuery("");
					paletteIdxRef.current = 0;
				}
				return !prev;
			});
			return;
		}

		if (paletteOpen) {
			if (e.key === "Escape") {
				e.preventDefault();
				setPaletteOpen(false);
			}
			return;
		}

		if (searchOpen) {
			if (e.key === "Escape") {
				e.preventDefault();
				setSearchOpen(false);
			}
			return;
		}

		// Account picker — Escape to close
		if (accountPickerOpen) {
			if (e.key === "Escape") {
				e.preventDefault();
				setAccountPickerOpen(false);
			}
			return;
		}

		// Visual mode in reader — only intercept 2/3
		if (visualMode && focusedPanel === "reader") {
			switch (e.key) {
				case "2":
					e.preventDefault();
					setVisualMode(false);
					setPlainText("");
					setFocusedPanel("list");
					setSelectedIdx(prev => (prev === null && emails.length > 0 ? 0 : prev));
					break;
				case "3":
					if (selectedIdx !== null && emails[selectedIdx]) {
						e.preventDefault();
						setVisualMode(false);
						setPlainText("");
						setFocusedPanel("reader");
					}
					break;
			}
			return;
		}

		// Ctrl+B: toggle sidebar
		if ((e.ctrlKey || e.metaKey) && e.key === "b") {
			e.preventDefault();
			setSidebarOpen(p => !p);
			return;
		}

		// Shift+A: open account picker
		if (e.shiftKey && e.key === "A") {
			e.preventDefault();
			if (accounts.length > 1) {
				setAccountPickerOpen(true);
			}
			return;
		}

		// Ctrl+K: open email search
		if ((e.ctrlKey || e.metaKey) && e.key === "k") {
			e.preventDefault();
			setSearchOpen(true);
			setSearchResultIndex(0);
			return;
		}

		// Ctrl+P / Ctrl+N: search result navigation
		if ((e.ctrlKey || e.metaKey) && e.key === "p" && searchOpen) {
			e.preventDefault();
			setSearchResultIndex(prev => {
				const results = searchEmails(emails, searchQuery);
				return prev > 0 ? prev - 1 : results.length - 1;
			});
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "n" && searchOpen) {
			e.preventDefault();
			setSearchResultIndex(prev => {
				const results = searchEmails(emails, searchQuery);
				return prev < results.length - 1 ? prev + 1 : 0;
			});
			return;
		}

		switch (e.key) {
			case "2":
				e.preventDefault();
				setFocusedPanel("list");
				if (emails.length > 0) {
					setSelectedIdx(prev => (prev === null ? 0 : prev));
				}
				break;

			case "3":
				if (selectedIdx !== null && emails[selectedIdx]) {
					e.preventDefault();
					setFocusedPanel("reader");
				}
				break;

			case "j":
				if (focusedPanel === "list" && emails.length > 0) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					setSelectedIdx(p => (p === null ? 0 : Math.min(p + 1, emails.length - 1)));
				} else if (focusedPanel === "reader" && iframeRef.current?.contentWindow) {
					e.preventDefault();
					iframeRef.current.contentWindow.scrollBy(0, 60);
				}
				break;

			case "k":
				if (focusedPanel === "list" && emails.length > 0) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					setSelectedIdx(p => (p === null ? 0 : Math.max(p - 1, 0)));
				} else if (focusedPanel === "reader" && iframeRef.current?.contentWindow) {
					e.preventDefault();
					iframeRef.current.contentWindow.scrollBy(0, -60);
				}
				break;

			case "g":
				if (focusedPanel === "list" && emails.length > 0) {
					e.preventDefault();
					const now = Date.now();
					if (now - lastGKeyTimeRef.current < 400) {
						lastGKeyTimeRef.current = 0;
						setSelectedIdx(0);
					} else {
						lastGKeyTimeRef.current = now;
						setTimeout(() => {
							if (lastGKeyTimeRef.current === now) lastGKeyTimeRef.current = 0;
						}, 400);
					}
				}
				break;

			case "G":
				if (focusedPanel === "list" && emails.length > 0) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					setSelectedIdx(emails.length - 1);
				}
				break;

			case "Enter":
				if (focusedPanel === "list" && selectedIdx !== null) {
					e.preventDefault();
					setVisualMode(false);
					setPlainText("");
					setFocusedPanel("reader");
				}
				break;

			case "s": {
				if (focusedPanel === "list" && selectedIdx !== null && emails[selectedIdx]) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					const email = emails[selectedIdx];
					if (email.id !== undefined) {
						markSeen(email.id).then(() => {
							setEmails(prev => {
								const updated = [...prev];
								const idx = updated.findIndex(e => e.id === email.id);
								if (idx !== -1) updated[idx] = { ...updated[idx], flags: "S" };
								return updated;
							});
						}).catch(() => {});
					}
				}
				break;
			}

			case "u": {
				if (focusedPanel === "list" && selectedIdx !== null && emails[selectedIdx]) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					const email = emails[selectedIdx];
					if (email.id !== undefined) {
						markUnread(email.id).then(() => {
							setEmails(prev => {
								const updated = [...prev];
								const idx = updated.findIndex(e => e.id === email.id);
								if (idx !== -1) updated[idx] = { ...updated[idx], flags: "" };
								return updated;
							});
						}).catch(() => {});
					}
				}
				break;
			}

			case "r":
				if (focusedPanel === "list" && !loading && !refreshing) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					setRefreshing(true);
					triggerSync(activeMailboxRef.current).then(() => {
						setTimeout(() => fetchData(true), 1500);
					}).catch(() => setRefreshing(false));
				}
				break;

			case "b":
				if (focusedPanel === "list" && !backfilling && !loading && !loadingMore) {
					e.preventDefault();
					lastGKeyTimeRef.current = 0;
					backfillingRef.current = true;
					setBackfilling(true);
					setBackfillExhausted(false);
					backfillExhaustedRef.current = false;
					triggerBackfill(20, activeMailboxRef.current)
						.then(() => new Promise(r => setTimeout(r, 1500)))
						.then(() => fetchData(true))
						.then(() => {
							backfillingRef.current = false;
							setBackfilling(false);
						})
						.catch(() => {
							backfillingRef.current = false;
							setBackfilling(false);
						});
				}
				break;

			case "v":
				if (focusedPanel === "reader" && selectedIdx !== null && emails[selectedIdx]) {
					const email = emails[selectedIdx];
					if (email.body_html || email.body_text) {
						const text = stripHtml(email.body_html || email.body_text || "");
						if (text.trim()) {
							e.preventDefault();
							setPlainText(text);
							setVisualMode(true);
						}
					}
				}
				break;

			case "Escape":
				if (focusedPanel === "reader") {
					e.preventDefault();
					setFocusedPanel("list");
				}
				break;
		}
	}, [focusedPanel, visualMode, emails, selectedIdx, plainText, paletteOpen, searchOpen, searchQuery, accountPickerOpen, accounts, loading, refreshing, backfilling, loadingMore, fetchData]);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	// ── Resizer handlers ──
	const startDragging1 = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		setIsDragging1(true);
		const startX = e.clientX;
		const startWidth = col1Width;
		const onMouseMove = (me: MouseEvent) => setCol1Width(Math.max(160, Math.min(startWidth + me.clientX - startX, 400)));
		const onMouseUp = () => { setIsDragging1(false); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	}, [col1Width]);

	const startDragging2 = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		setIsDragging2(true);
		const startX = e.clientX;
		const startWidth = col2Width;
		const onMouseMove = (me: MouseEvent) => setCol2Width(Math.max(260, Math.min(startWidth + me.clientX - startX, 600)));
		const onMouseUp = () => { setIsDragging2(false); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	}, [col2Width]);

	// ── Refresh handler ──
	const handleRefresh = useCallback(() => {
		setRefreshing(true);
		setSelectedIdx(null);
		setVisualMode(false);
		setPlainText("");
		setHasMore(true);
		setBackfillExhausted(false);
		backfillExhaustedRef.current = false;
		backfillingRef.current = false;
		if (cmViewRef.current) {
			cmViewRef.current.destroy();
			cmViewRef.current = null;
		}
		fetchData(true);
	}, [fetchData]);

	// ── Computed values ──
	const selectedEmail = selectedIdx !== null ? emails[selectedIdx] : null;
	const isDraggingAny = isDragging1 || isDragging2;

	const COMMANDS = [
		{ id: "settings", label: "Settings", execute: () => setSettingsOpen(true) },
	];

	return {
		// Data
		emails,
		accounts,
		loading,
		loadingMore,
		backfilling,
		backfillExhausted,
		hasMore,
		error,
		selectedIdx,
		refreshing,
		focusedPanel,
		visualMode,
		plainText,

		// Refs
		listRef,
		cmContainerRef,
		iframeRef,
		paletteRef,
		searchRef,

		// State setters
		setEmails,
		setSelectedIdx,
		setFocusedPanel,
		setVisualMode,
		setPlainText,
		setHasMore,
		setBackfillExhausted,
		setError,

		// Layout state
		col1Width,
		sidebarOpen,
		col2Width,
		isDragging1,
		isDragging2,
		isMobile,

		// Layout setters
		setSidebarOpen,

		// Palette state
		paletteOpen,
		paletteQuery,
		paletteIdxRef,
		settingsOpen,
		theme,

		// Palette/settings setters
		setPaletteOpen,
		setPaletteQuery,
		setSettingsOpen,
		setTheme,

		// Search state
		searchOpen,
		searchQuery,
		searchResultIndex,

		// Search setters
		setSearchOpen,
		setSearchQuery,
		setSearchResultIndex,
		resetSearchResultIndex,

		// Account state
		currentAccount,
		activeMailbox,
		accountPickerOpen,
		setAccountPickerOpen,
		switchAccount,

		// Handlers
		fetchData,
		loadMoreEmails,
		handleRefresh,
		startDragging1,
		startDragging2,

		// Computed
		selectedEmail,
		isDraggingAny,
		COMMANDS,
	};
}
