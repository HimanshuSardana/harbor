"use client";

import { useMailStore } from "@/hooks/use-mail-store";
import { formatDate, extractName, isUnread, bodyPreview, buildIframeDoc, searchEmails, highlightSegments } from "@/lib/email-helpers";

// ─── Main Component ─────────────────────────────────────────────────────────

export default function App() {
	const {
		emails, accounts, loading, loadingMore, backfilling, backfillExhausted,
		hasMore, error, selectedIdx, refreshing, focusedPanel, visualMode, plainText,
		listRef, cmContainerRef, iframeRef, paletteRef, searchRef,
		setSelectedIdx, setFocusedPanel, setVisualMode, setPlainText,
		setHasMore, setBackfillExhausted, setError,
		col1Width, sidebarOpen, col2Width, isDragging1, isDragging2, isMobile,
		setSidebarOpen,
		paletteOpen, paletteQuery, paletteIdxRef,
		settingsOpen, theme, setPaletteOpen, setPaletteQuery,
		setSettingsOpen, setTheme,
		searchOpen, searchQuery, searchResultIndex,
		setSearchOpen, setSearchQuery, setSearchResultIndex,
		currentAccount, activeMailbox, accountPickerOpen,
		setAccountPickerOpen, switchAccount,
		accountSearchQuery, accountSearchRef, accountSearchIdx,
		setAccountSearchIdx, setAccountSearchQuery,
		fetchData, handleRefresh,
		startDragging1, startDragging2,
		selectedEmail, isDraggingAny, COMMANDS,
	} = useMailStore();

	return (
		<div
			className={`flex flex-col h-screen w-screen overflow-hidden bg-black text-zinc-100 select-none ${theme === 'catppuccin' ? 'catppuccin' : ''}`}
		>
			{/* ── 3 Column Workplace ── */}
			<div className="flex flex-1 min-h-0 w-full overflow-hidden pt-3 pb-3">

				{/* ── Column 1: Sidebar ── */}
				<aside
					className={`hidden md:block overflow-hidden bg-black shrink-0 transition-[width] duration-200 ease-in-out border-r border-zinc-900`}
					style={{ width: isMobile ? '0px' : sidebarOpen ? `${col1Width}px` : '52px' }}
				>
					<div className="flex h-full flex-col">
						<div className={`flex items-center border-b border-zinc-900 px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500 ${sidebarOpen ? "justify-between" : "justify-center"}`}>
							<span className={sidebarOpen ? "" : "hidden"}>Folders</span>
							<span className={sidebarOpen ? "" : "hidden"}>{emails.length}</span>
						</div>
						<nav className="flex-1 overflow-y-auto divide-y divide-zinc-900/60">
							{[
								{ label: "All Mail", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", active: true },
								{ label: "Unread", icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8", active: false },
								{ label: "Important", icon: "M12 9v2m0 4h.01M12 3l9.66 5.33v5.34L12 21l-9.66-5.33V8.33L12 3z", active: false },
							].map((item) => (
								<button key={item.label} className={`w-full px-4 py-3 text-left transition flex items-center ${sidebarOpen ? "justify-start" : "justify-center"} ${item.active ? "bg-zinc-900 ring-1 ring-inset ring-zinc-600" : "bg-black hover:bg-zinc-800/60"}`}>
									<div className={`flex items-center ${sidebarOpen ? "gap-2.5" : "gap-0 flex-col"}`}>
										<svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d={item.icon} /></svg>
										<span className={`${sidebarOpen ? "truncate text-xs" : "text-[8px] mt-0.5 text-zinc-500 truncate max-w-full"} ${item.active ? "font-medium text-white" : "text-zinc-300"}`}>{item.label}</span>
									</div>
								</button>
							))}
						</nav>
						{accounts.length > 0 && (
							<div className="border-t border-zinc-900">
								<div className={`flex items-center px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500 ${sidebarOpen ? "justify-between" : "justify-center"}`}>
									<span className={sidebarOpen ? "" : "hidden"}>Accounts</span>
									{accounts.length > 1 && sidebarOpen && (
										<button
											onClick={() => setAccountPickerOpen(true)}
											className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300 underline underline-offset-2 decoration-zinc-700"
										>
											{currentAccount ? "Switch" : `${accounts.length} accts`}
										</button>
									)}
								</div>
								{accounts.map((acc) => {
									const name = acc.email.split("@")[0];
									const isActive = acc.email === (currentAccount || accounts[0].email);
									return (
										<button
											key={acc.email}
											onClick={() => switchAccount(isActive ? "" : acc.email)}
											className={`w-full flex items-center ${sidebarOpen ? "gap-2.5 px-4" : "gap-0 justify-center px-0"} py-3 text-xs transition ${isActive ? "bg-zinc-900 ring-1 ring-inset ring-zinc-600" : "bg-black hover:bg-zinc-950/60"}`}
										>
											<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-800 text-[8px] font-bold text-zinc-400">{name[0]?.toUpperCase()}</span>
											<div className={`truncate min-w-0 text-left ${sidebarOpen ? "" : "hidden"}`}>
												<p className={`truncate ${isActive ? "font-semibold text-white" : "text-zinc-300"}`}>{acc.name || name}</p>
												<p className="truncate text-[10px] text-zinc-500 font-mono">{acc.email}</p>
											</div>
										</button>
									);
								})}
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
									const unread = isUnread(email);
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
								{backfilling && (
									<div className="flex items-center justify-center gap-1.5 px-4 py-4">
										<svg className="h-3.5 w-3.5 animate-spin text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
											<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
										</svg>
										<span className="ml-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-500/80">Backfilling older messages…</span>
									</div>
								)}
								{!backfilling && loadingMore && (
									<div className="flex items-center justify-center gap-1.5 px-4 py-4">
										{[0, 1, 2].map(i => (
											<span key={i} className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: `${i * 0.15}s` }} />
										))}
										<span className="ml-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-600">Loading older…</span>
									</div>
								)}
								{!hasMore && emails.length > 0 && (
									<div className="px-4 py-4 text-center">
										<p className="text-[10px] font-mono text-zinc-600">
											{backfillExhausted ? "All messages loaded from IMAP" : "No more messages"}
										</p>
										{backfillExhausted && (
											<button
												onClick={() => {
													setBackfillExhausted(false);
													setHasMore(true);
												}}
												className="mt-2 text-[9px] font-mono text-zinc-500 hover:text-zinc-300 underline underline-offset-2 decoration-zinc-700"
											>
												Retry backfill
											</button>
										)}
									</div>
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
			<footer className="flex items-center justify-between border-t border-zinc-900 bg-black px-4 text-[10px] font-mono text-zinc-500 pb-2 pt-2">
				<span className="flex items-center gap-2">
					{error ? "⚠ disconnected" : loading ? "connecting…" : backfilling ? `⟳ backfilling… (${emails.length})` : loadingMore ? `⟳ loading more… (${emails.length})` : emails.length > 0 ? `${emails.length} messages` : "ready"}
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
				<span>{accounts.length > 0 ? (currentAccount || accounts[0].email) : "no account connected"} · port 3002</span>
			</footer>

			{/* ── Command Palette Overlay ── */}
			{paletteOpen && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
					onClick={() => setPaletteOpen(false)}
				>
					<div className="absolute inset-0 bg-black/60" />
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
											paletteIdxRef.current = Math.min(paletteIdxRef.current + 1, filtered.length - 1);
											break;
										case 'ArrowUp':
											e.preventDefault();
											paletteIdxRef.current = Math.max(paletteIdxRef.current - 1, 0);
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
									const idx = cmd.label.toLowerCase().indexOf(paletteQuery.toLowerCase());
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

			{/* ── Email Search Popup ── */}
			{searchOpen && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
					onClick={() => setSearchOpen(false)}
				>
					<div className="absolute inset-0 bg-black/60" />
					<div
						className="relative w-full max-w-2xl rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden"
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-center border-b border-zinc-800 px-4">
							<svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
								<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
							</svg>
							<input
								ref={searchRef}
								type="text"
								value={searchQuery}
								onChange={e => setSearchQuery(e.target.value)}
								onKeyDown={e => {
									const results = searchEmails(emails, searchQuery);
									if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'p')) {
										e.preventDefault();
										if (e.key === 'n') {
											setSearchResultIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
										} else {
											setSearchResultIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
										}
										return;
									}
									switch (e.key) {
										case 'Escape':
											e.preventDefault();
											setSearchOpen(false);
											break;
										case 'ArrowDown':
											e.preventDefault();
											setSearchResultIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
											break;
										case 'ArrowUp':
											e.preventDefault();
											setSearchResultIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
											break;
										case 'Enter':
											e.preventDefault();
											if (results[searchResultIndex]) {
												const idx = emails.indexOf(results[searchResultIndex]);
												if (idx !== -1) {
													setSelectedIdx(idx);
													setFocusedPanel('reader');
													setSearchOpen(false);
												}
											}
											break;
									}
								}}
								placeholder="Search emails by subject, sender, or content..."
								className="w-full bg-transparent px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
								autoFocus
							/>
						</div>
						<div className="max-h-96 overflow-y-auto py-2">
							{searchEmails(emails, searchQuery).length === 0 ? (
								searchQuery ? (
									<div className="px-4 py-8 text-center text-xs text-zinc-600 font-mono">
										No emails found matching "{searchQuery}"
									</div>
								) : (
									<div className="px-4 py-8 text-center text-xs text-zinc-600 font-mono">
										Type to search emails...
									</div>
								)
							) : (
								searchEmails(emails, searchQuery).map((email, i) => {
									const unread = isUnread(email);
									const isSelected = i === searchResultIndex;
									return (
										<button
											data-search-index={i}
											key={email.id || i}
											className={`w-full px-4 py-2.5 text-left text-xs transition flex items-center gap-3 ${isSelected ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}
											onClick={() => {
												const idx = emails.indexOf(email);
												if (idx !== -1) {
													setSelectedIdx(idx);
													setFocusedPanel('reader');
													setSearchOpen(false);
												}
											}}
										>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold ${unread ? "bg-white text-black" : "bg-zinc-800 text-zinc-400"}`}>{extractName(email.from_addr)[0]?.toUpperCase() || "?"}</span>
													<span className={`truncate ${unread ? "font-bold text-white" : "text-zinc-300"}`}>{extractName(email.from_addr)}</span>
													{unread && <span className="shrink-0 text-[8px] font-bold bg-white text-black px-1.5 py-0.5 rounded">UNREAD</span>}
												</div>
												<p className={`mt-1.5 truncate ${unread ? "font-medium" : ""}`}>{highlightSegments(email.subject, searchQuery).map((seg, i) => seg.highlight ? <span key={i} className="bg-yellow-500/20 text-yellow-400 font-medium">{seg.text}</span> : seg.text)}</p>
												{bodyPreview(email) && <p className="mt-1 truncate text-[10px] text-zinc-500">{bodyPreview(email, 100)}</p>}
											</div>
										</button>
									);
								})
							)}
						</div>
					</div>
				</div>
			)}

			{/* ── Account Picker (search popup) ── */}
			{accountPickerOpen && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
					onClick={() => setAccountPickerOpen(false)}
				>
					<div className="absolute inset-0 bg-black/60" />
					<div
						className="relative w-full max-w-2xl rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden"
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-center border-b border-zinc-800 px-4">
							<svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
								<path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
							<input
								ref={accountSearchRef}
								type="text"
								value={accountSearchQuery}
								onChange={e => {
									setAccountSearchQuery(e.target.value);
									setAccountSearchIdx(0);
								}}
								onKeyDown={e => {
									const filtered = accounts.filter(acc => {
										const q = accountSearchQuery.toLowerCase();
										if (!q) return true;
										const name = (acc.name || acc.email.split('@')[0]).toLowerCase();
										return name.includes(q) || acc.email.toLowerCase().includes(q);
									});
									if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'p')) {
										e.preventDefault();
										if (e.key === 'n') {
											setAccountSearchIdx(prev => Math.min(prev + 1, filtered.length - 1));
										} else {
											setAccountSearchIdx(prev => Math.max(prev - 1, 0));
										}
										return;
									}
									switch (e.key) {
										case 'Escape':
											e.preventDefault();
											setAccountPickerOpen(false);
											break;
										case 'ArrowDown':
											e.preventDefault();
											setAccountSearchIdx(prev => Math.min(prev + 1, filtered.length - 1));
											break;
										case 'ArrowUp':
											e.preventDefault();
											setAccountSearchIdx(prev => Math.max(prev - 1, 0));
											break;
										case 'Enter':
											e.preventDefault();
											if (filtered[accountSearchIdx]) {
												const isActive = filtered[accountSearchIdx].email === (currentAccount || accounts[0].email);
												switchAccount(isActive ? "" : filtered[accountSearchIdx].email);
											}
											break;
									}
								}}
								placeholder="Search accounts by name or email..."
								className="w-full bg-transparent px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
								autoFocus
							/>
						</div>
						<div className="max-h-96 overflow-y-auto py-2">
							{accounts.filter(acc => {
								const q = accountSearchQuery.toLowerCase();
								if (!q) return true;
								const name = (acc.name || acc.email.split('@')[0]).toLowerCase();
								return name.includes(q) || acc.email.toLowerCase().includes(q);
							}).length === 0 ? (
								<div className="px-4 py-8 text-center text-xs text-zinc-600 font-mono">
									No accounts found
								</div>
							) : (
								accounts.filter(acc => {
									const q = accountSearchQuery.toLowerCase();
									if (!q) return true;
									const name = (acc.name || acc.email.split('@')[0]).toLowerCase();
									return name.includes(q) || acc.email.toLowerCase().includes(q);
								}).map((acc, i) => {
									const isActive = acc.email === (currentAccount || accounts[0].email);
									const name = acc.email.split("@")[0];
									const isSelected = i === accountSearchIdx;
									const q = accountSearchQuery.toLowerCase();
									const lowerName = (acc.name || name).toLowerCase();
									const nameIdx = lowerName.indexOf(q);
									const emailIdx = acc.email.toLowerCase().indexOf(q);
									return (
										<button
											key={acc.email}
											className={`w-full px-4 py-2.5 text-left text-xs transition flex items-center gap-3 ${isSelected ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}
											onClick={() => switchAccount(isActive ? "" : acc.email)}
											onMouseEnter={() => setAccountSearchIdx(i)}
										>
											<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-[9px] font-bold text-zinc-400">
												{name[0]?.toUpperCase()}
											</span>
											<div className="flex-1 min-w-0">
												<p className={`truncate ${isActive ? "font-semibold text-white" : ""}`}>
													{accountSearchQuery && nameIdx >= 0 ? (
														<>
															{(acc.name || name).slice(0, nameIdx)}
															<span className="bg-yellow-500/20 text-yellow-400 font-medium">
																{(acc.name || name).slice(nameIdx, nameIdx + accountSearchQuery.length)}
															</span>
															{(acc.name || name).slice(nameIdx + accountSearchQuery.length)}
														</>
													) : (
														acc.name || name
													)}
												</p>
												<p className="truncate text-[10px] text-zinc-500 font-mono">
													{accountSearchQuery && emailIdx >= 0 ? (
														<>
															{acc.email.slice(0, emailIdx)}
															<span className="bg-yellow-500/20 text-yellow-400 font-medium">
																{acc.email.slice(emailIdx, emailIdx + accountSearchQuery.length)}
															</span>
															{acc.email.slice(emailIdx + accountSearchQuery.length)}
														</>
													) : (
														acc.email
													)}
												</p>
											</div>
											{isActive && (
												<svg className="h-4 w-4 shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
													<path d="M5 13l4 4L19 7" />
												</svg>
											)}
										</button>
									);
								})
							)}
						</div>
						{currentAccount && (
							<div className="border-t border-zinc-800 px-4 py-2">
								<button
									onClick={() => switchAccount("")}
									className="w-full text-center text-[10px] font-mono text-zinc-500 hover:text-zinc-300 underline underline-offset-2 decoration-zinc-700"
								>
									Show all accounts
								</button>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
