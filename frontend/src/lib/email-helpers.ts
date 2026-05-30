import type { Email } from "@/lib/types";

/**
 * Format a date string into a human-readable relative time.
 */
export function formatDate(raw: string) {
	const d = new Date(raw);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	const hours = Math.floor(diff / 3_600_000);

	if (hours < 1) return `${Math.floor(diff / 60_000)}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (hours < 48) return "Yesterday";
	return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Extract the sender display name from an email address string.
 */
export function extractName(from: string | undefined | null) {
	if (!from) return "?";
	const match = from.match(/^"?(.+?)"?\s*</);
	if (match) return match[1].trim();
	return from.split("@")[0];
}

/**
 * Extract the domain portion from an email address string.
 */
export function extractDomain(from: string | undefined | null) {
	if (!from) return "";
	const match = from.match(/@([^>]+)>?/);
	return match ? match[1] : "";
}

/**
 * Determine whether an email is unread.
 * Uses the real flags field if available, falls back to keyword heuristics.
 */
export function isUnread(email: Email) {
	if (email.flags !== undefined) {
		return !email.flags.includes("S");
	}
	const keywords = ["LMS", "Reminder", "Grand Challenge", "Hackathon"];
	return keywords.some((f) => email.subject.includes(f));
}

/**
 * Clean up malformed HTML in email bodies.
 */
export function cleanBodyHtml(raw: string): string {
	return raw
		.replace(/^[\s\S]*?(<html[^>]*>)/i, "$1")
		.replace(/(=3D)/g, "=")
		.replace(/=\r?\n\s*/g, "")
		.replace(/&amp;/g, "&");
}

/**
 * Build a full HTML document for the email reader iframe.
 */
export function buildIframeDoc(email: Email): string {
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

/**
 * Strip HTML tags from a string, returning plain text.
 */
export function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Generate a plain-text preview of an email body, truncated to maxLen.
 */
export function bodyPreview(email: Email, maxLen = 80): string {
	const html = email.body_html || email.body_text || "";
	const text = stripHtml(html);
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

/**
 * Filter an email list by a search query (subject, sender, body).
 */
export function searchEmails(emails: Email[], query: string) {
	if (!query || !query.trim()) return emails;
	const searchQuery = query.toLowerCase();
	return emails.filter(email => {
		return (
			email.subject.toLowerCase().includes(searchQuery) ||
			email.from_addr.toLowerCase().includes(searchQuery) ||
			(email.body_html && email.body_html.toLowerCase().includes(searchQuery)) ||
			(email.body_text && email.body_text.toLowerCase().includes(searchQuery))
		);
	});
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split text into segments where the query matches, tagged for highlighting.
 * Consumer maps over segments and renders spans.
 */
export function highlightSegments(text: string, query: string): Array<{ text: string; highlight: boolean }> {
	if (!query || !text) return [{ text, highlight: false }];
	const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
	const parts = text.split(regex);
	return parts.map(part => ({
		text: part,
		highlight: regex.test(part),
	}));
}
