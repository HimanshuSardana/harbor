/**
 * Tauri IPC bridge — tries Tauri `invoke` first, falls back to HTTP API.
 * This lets the app run both inside Tauri (desktop) and in a browser (dev mode).
 */

import type { Email, Account } from "@/lib/types";

// Detect Tauri runtime (desktop) vs browser (dev)
function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI__" in window;
}

// Lazy import to avoid bundling Tauri API in browser-only mode
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(cmd, args);
}

const API_BASE = "http://localhost:3002";

// ── Helpers to remap field names ──

/** SQLite "id" → "id", arrays come newest-first, no `.reverse()` needed. */
interface TauriEmail {
	subject: string;
	from_addr: string;
	date: string;
	body_text: string;
	body_html: string;
	id: number;
	mailbox: string;
	filename: string | null;
	flags: string | null;
}

interface TauriAccount {
	email: string;
	imap_uid: number;
	active: boolean;
}

function toEmail(e: TauriEmail): Email {
	return {
		subject: e.subject,
		from_addr: e.from_addr,
		date: e.date,
		body_html: e.body_html,
		body_text: e.body_text,
		id: e.id,
		mailbox: e.mailbox,
		filename: e.filename ?? undefined,
		flags: e.flags ?? undefined,
	};
}

// ── Public API ──

export async function fetchEmails(limit: number, offset: number): Promise<Email[]> {
	if (isTauri()) {
		const rows = await tauriInvoke<TauriEmail[]>("get_emails", { limit, offset });
		return rows.map(toEmail).reverse(); // Ensure newest-first order
	}
	// Fallback: HTTP API
	const res = await fetch(`${API_BASE}/api/emails?limit=${limit}&offset=${offset}`);
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	const data = await res.json();
	// API returns oldest-first within batch; reverse for newest-at-top.
	return data.map((e: any) => ({
		subject: e.subject || "",
		from_addr: e.from_addr || e.from || "",
		date: e.date || "",
		body_html: e.body_html || e.body || "",
		body_text: e.body_text || "",
		id: e.id,
		mailbox: e.mailbox,
		filename: e.filename,
		flags: e.flags,
	}));
}

export async function fetchAccounts(): Promise<Account[]> {
	if (isTauri()) {
		const rows = await tauriInvoke<TauriAccount[]>("get_accounts");
		return rows.map(a => ({ email: a.email }));
	}
	const res = await fetch(`${API_BASE}/api/accounts`);
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	return res.json();
}

export async function fetchEmlContent(filename: string): Promise<string> {
	if (isTauri()) {
		return tauriInvoke<string>("get_eml_content", { filename });
	}
	// No HTTP fallback for .eml—users must be in Tauri to read raw files.
	throw new Error("EML content requires Tauri runtime");
}

export async function fetchTotalEmailCount(): Promise<number> {
	if (isTauri()) {
		return tauriInvoke<number>("get_total_email_count");
	}
	// Fallback: not critical, just return 0 or a high number.
	return 0;
}

/**
 * Mark an email as seen (read).
 * Works in both Tauri and browser mode via HTTP API.
 */
export async function markSeen(id: number): Promise<void> {
	const res = await fetch(`${API_BASE}/api/emails/${id}/seen`, { method: "PATCH" });
	if (!res.ok) throw new Error(`markSeen API error: ${res.status}`);
	await res.json();
}

/**
 * Mark an email as unread.
 * Works in both Tauri and browser mode via HTTP API.
 */
export async function markUnread(id: number): Promise<void> {
	const res = await fetch(`${API_BASE}/api/emails/${id}/unread`, { method: "PATCH" });
	if (!res.ok) throw new Error(`markUnread API error: ${res.status}`);
	await res.json();
}

/**
 * Trigger a forward sync on the backend.
 * Fetches new messages from the IMAP server since the last sync.
 */
export async function triggerSync(): Promise<void> {
	const res = await fetch(`${API_BASE}/api/sync`, { method: "POST" });
	if (!res.ok) throw new Error(`Sync API error: ${res.status}`);
	await res.json();
}

/**
 * Trigger a backfill sync on the backend.
 * Fetches N older messages from the IMAP server before the oldest cached one.
 * Works in both Tauri and browser mode by hitting the HTTP API directly.
 */
export async function triggerBackfill(count: number): Promise<void> {
	const res = await fetch(`${API_BASE}/api/sync?backfill=${count}`, { method: "POST" });
	if (!res.ok) throw new Error(`Backfill API error: ${res.status}`);
	// The response is 202 — sync is async, we don't wait for completion.
	await res.json();
}
